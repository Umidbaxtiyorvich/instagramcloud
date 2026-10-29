import OpenAI from "openai";
import type { McpSorov } from "./mcp-ulanish";

// AI Ofis agentlari uchun ChatGPT (OpenAI Responses API) dvigateli.
// Ofis vositalari (Instagram, Moliya) bizning serverda bajariladi; «Ulanishlar»dagi
// MCP serverlarni OpenAI o'zi chaqiradi — yozishga ruxsat bo'lmasa, faqat o'qish vositalari.

// Kalit «Ulanishlar»da almashtiriladi va bazada shifrlangan turadi; yo'q bo'lsa — serverdagi OPENAI_API_KEY.
// openai() sinxron, shuning uchun bazadagi kalit xotirada (globalThis — instrumentation va route'lar bitta qiymatni ko'radi).
export const OPENAI_KALIT = "openai_kalit";
const g = globalThis as { __openaiKalit?: string; __openaiMijoz?: { kalit: string; mijoz: OpenAI } };

export const openaiKaliti = () => g.__openaiKalit || process.env.OPENAI_API_KEY?.trim() || "";
export const openaiKalitSaytdan = () => Boolean(g.__openaiKalit);

export function openaiKalitOrnat(kalit: string | null) {
  g.__openaiKalit = kalit || undefined;
}

// bazadan qayta o'qiydi (server ishga tushganda va har daqiqada; boshqa nusxa saqlagan bo'lsa ham yetib keladi)
export async function openaiKalitYukla() {
  const { prisma } = await import("./db");
  const { decryptSecret } = await import("./crypto");
  const r = await prisma.sozlama.findUnique({ where: { kalit: OPENAI_KALIT } });
  let kalit: string | null = null;
  try {
    kalit = r ? decryptSecret(r.qiymat) : null;
  } catch {
    kalit = null;
  }
  openaiKalitOrnat(kalit);
  return r?.yangilandi ?? null;
}

export function openai() {
  const kalit = openaiKaliti();
  if (!kalit) return null;
  if (g.__openaiMijoz?.kalit !== kalit) g.__openaiMijoz = { kalit, mijoz: new OpenAI({ apiKey: kalit }) };
  return g.__openaiMijoz.mijoz;
}

// OpenAI xatosini egasi tushunadigan gapga o'giradi (eng ko'p uchraydigani — hisobda pul qolmagani)
export function openaiXatoMatni(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (/insufficient_quota|no credits|exceeded your current quota/i.test(m))
    return "ChatGPT hisobida pul (kredit) qolmagan — platform.openai.com → Billing'da to'ldiring yoki saytda boshqa kalit qo'ying";
  if (e instanceof OpenAI.AuthenticationError || /invalid api key|incorrect api key/i.test(m)) return "OpenAI bu kalitni qabul qilmadi";
  if (e instanceof OpenAI.RateLimitError) return "ChatGPT hozir band (so'rovlar chegarasi) — bir daqiqadan keyin qayta urining";
  return m.slice(0, 160);
}

export const openaiModel = () => process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";

type Vosita = { name: string; description: string; inputSchema: unknown };

// Agent javobining sxemasi (strict structured output: hamma maydon majburiy, null ruxsat etilgan joyda)
export function javobSxemasi(jamoalar: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["jamoa", "agentId", "yangiAgent", "qadamlar", "javob", "natija", "tasdiqKerak"],
    properties: {
      jamoa: { type: "string", enum: [...jamoalar] },
      agentId: { type: ["string", "null"] },
      yangiAgent: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["ism", "rol", "avatar", "konikmalar"],
            properties: {
              ism: { type: "string" },
              rol: { type: "string" },
              avatar: { type: "string" },
              konikmalar: { type: "array", items: { type: "string" } },
            },
          },
          { type: "null" },
        ],
      },
      qadamlar: { type: "array", items: { type: "string" } },
      javob: { type: "string" },
      natija: { type: "string" },
      tasdiqKerak: { type: "boolean" },
    },
  };
}

function mcpVositalar(mcp: McpSorov): OpenAI.Responses.Tool[] {
  return mcp.servers.map((s) => {
    const ts = mcp.toolsets.find((t) => t.mcp_server_name === s.name);
    const ruxsat = ts?.configs ? Object.keys(ts.configs) : null;
    return {
      type: "mcp" as const,
      server_label: s.name,
      server_url: s.url,
      ...(s.authorization_token ? { authorization: s.authorization_token } : {}),
      require_approval: "never" as const,
      ...(ruxsat ? { allowed_tools: ruxsat } : {}),
    };
  });
}

export async function openaiVazifa(o: {
  client: OpenAI;
  tizim: string;
  kontekst: string;
  vositalar: Vosita[];
  mcp: McpSorov | null;
  sxema: Record<string, unknown>;
  bajar: (nom: string, kirish: Record<string, unknown>) => Promise<string>;
  amallar: string[];
  model?: string;
  // telefon suhbati: o'ylash qisqa va javob lo'nda bo'lsin (gpt-5 oilasida)
  tez?: boolean;
}): Promise<unknown> {
  const tools: OpenAI.Responses.Tool[] = [
    ...o.vositalar.map((v) => ({
      type: "function" as const,
      name: v.name,
      description: v.description,
      parameters: v.inputSchema as Record<string, unknown>,
      strict: false,
    })),
    ...(o.mcp ? mcpVositalar(o.mcp) : []),
  ];

  const model = o.model || openaiModel();
  const tez = o.tez && /^gpt-5/.test(model);
  let input: OpenAI.Responses.ResponseInput | string = o.kontekst;
  let oldingi: string | undefined;
  for (let qadam = 0; qadam < 8; qadam++) {
    const r: OpenAI.Responses.Response = await o.client.responses.create({
      model,
      instructions: o.tizim,
      input,
      ...(tools.length ? { tools } : {}),
      ...(oldingi ? { previous_response_id: oldingi } : {}),
      ...(tez ? { reasoning: { effort: "minimal" as const } } : {}),
      text: { format: { type: "json_schema", name: "ofis_vazifa", schema: o.sxema, strict: true }, ...(tez ? { verbosity: "low" as const } : {}) },
    });

    for (const it of r.output) {
      if (it.type === "mcp_call") o.amallar.push(`${o.mcp?.nomlar[it.server_label] ?? it.server_label}: ${it.name}`);
    }
    const chaqiruvlar = r.output.filter((it): it is OpenAI.Responses.ResponseFunctionToolCall => it.type === "function_call");
    if (!chaqiruvlar.length) {
      if (!r.output_text) throw new Error("ChatGPT bo'sh javob qaytardi");
      return JSON.parse(r.output_text);
    }

    oldingi = r.id;
    input = await Promise.all(
      chaqiruvlar.map(async (c) => {
        let natija: string;
        try {
          natija = (await o.bajar(c.name, c.arguments ? (JSON.parse(c.arguments) as Record<string, unknown>) : {})).slice(0, 20000);
        } catch (e) {
          natija = `Xato: ${e instanceof Error ? e.message : "noma'lum"}`;
        }
        return { type: "function_call_output" as const, call_id: c.call_id, output: natija };
      }),
    );
  }
  throw new Error("Vazifa juda uzun bo'lib ketdi");
}
