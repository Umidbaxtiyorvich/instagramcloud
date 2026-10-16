import OpenAI from "openai";
import type { McpSorov } from "./mcp-ulanish";

// AI Ofis agentlari uchun ChatGPT (OpenAI Responses API) dvigateli.
// Ofis vositalari (Instagram, Moliya) bizning serverda bajariladi; «Ulanishlar»dagi
// MCP serverlarni OpenAI o'zi chaqiradi — yozishga ruxsat bo'lmasa, faqat o'qish vositalari.

let mijoz: OpenAI | null = null;
export function openai() {
  if (!process.env.OPENAI_API_KEY) return null;
  mijoz ??= new OpenAI();
  return mijoz;
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

  let input: OpenAI.Responses.ResponseInput | string = o.kontekst;
  let oldingi: string | undefined;
  for (let qadam = 0; qadam < 8; qadam++) {
    const r: OpenAI.Responses.Response = await o.client.responses.create({
      model: openaiModel(),
      instructions: o.tizim,
      input,
      ...(tools.length ? { tools } : {}),
      ...(oldingi ? { previous_response_id: oldingi } : {}),
      text: { format: { type: "json_schema", name: "ofis_vazifa", schema: o.sxema, strict: true } },
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
