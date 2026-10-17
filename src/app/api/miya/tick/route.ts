import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { tick } from "@/lib/miya";
import { qongiroqlar } from "@/lib/miya-telefon";

// Railway'dagi bot har 10 daqiqada chaqiradi (serverni uyg'otib turadi). Kalit — bot bilan
// allaqachon umumiy bo'lgan TOLOV_BOT_API_KEY (botdagi API_KEY). Javob — Telegram'ga yuboriladigan xabarlar.
export const maxDuration = 600;

let ishlayapti = false;

function ruxsat(req: Request) {
  const kerak = process.env.TOLOV_BOT_API_KEY || "";
  const berilgan = req.headers.get("x-api-key") || "";
  if (!kerak || berilgan.length !== kerak.length) return false;
  return timingSafeEqual(Buffer.from(berilgan), Buffer.from(kerak));
}

async function ishla(req: Request) {
  if (!ruxsat(req)) return NextResponse.json({ error: "Ruxsat yo'q" }, { status: 401 });
  if (ishlayapti) return NextResponse.json({ xabarlar: [], band: true });
  ishlayapti = true;
  try {
    const xabarlar = await tick();
    // muhim gap bo'lsa — egasiga telefon qilish
    await qongiroqlar().catch((e) => console.error("miya telefon:", e));
    return NextResponse.json({ xabarlar });
  } catch (e) {
    console.error("miya tick:", e);
    return NextResponse.json({ xabarlar: [], error: e instanceof Error ? e.message : "xato" }, { status: 500 });
  } finally {
    ishlayapti = false;
  }
}

export const GET = ishla;
export const POST = ishla;
