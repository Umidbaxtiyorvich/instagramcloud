import { createHash } from "crypto";
import { prisma } from "./db";
import { randomToken } from "./crypto";
import { baseUrl } from "./url";

export const OAUTH_SCOPE = "instagram";
const CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_S = 60 * 60 * 24 * 7;
const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 180;

export function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function s256(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authServerMetadata(req: Request) {
  const base = baseUrl(req);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [OAUTH_SCOPE],
  };
}

export function protectedResourceMetadata(req: Request) {
  const base = baseUrl(req);
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Instagram Cloud",
  };
}

export function parseRedirectUris(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// https anywhere; plain http only for loopback (desktop clients, Claude Code, Cursor)
export function redirectUriAllowed(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    // custom schemes of native apps (cursor://, vscode://)
    return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && u.protocol !== "javascript:" && u.protocol !== "data:";
  } catch {
    return false;
  }
}

export async function registerClient(body: Record<string, unknown>) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || !uris.every(redirectUriAllowed)) {
    return { error: "invalid_redirect_uri", error_description: "redirect_uris noto'g'ri" } as const;
  }
  const clientId = `icc_${randomToken(18)}`;
  const name = String(body.client_name || "AI").slice(0, 80);
  await prisma.oAuthClient.create({
    data: { clientId, name, redirectUris: JSON.stringify(uris) },
  });
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  } as const;
}

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
};

// Checks everything we can before showing the consent screen.
// Errors that make the redirect_uri untrusted must not redirect.
export async function validateAuthorize(q: URLSearchParams) {
  const clientId = q.get("client_id") || "";
  const redirectUri = q.get("redirect_uri") || "";
  const client = clientId ? await prisma.oAuthClient.findUnique({ where: { clientId } }) : null;
  if (!client) return { fatal: "Noma'lum ilova (client_id). Konnektorni qaytadan qo'shib ko'ring." } as const;
  const uris = parseRedirectUris(client.redirectUris);
  const uri = redirectUri || (uris.length === 1 ? uris[0] : "");
  if (!uri || !uris.includes(uri)) return { fatal: "redirect_uri ro'yxatdan o'tmagan." } as const;

  const state = q.get("state") || "";
  const fail = (error: string, description: string) => {
    const u = new URL(uri);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", description);
    if (state) u.searchParams.set("state", state);
    return { redirect: u.toString() } as const;
  };
  if (q.get("response_type") !== "code") return fail("unsupported_response_type", "faqat code");
  const codeChallenge = q.get("code_challenge") || "";
  if (!codeChallenge) return fail("invalid_request", "PKCE code_challenge kerak");
  if ((q.get("code_challenge_method") || "plain") !== "S256") {
    return fail("invalid_request", "faqat S256");
  }
  return {
    ok: true as const,
    client,
    req: { clientId, redirectUri: uri, state, codeChallenge, scope: OAUTH_SCOPE } satisfies AuthorizeRequest,
  };
}

export async function issueCode(userId: string, r: AuthorizeRequest) {
  const code = randomToken(32);
  await prisma.oAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId: r.clientId,
      userId,
      redirectUri: r.redirectUri,
      codeChallenge: r.codeChallenge,
      scope: r.scope,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  const u = new URL(r.redirectUri);
  u.searchParams.set("code", code);
  if (r.state) u.searchParams.set("state", r.state);
  return u.toString();
}

async function issueTokens(userId: string, clientId: string, scope: string, lastUsedAt: Date | null = null) {
  const access = `ica_${randomToken(32)}`;
  const refresh = `icr_${randomToken(32)}`;
  await prisma.oAuthToken.create({
    data: {
      accessHash: sha256(access),
      refreshHash: sha256(refresh),
      clientId,
      userId,
      scope,
      expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      lastUsedAt,
    },
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
    scope,
  };
}

type TokenError = { error: string; error_description?: string };

export async function exchangeToken(form: URLSearchParams): Promise<TokenError | Awaited<ReturnType<typeof issueTokens>>> {
  const grant = form.get("grant_type");
  const clientId = form.get("client_id") || "";

  if (grant === "authorization_code") {
    const code = form.get("code") || "";
    const row = await prisma.oAuthCode.findUnique({ where: { codeHash: sha256(code) } });
    if (!row || row.expiresAt < new Date()) return { error: "invalid_grant", error_description: "kod eskirgan" };
    if (row.usedAt) {
      // a replayed code: whoever has it must not keep tokens minted from it
      await prisma.oAuthToken.updateMany({
        where: { clientId: row.clientId, userId: row.userId, createdAt: { gte: row.usedAt } },
        data: { revokedAt: new Date() },
      });
      return { error: "invalid_grant", error_description: "kod ishlatilgan" };
    }
    if (clientId && clientId !== row.clientId) return { error: "invalid_grant" };
    const redirectUri = form.get("redirect_uri");
    if (redirectUri && redirectUri !== row.redirectUri) return { error: "invalid_grant", error_description: "redirect_uri" };
    const verifier = form.get("code_verifier") || "";
    if (!verifier || s256(verifier) !== row.codeChallenge) {
      return { error: "invalid_grant", error_description: "PKCE tekshiruvi o'tmadi" };
    }
    await prisma.oAuthCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return issueTokens(row.userId, row.clientId, row.scope);
  }

  if (grant === "refresh_token") {
    const refresh = form.get("refresh_token") || "";
    const row = await prisma.oAuthToken.findUnique({ where: { refreshHash: sha256(refresh) } });
    if (!row || row.revokedAt || row.refreshExpiresAt < new Date()) return { error: "invalid_grant" };
    if (clientId && clientId !== row.clientId) return { error: "invalid_grant" };
    await prisma.oAuthToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    return issueTokens(row.userId, row.clientId, row.scope, row.lastUsedAt);
  }

  return { error: "unsupported_grant_type" };
}

export async function revokeToken(token: string) {
  const h = sha256(token);
  await prisma.oAuthToken.updateMany({
    where: { OR: [{ accessHash: h }, { refreshHash: h }], revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Accepts both an OAuth access token (Claude, ChatGPT) and the static personal token (Cursor, CLI).
export async function userIdFromBearer(token: string) {
  if (!token) return null;
  if (token.startsWith("ica_")) {
    const row = await prisma.oAuthToken.findUnique({ where: { accessHash: sha256(token) } });
    if (!row || row.revokedAt || row.expiresAt < new Date()) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await prisma.oAuthToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    }
    return row.userId;
  }
  const user = await prisma.user.findUnique({ where: { mcpToken: token }, select: { id: true } });
  return user?.id || null;
}
