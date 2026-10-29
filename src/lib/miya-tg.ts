import { createHash } from "crypto";
import { prisma } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";

// Sayt ↔ miya-tg (Python, shu serverda yonma-yon): Miya'ning Telegram akkaunti orqali haqiqiy qo'ng'iroqlar.
// U 127.0.0.1:MIYA_TG_PORT da tinglaydi; bizga /api/telefon/ichki orqali yozadi. Kalit ikkalasida bir xil.

export const ichkiKalit = () => createHash("sha256").update(`${process.env.AUTH_SECRET || "dev-auth-secret-change-me-please"}:ichki`).digest("hex");

export const tgSozlangan = () => Boolean(process.env.TG_API_ID?.trim() && process.env.TG_API_HASH?.trim());

const manzil = () => `http://127.0.0.1:${process.env.MIYA_TG_PORT || "8790"}`;

async function tg<T>(yol: string, body?: unknown, ms = 15_000): Promise<T> {
  const r = await fetch(`${manzil()}${yol}`, {
    method: body ? "POST" : "GET",
    headers: { "x-ichki": ichkiKalit(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(ms),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export type TgHolat = { sozlangan: boolean; ishlayapti: boolean; ulangan: boolean; men: string; kodKutilmoqda: boolean };

export async function tgHolat(): Promise<TgHolat> {
  if (!tgSozlangan()) return { sozlangan: false, ishlayapti: false, ulangan: false, men: "", kodKutilmoqda: false };
  try {
    const j = await tg<{ ulangan: boolean; men: string; kodKutilmoqda: boolean }>("/holat", undefined, 3000);
    return { sozlangan: true, ishlayapti: true, ...j };
  } catch {
    return { sozlangan: true, ishlayapti: false, ulangan: false, men: "", kodKutilmoqda: false };
  }
}

export const tgKod = (telefon: string) => tg<{ ok: true }>("/kod", { telefon }, 30_000);
export const tgKirish = (kod: string, parol?: string) => tg<{ ok: true; men: string }>("/kirish", { kod, parol }, 60_000);
export const tgQongiroq = (tgId: string, q: string, matn: string) => tg<{ ok: true }>("/qongiroq", { tgId, q, matn });

// Miya akkaunti sessiyasi bazada shifrlangan holda turadi (server qayta ishga tushsa ham qayta kirish shart emas)
const SESSIYA = "miya_tg_sessiya";

export async function sessiyaOl() {
  const r = await prisma.sozlama.findUnique({ where: { kalit: SESSIYA } });
  if (!r) return null;
  try {
    return decryptSecret(r.qiymat);
  } catch {
    return null;
  }
}

export async function sessiyaSaqla(sessiya: string) {
  const qiymat = encryptSecret(sessiya);
  await prisma.sozlama.upsert({ where: { kalit: SESSIYA }, update: { qiymat }, create: { kalit: SESSIYA, qiymat } });
}

// Egasi Miya akkauntiga tayyormi: akkaunt ulangan va egasining Telegram'i botga bog'langan
export async function tgTayyor(userId: string) {
  const s = await prisma.miyaSozlama.findUnique({ where: { userId }, select: { telegramChat: true } });
  if (!s?.telegramChat || !tgSozlangan()) return null;
  const h = await tgHolat();
  return h.ulangan ? s.telegramChat : null;
}

// Miya akkauntini kim ulagan — begona qo'ng'iroqlar haqida shunga xabar boradi
const EGASI = "miya_tg_egasi";
export async function tgEgasiSaqla(userId: string) {
  await prisma.sozlama.upsert({ where: { kalit: EGASI }, update: { qiymat: userId }, create: { kalit: EGASI, qiymat: userId } });
}
export async function tgEgasi() {
  const r = await prisma.sozlama.findUnique({ where: { kalit: EGASI } });
  if (r) return r.qiymat;
  // eski ulanishlar uchun: botga bog'langan birinchi ega
  const s = await prisma.miyaSozlama.findFirst({ where: { telegramChat: { not: null } }, select: { userId: true } });
  return s?.userId ?? null;
}

// Miya faqat shu raqamdagi Telegram'dan kelgan qo'ng'iroqni ko'taradi (Telefon bo'limida o'zgartiriladi)
const RUXSAT = "miya_tg_ruxsat";
export async function ruxsatRaqam() {
  return (await prisma.sozlama.findUnique({ where: { kalit: RUXSAT } }))?.qiymat ?? "";
}
export async function ruxsatSaqla(telefon: string) {
  if (!telefon) return prisma.sozlama.deleteMany({ where: { kalit: RUXSAT } });
  await prisma.sozlama.upsert({ where: { kalit: RUXSAT }, update: { qiymat: telefon }, create: { kalit: RUXSAT, qiymat: telefon } });
}
