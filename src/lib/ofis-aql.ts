import OpenAI from "openai";
import { randomUUID } from "crypto";
import { openai } from "./ofis-openai";

// Miya va agentlarning «aqli»: qaysi AI o'ylaydi. To'rt xil manba, bitta ko'rinish (client.responses.create):
// - gemini  — Google Gemini bepul rejasi (GEMINI_API_KEY), doim ishlaydi;
// - groq    — Groq bepul rejasi (kalit «Ulanishlar»da, bazada shifrlangan), juda tez;
// - umid    — egasining kompyuteridagi Umid AI (Ollama) tunnel orqali, kompyuter yoniq bo'lganda;
// - chatgpt — OpenAI (kalit va hisobda pul bo'lsa).
// Gemini, Groq va Ollama Responses API'ni bilmaydi — ular chat.completions orqali shu ko'rinishga moslanadi (Moslama).
// Tanlangan manba ishlamasa, keyingisi sinab ko'riladi: tanlangan → gemini → groq → chatgpt.

export const AQL_TANLOV = "aql_tanlov";
export const UMID_URL = "umid_url";
export const GROQ_KALIT = "groq_kalit";
export type AqlTur = "gemini" | "groq" | "umid" | "chatgpt";
export const AQL_TURLARI: readonly AqlTur[] = ["gemini", "groq", "umid", "chatgpt"];

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
export const geminiModel = () => process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
const GROQ_URL = "https://api.groq.com/openai/v1";
// Groq modellarni tez-tez almashtiradi — nom qotirilmaydi: kalit ko'radigan ro'yxatdan shu tartibda tanlanadi
const GROQ_AFZAL = ["openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct", "llama-3.3-70b-versatile", "qwen/qwen3-32b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];
async function groqModelTanla(c: OpenAI) {
  if (process.env.GROQ_MODEL?.trim()) return process.env.GROQ_MODEL.trim();
  const bor: string[] = [];
  for await (const m of c.models.list()) bor.push(m.id);
  const suhbat = bor.filter((id) => !/whisper|tts|guard|embed|prompt-guard|playai|orpheus/i.test(id));
  const tanlov = GROQ_AFZAL.find((id) => suhbat.includes(id)) ?? suhbat.sort().find((id) => /llama|gpt-oss|qwen|kimi|gemma|mistral/i.test(id)) ?? suhbat[0];
  if (!tanlov) throw new Error("Groq'da suhbat modeli topilmadi");
  return tanlov;
}
export const umidModel = () => process.env.UMID_MODEL?.trim() || "qwen3:4b-instruct";

type AqlSozlama = { tanlov: AqlTur | null; umidUrl: string | null; groqKalit: string | null };
const g = globalThis as { __aql?: AqlSozlama; __aqlMijoz?: Map<string, Moslama> };

export const aqlSozlama = (): AqlSozlama => g.__aql ?? { tanlov: null, umidUrl: null, groqKalit: null };

export async function aqlYukla() {
  const { prisma } = await import("./db");
  const { decryptSecret } = await import("./crypto");
  const rows = await prisma.sozlama.findMany({ where: { kalit: { in: [AQL_TANLOV, UMID_URL, GROQ_KALIT] } } });
  const ol = (k: string) => rows.find((r) => r.kalit === k)?.qiymat ?? null;
  const t = ol(AQL_TANLOV);
  let groqKalit: string | null = null;
  try {
    groqKalit = ol(GROQ_KALIT) ? decryptSecret(ol(GROQ_KALIT)!) : null;
  } catch {
    groqKalit = null;
  }
  g.__aql = { tanlov: AQL_TURLARI.includes(t as AqlTur) ? (t as AqlTur) : null, umidUrl: ol(UMID_URL), groqKalit };
}

export const geminiBor = () => Boolean(process.env.GEMINI_API_KEY?.trim());

// Standart: Gemini (bepul, doim yoniq), u yo'q bo'lsa — ChatGPT
export function aqlTanlovi(): AqlTur {
  const t = aqlSozlama().tanlov;
  if (t) return t;
  return geminiBor() ? "gemini" : "chatgpt";
}

type ChatTur = Exclude<AqlTur, "chatgpt">;

function moslama(tur: ChatTur, groqKalit?: string): Moslama | null {
  const { umidUrl, groqKalit: saqlangan } = aqlSozlama();
  const groq = groqKalit ?? saqlangan;
  const sozlama =
    tur === "gemini"
      ? geminiBor() && { kalit: process.env.GEMINI_API_KEY!.trim(), url: process.env.GEMINI_OPENAI_URL || GEMINI_URL, model: geminiModel() }
      : tur === "groq"
        ? groq && { kalit: groq, url: GROQ_URL, model: "" }
        : umidUrl && { kalit: "ollama", url: `${umidUrl.replace(/\/+$/, "")}/v1`, model: umidModel() };
  if (!sozlama) return null;
  const kesh = (g.__aqlMijoz ??= new Map());
  const k = `${tur}|${sozlama.url}|${sozlama.model}|${sozlama.kalit.slice(-6)}`;
  if (!kesh.has(k)) kesh.set(k, new Moslama(new OpenAI({ apiKey: sozlama.kalit, baseURL: sozlama.url, timeout: 120_000, maxRetries: 1 }), sozlama.model, tur));
  return kesh.get(k)!;
}

function mijozi(tur: AqlTur, groqKalit?: string): OpenAI | null {
  if (tur === "chatgpt") return openai();
  return moslama(tur, groqKalit) as unknown as OpenAI | null;
}

// O'ylash uchun mijoz (responses.create). Tanlangan manba xato bersa — keyingisiga o'tadi.
export function aql(): OpenAI | null {
  const tartib = [...new Set<AqlTur>([aqlTanlovi(), "gemini", "groq", "chatgpt"])];
  const bor = tartib.map((t) => [t, mijozi(t)] as const).filter((x): x is readonly [AqlTur, OpenAI] => Boolean(x[1]));
  if (!bor.length) return null;
  if (bor.length === 1) return bor[0][1];
  return {
    responses: {
      create: async (p: unknown) => {
        let oxirgi: unknown;
        for (const [tur, c] of bor) {
          try {
            return await (c.responses.create as (x: unknown) => Promise<unknown>)(p);
          } catch (e) {
            // oldingi javobga bog'langan davom (previous_response_id) boshqa manbada ma'nosiz
            if ((p as { previous_response_id?: string }).previous_response_id) throw e;
            console.error(`aql: ${tur} ishlamadi —`, e instanceof Error ? e.message.slice(0, 200) : e);
            oxirgi = e;
          }
        }
        throw oxirgi;
      },
    },
  } as unknown as OpenAI;
}

export const aqlNomi = (t: AqlTur = aqlTanlovi()) => ({ gemini: "Gemini", groq: "Groq", umid: "Umid AI", chatgpt: "ChatGPT" })[t];

// ---------- Responses API ko'rinishi → chat.completions ----------

type Xabar = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Kirish = {
  instructions?: string;
  input: string | Array<{ type?: string; call_id?: string; output?: string } | string>;
  tools?: Array<{ type: string; name?: string; description?: string; parameters?: unknown }>;
  previous_response_id?: string;
  text?: { format?: { type?: string; schema?: unknown } };
};

// Gemini va Ollama JSON-sxemaning ba'zi kalitlarini qabul qilmaydi — soddalashtiramiz
function sxemaTozala(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(sxemaTozala);
  if (!s || typeof s !== "object") return s;
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties" || k === "$schema" || k === "strict") continue;
    if (k === "type" && Array.isArray(v)) {
      const t = v.filter((x) => x !== "null");
      r.type = t[0] ?? "string";
      if (t.length < v.length) r.nullable = true;
      continue;
    }
    if (k === "anyOf" && Array.isArray(v)) {
      const t = v.filter((x) => !(x && typeof x === "object" && (x as { type?: string }).type === "null"));
      if (t.length === 1) {
        Object.assign(r, sxemaTozala(t[0]) as object, { nullable: true });
        continue;
      }
    }
    r[k] = sxemaTozala(v);
  }
  return r;
}

// Model JSON'ni ```json ichida yoki gap bilan qaytarishi mumkin — faqat obyektni ajratib olamiz
export function jsonAjrat(matn: string) {
  const t = matn.replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

class Moslama {
  private tarix = new Map<string, Xabar[]>();
  responses = { create: (p: Kirish) => this.yarat(p) };

  constructor(
    private c: OpenAI,
    // bo'sh — birinchi so'rovda provayderning ro'yxatidan tanlanadi (Groq)
    private model: string,
    readonly tur: ChatTur,
  ) {}

  private async yarat(p: Kirish) {
    const sxema = p.text?.format?.type === "json_schema" ? p.text.format.schema : null;
    const msgs: Xabar[] = p.previous_response_id ? [...(this.tarix.get(p.previous_response_id) ?? [])] : [];
    if (!msgs.length) {
      const tizim =
        (p.instructions ?? "") +
        (sxema
          ? "\n\nJAVOB FORMATI: oxirgi javobingiz faqat bitta JSON obyekt bo'lsin (boshqa matn, ``` yo'q), shu sxema bo'yicha:\n" +
            JSON.stringify(sxema)
          : "");
      if (tizim.trim()) msgs.push({ role: "system", content: tizim });
    }
    for (const it of typeof p.input === "string" ? [p.input] : p.input) {
      if (typeof it === "string") msgs.push({ role: "user", content: it });
      else if (it.type === "function_call_output") msgs.push({ role: "tool", tool_call_id: it.call_id ?? "", content: it.output ?? "" });
    }
    const tools = (p.tools ?? [])
      .filter((t) => t.type === "function" && t.name)
      .map((t) => ({
        type: "function" as const,
        function: { name: t.name!, description: t.description ?? "", parameters: sxemaTozala(t.parameters ?? { type: "object", properties: {} }) as Record<string, unknown> },
      }));

    if (!this.model) this.model = await groqModelTanla(this.c);
    const r = await this.c.chat.completions.create({ model: this.model, messages: msgs, ...(tools.length ? { tools } : {}) });
    const m = r.choices[0]?.message;
    if (!m) throw new Error(`${aqlNomi(this.tur)} bo'sh javob qaytardi`);
    // ba'zi modellar chaqiruv id'sini bermaydi — tool javobini ulash uchun o'zimiz qo'yamiz
    const chaqiruvlar = (m.tool_calls ?? [])
      .filter((tc) => tc.type === "function")
      .map((tc) => ({ ...tc, id: tc.id || `chq_${randomUUID().slice(0, 8)}` }));
    msgs.push({ role: "assistant", content: m.content ?? "", ...(chaqiruvlar.length ? { tool_calls: chaqiruvlar } : {}) });

    const id = `aql_${randomUUID()}`;
    this.tarix.set(id, msgs);
    if (this.tarix.size > 200) this.tarix.delete(this.tarix.keys().next().value!);

    const matn = (m.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return {
      id,
      output: chaqiruvlar.map((tc) => ({ type: "function_call", call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments || "{}" })),
      output_text: sxema ? jsonAjrat(matn) : matn,
    };
  }
}

// Ulanishlar'dagi «Sinab ko'rish»: tanlangan manbaning o'zi (zaxirasiz) javob beradimi
export async function aqlSinov(tur: AqlTur, groqKalit?: string) {
  const c = mijozi(tur, groqKalit);
  if (!c)
    throw new Error(
      { gemini: "Serverda GEMINI_API_KEY yo'q", groq: "Groq kaliti kiritilmagan", umid: "Umid AI manzili kiritilmagan", chatgpt: "ChatGPT kaliti yo'q" }[tur],
    );
  const r = (await (c.responses.create as (x: unknown) => Promise<{ output_text: string }>)({
    model: "gpt-5-mini",
    instructions: "Siz Miya'siz. O'zbek tilida qisqa javob bering.",
    input: "Salom! Bitta qisqa jumla bilan salomlashing.",
  })) as { output_text: string };
  return r.output_text.trim().slice(0, 300);
}
