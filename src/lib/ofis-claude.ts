import Anthropic from "@anthropic-ai/sdk";

// AI Ofis agentlari uchun Claude (Anthropic) kaliti — ChatGPT kaliti bilan bir xil yo'l (ofis-openai.ts):
// «Ulanishlar»da almashtiriladi, bazada shifrlangan turadi; yo'q bo'lsa — serverdagi ANTHROPIC_API_KEY.
export const CLAUDE_KALIT = "anthropic_kalit";
const g = globalThis as { __claudeKalit?: string; __claudeMijoz?: { kalit: string; mijoz: Anthropic } };

export const claudeKaliti = () =>
  g.__claudeKalit || process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim() || "";
export const claudeKalitSaytdan = () => Boolean(g.__claudeKalit);

export function claudeKalitOrnat(kalit: string | null) {
  g.__claudeKalit = kalit || undefined;
}

export async function claudeKalitYukla() {
  const { prisma } = await import("./db");
  const { decryptSecret } = await import("./crypto");
  const r = await prisma.sozlama.findUnique({ where: { kalit: CLAUDE_KALIT } });
  let kalit: string | null = null;
  try {
    kalit = r ? decryptSecret(r.qiymat) : null;
  } catch {
    kalit = null;
  }
  claudeKalitOrnat(kalit);
  return r?.yangilandi ?? null;
}

export function claude() {
  if (g.__claudeKalit) {
    if (g.__claudeMijoz?.kalit !== g.__claudeKalit) g.__claudeMijoz = { kalit: g.__claudeKalit, mijoz: new Anthropic({ apiKey: g.__claudeKalit }) };
    return g.__claudeMijoz.mijoz;
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  // serverdagi sozlama: SDK o'zi ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN ni o'qiydi
  if (g.__claudeMijoz?.kalit !== "") g.__claudeMijoz = { kalit: "", mijoz: new Anthropic() };
  return g.__claudeMijoz.mijoz;
}

export function claudeXatoMatni(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (/credit balance/i.test(m)) return "Claude hisobida pul (kredit) qolmagan — Claude Konsol → Billing'da to'ldiring";
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "Anthropic bu kalitni qabul qilmadi";
  if (e instanceof Anthropic.RateLimitError) return "Claude hozir band (so'rovlar chegarasi) — bir daqiqadan keyin qayta urining";
  return m.slice(0, 160);
}
