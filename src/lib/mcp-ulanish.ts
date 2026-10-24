import { createHash } from "crypto";
import type { McpServer } from "@prisma/client";
import { prisma } from "./db";
import { decryptSecret, encryptSecret, randomToken } from "./crypto";
import { baseUrl } from "./url";

// AI Ofis «Ulanishlar»: agentlar ishlatadigan tashqi MCP serverlar.
// Ulanish: tokensiz, API token bilan yoki OAuth 2.1 (MCP avtorizatsiya spetsifikatsiyasi:
// protected-resource metadata → authorization server metadata → dinamik mijoz ro'yxati → PKCE).
// Vositalar Anthropic tomonida chaqiriladi (MCP connector), shuning uchun yozish vositalari
// faqat foydalanuvchi «Yozishga ruxsat» bergandagina yoqiladi.

export type McpVosita = { name: string; description: string; readOnly: boolean };

// Tayyor ro'yxat — URL'ni foydalanuvchi o'zgartirishi mumkin
export const TAYYOR_MCP: { name: string; url: string; auth: "oauth" | "token" | "none"; tavsif: string; tokenYordam?: string }[] = [
  {
    name: "YesPOS",
    url: "https://yespos-bot-production.up.railway.app/mcp",
    auth: "token",
    tavsif: "Savdo, qarzlar, tovarlar, akt sverka (Miya har 6 soatda tekshiradi)",
    tokenYordam: "Telegram: @Yespos_xisobkitob_bot → «🔌 AI ofis ulanishi»",
  },
  { name: "Notion", url: "https://mcp.notion.com/mcp", auth: "oauth", tavsif: "Sahifalar, bazalar, eslatmalar" },
  { name: "Linear", url: "https://mcp.linear.app/mcp", auth: "oauth", tavsif: "Vazifalar va loyihalar" },
  { name: "Sentry", url: "https://mcp.sentry.dev/mcp", auth: "oauth", tavsif: "Xatolar va monitoring" },
  { name: "Atlassian", url: "https://mcp.atlassian.com/v1/sse", auth: "oauth", tavsif: "Jira va Confluence" },
  { name: "Canva", url: "https://mcp.canva.com/mcp", auth: "oauth", tavsif: "Dizaynlar" },
  {
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    auth: "token",
    tavsif: "Repolar, issue va PR",
    tokenYordam: "github.com → Settings → Developer settings → Personal access tokens",
  },
  {
    name: "Stripe",
    url: "https://mcp.stripe.com",
    auth: "token",
    tavsif: "To'lovlar va mijozlar",
    tokenYordam: "Stripe Dashboard → Developers → API keys (faqat o'qish uchun «restricted key» tavsiya etiladi)",
  },
];

// ---------- URL xavfsizligi ----------

// Server foydalanuvchi bergan manzilga so'rov yuboradi — ichki tarmoqqa yo'l qo'ymaymiz
export function tekshirUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("MCP manzili noto'g'ri");
  }
  if (u.protocol !== "https:") throw new Error("MCP manzili https:// bilan boshlanishi kerak");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".internal") ||
    h.endsWith(".local") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
    h === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(h) ||
    /^fe80:/.test(h) ||
    !h.includes(".")
  ) {
    throw new Error("Ichki tarmoq manzillariga ulanib bo'lmaydi");
  }
  return u;
}

async function olish(url: string, init?: RequestInit) {
  tekshirUrl(url);
  return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000), cache: "no-store" });
}

// Anthropic MCP connector uchun server nomi: harf, raqam, _ va -
export const serverNomi = (s: Pick<McpServer, "id" | "name">) =>
  `${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "mcp"}_${s.id.slice(-6)}`;

export const vositalar = (s: Pick<McpServer, "toolsJson">): McpVosita[] | null => {
  if (!s.toolsJson) return null;
  try {
    return JSON.parse(s.toolsJson) as McpVosita[];
  } catch {
    return null;
  }
};

// ---------- OAuth 2.1 ----------

type AsMeta = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
};

const callbackUrl = (req?: Request) => `${baseUrl(req)}/api/ofis/ulanish/oauth/callback`;

async function jsonOl<T>(url: string): Promise<T | null> {
  try {
    const r = await olish(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// RFC 8414 / RFC 9728: path bo'lsa, .well-known dan keyin qo'yiladi
function wellKnown(base: URL, nom: string) {
  const path = base.pathname.replace(/\/$/, "");
  const out = [`${base.origin}/.well-known/${nom}${path === "" ? "" : path}`];
  if (path) out.push(`${base.origin}/.well-known/${nom}`);
  return out;
}

async function kashfQil(mcpUrl: string): Promise<{ as: AsMeta; scope?: string }> {
  const u = tekshirUrl(mcpUrl);
  // 1) himoyalangan resurs metama'lumoti: 401 javobidagi WWW-Authenticate yoki .well-known
  let prmUrl: string | null = null;
  try {
    const r = await olish(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams() }),
    });
    const m = r.headers.get("www-authenticate")?.match(/resource_metadata="([^"]+)"/);
    if (m) prmUrl = m[1];
  } catch {}
  type Prm = { authorization_servers?: string[]; scopes_supported?: string[] };
  let prm: Prm | null = prmUrl ? await jsonOl<Prm>(prmUrl) : null;
  for (const w of prm ? [] : wellKnown(u, "oauth-protected-resource")) {
    prm = await jsonOl<Prm>(w);
    if (prm) break;
  }
  // 2) avtorizatsiya serveri (eski serverlarda — MCP manzilining o'zi)
  const asBase = new URL(prm?.authorization_servers?.[0] ?? u.origin);
  let as: AsMeta | null = null;
  for (const w of [...wellKnown(asBase, "oauth-authorization-server"), ...wellKnown(asBase, "openid-configuration")]) {
    as = await jsonOl<AsMeta>(w);
    if (as?.authorization_endpoint && as.token_endpoint) break;
    as = null;
  }
  if (!as) throw new Error("Bu server OAuth bilan ulanishni qo'llamaydi — API token bilan ulang");
  tekshirUrl(as.authorization_endpoint);
  tekshirUrl(as.token_endpoint);
  const scopes = prm?.scopes_supported ?? as.scopes_supported;
  return { as, scope: scopes?.length ? scopes.join(" ") : undefined };
}

// OAuth boshlash: mijozni ro'yxatdan o'tkazadi va foydalanuvchini yo'naltiradigan manzilni qaytaradi
export async function oauthBoshla(s: McpServer, req: Request): Promise<string> {
  const { as, scope } = await kashfQil(s.url);
  let clientId = s.oauthClientId;
  let secretEnc = s.oauthClientSecretEnc;
  if (!clientId || s.oauthAuthUrl !== as.authorization_endpoint) {
    if (!as.registration_endpoint) throw new Error("Server mijozni avtomatik ro'yxatdan o'tkazmaydi — API token bilan ulang");
    const r = await olish(as.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_name: "Instagram Cloud — AI Ofis",
        redirect_uris: [callbackUrl(req)],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    if (!r.ok) throw new Error(`Mijozni ro'yxatdan o'tkazib bo'lmadi: HTTP ${r.status}`);
    const j = (await r.json()) as { client_id: string; client_secret?: string };
    clientId = j.client_id;
    secretEnc = j.client_secret ? encryptSecret(j.client_secret) : null;
  }
  const verifier = randomToken(48);
  const state = randomToken(24);
  await prisma.mcpServer.update({
    where: { id: s.id },
    data: {
      oauthClientId: clientId,
      oauthClientSecretEnc: secretEnc,
      oauthAuthUrl: as.authorization_endpoint,
      oauthTokenUrl: as.token_endpoint,
      oauthScope: scope ?? null,
      oauthVerifierEnc: encryptSecret(verifier),
      oauthState: state,
    },
  });
  const a = new URL(as.authorization_endpoint);
  a.searchParams.set("response_type", "code");
  a.searchParams.set("client_id", clientId!);
  a.searchParams.set("redirect_uri", callbackUrl(req));
  a.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  a.searchParams.set("code_challenge_method", "S256");
  a.searchParams.set("state", state);
  a.searchParams.set("resource", s.url);
  if (scope) a.searchParams.set("scope", scope);
  return a.toString();
}

type TokenJavob = { access_token: string; refresh_token?: string; expires_in?: number };

async function tokenSorov(s: McpServer, params: Record<string, string>): Promise<TokenJavob> {
  if (!s.oauthTokenUrl || !s.oauthClientId) throw new Error("OAuth sozlanmagan");
  const body = new URLSearchParams({ ...params, client_id: s.oauthClientId, resource: s.url });
  if (s.oauthClientSecretEnc) body.set("client_secret", decryptSecret(s.oauthClientSecretEnc));
  const r = await olish(s.oauthTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!r.ok) throw new Error(`Token olinmadi: HTTP ${r.status}`);
  const j = (await r.json()) as TokenJavob;
  if (!j.access_token) throw new Error("Server token qaytarmadi");
  return j;
}

const tokenSaqla = (id: string, t: TokenJavob, eskiRefresh?: string | null) =>
  prisma.mcpServer.update({
    where: { id },
    data: {
      accessTokenEnc: encryptSecret(t.access_token),
      refreshTokenEnc: t.refresh_token ? encryptSecret(t.refresh_token) : eskiRefresh ?? null,
      tokenExpiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
      oauthVerifierEnc: null,
      oauthState: null,
      lastError: null,
    },
  });

export async function oauthYakunla(state: string, code: string, req: Request) {
  const s = await prisma.mcpServer.findUnique({ where: { oauthState: state } });
  if (!s || !s.oauthVerifierEnc) throw new Error("Ulanish so'rovi topilmadi yoki eskirgan");
  const t = await tokenSorov(s, {
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(req),
    code_verifier: decryptSecret(s.oauthVerifierEnc),
  });
  return tokenSaqla(s.id, t);
}

// Ishlatishdan oldin: muddati o'tayotgan OAuth tokenni yangilaydi
export async function tokenOl(s: McpServer): Promise<string | null> {
  if (s.auth === "none" || !s.accessTokenEnc) return null;
  const tugaydi = s.tokenExpiresAt ? s.tokenExpiresAt.getTime() - Date.now() < 60_000 : false;
  if (s.auth === "oauth" && tugaydi && s.refreshTokenEnc) {
    const t = await tokenSorov(s, { grant_type: "refresh_token", refresh_token: decryptSecret(s.refreshTokenEnc) });
    await tokenSaqla(s.id, t, s.refreshTokenEnc);
    return t.access_token;
  }
  return decryptSecret(s.accessTokenEnc);
}

// ---------- vositalar ro'yxati (tekshiruv) ----------

const initParams = () => ({
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "instagramcloud-ofis", version: "1.0.0" },
});

// Streamable HTTP javobi JSON yoki SSE bo'lishi mumkin
async function rpcJavob(r: Response, id: number) {
  const ct = r.headers.get("content-type") ?? "";
  const text = await r.text();
  const xabarlar = ct.includes("text/event-stream")
    ? text
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => {
          try {
            return JSON.parse(l.slice(5).trim());
          } catch {
            return null;
          }
        })
    : [JSON.parse(text)];
  const m = xabarlar.find((x) => x && x.id === id);
  if (!m) throw new Error("MCP server javob bermadi");
  if (m.error) throw new Error(`MCP xatosi: ${m.error.message ?? m.error.code}`);
  return m.result;
}

export async function tekshir(s: McpServer): Promise<McpVosita[]> {
  if (/\/sse\/?$/.test(new URL(s.url).pathname)) {
    throw new Error("Eski SSE transporti: vositalar ro'yxatini olib bo'lmadi");
  }
  const token = await tokenOl(s);
  if (s.auth !== "none" && !token) throw new Error("Hali ulanmagan — «Ulash» tugmasini bosing");
  const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (token) h.Authorization = `Bearer ${token}`;

  const r1 = await olish(s.url, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams() }) });
  if (r1.status === 401 || r1.status === 403) throw new Error("Server ruxsat bermadi — token noto'g'ri yoki muddati o'tgan");
  if (!r1.ok) throw new Error(`MCP server javob bermadi: HTTP ${r1.status}`);
  await rpcJavob(r1, 1);
  const sessiya = r1.headers.get("mcp-session-id");
  if (sessiya) h["Mcp-Session-Id"] = sessiya;
  h["MCP-Protocol-Version"] = "2025-06-18";
  await olish(s.url, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }).catch(() => null);

  const out: McpVosita[] = [];
  let cursor: string | undefined;
  for (let sahifa = 0; sahifa < 10; sahifa++) {
    const r = await olish(s.url, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2 + sahifa, method: "tools/list", params: cursor ? { cursor } : {} }),
    });
    if (!r.ok) throw new Error(`tools/list: HTTP ${r.status}`);
    const res = (await rpcJavob(r, 2 + sahifa)) as {
      tools: { name: string; description?: string; annotations?: { readOnlyHint?: boolean } }[];
      nextCursor?: string;
    };
    for (const t of res.tools ?? []) {
      out.push({ name: t.name, description: (t.description ?? "").slice(0, 200), readOnly: t.annotations?.readOnlyHint === true });
    }
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return out;
}

// Server tomonida bitta vositani chaqirish (Miya kabi avtomatik tekshiruvlar uchun) — matn qaytaradi
export async function tashqiVosita(s: McpServer, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const token = await tokenOl(s);
  if (s.auth !== "none" && !token) throw new Error(`${s.name}: hali ulanmagan`);
  const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (token) h.Authorization = `Bearer ${token}`;
  const r1 = await olish(s.url, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams() }) });
  if (r1.status === 401 || r1.status === 403) throw new Error(`${s.name}: token noto'g'ri yoki muddati o'tgan`);
  if (!r1.ok) throw new Error(`${s.name}: HTTP ${r1.status}`);
  await rpcJavob(r1, 1);
  const sessiya = r1.headers.get("mcp-session-id");
  if (sessiya) h["Mcp-Session-Id"] = sessiya;
  h["MCP-Protocol-Version"] = "2025-06-18";
  await olish(s.url, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }).catch(() => null);
  const r = await olish(s.url, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }) });
  if (!r.ok) throw new Error(`${s.name} ${name}: HTTP ${r.status}`);
  const res = (await rpcJavob(r, 2)) as { content?: { type: string; text?: string }[]; isError?: boolean };
  const text = (res.content ?? []).map((c) => c.text ?? "").join("\n");
  if (res.isError) throw new Error(`${s.name}: ${text.slice(0, 300)}`);
  return text;
}

export async function tekshirVaSaqla(s: McpServer) {
  try {
    const v = await tekshir(s);
    return prisma.mcpServer.update({
      where: { id: s.id },
      data: { toolsJson: JSON.stringify(v), checkedAt: new Date(), lastError: null },
    });
  } catch (e) {
    return prisma.mcpServer.update({
      where: { id: s.id },
      data: { checkedAt: new Date(), lastError: e instanceof Error ? e.message : "Xato" },
    });
  }
}

// ---------- Claude so'rovi uchun ----------

export type McpSorov = {
  servers: { type: "url"; url: string; name: string; authorization_token?: string }[];
  toolsets: {
    type: "mcp_toolset";
    mcp_server_name: string;
    default_config?: { enabled: boolean };
    configs?: Record<string, { enabled: boolean }>;
  }[];
  nomlar: Record<string, string>; // connector nomi → foydalanuvchi ko'radigan nom
  tavsif: string; // tizim kontekstiga qo'shiladi
};

export async function agentMcp(userId: string): Promise<McpSorov> {
  const rows = await prisma.mcpServer.findMany({ where: { userId, enabled: true }, orderBy: { createdAt: "asc" } });
  const out: McpSorov = { servers: [], toolsets: [], nomlar: {}, tavsif: "" };
  const qatorlar: string[] = [];
  for (const s of rows) {
    let token: string | null = null;
    try {
      token = await tokenOl(s);
    } catch (e) {
      await prisma.mcpServer.update({ where: { id: s.id }, data: { lastError: e instanceof Error ? e.message : "Token xatosi" } });
      continue;
    }
    if (s.auth !== "none" && !token) continue;
    const v = vositalar(s);
    // yozishga ruxsat yo'q va vositalar noma'lum — xavfsiz tomonda qolamiz
    if (!s.allowWrites && !v) continue;
    const name = serverNomi(s);
    const ruxsat = s.allowWrites ? v : v!.filter((x) => x.readOnly);
    if (ruxsat && !ruxsat.length) continue;
    out.servers.push({ type: "url", url: s.url, name, ...(token ? { authorization_token: token } : {}) });
    out.toolsets.push(
      s.allowWrites
        ? { type: "mcp_toolset", mcp_server_name: name }
        : {
            type: "mcp_toolset",
            mcp_server_name: name,
            default_config: { enabled: false },
            configs: Object.fromEntries(ruxsat!.map((x) => [x.name, { enabled: true }])),
          },
    );
    out.nomlar[name] = s.name;
    qatorlar.push(`- ${s.name} (${name}): ${s.allowWrites ? "o'qish va yozish" : "faqat o'qish"}`);
  }
  if (qatorlar.length) {
    out.tavsif = `Tashqi ulanishlar (MCP) — vazifaga kerak bo'lsa ishlating:\n${qatorlar.join("\n")}`;
  }
  return out;
}
