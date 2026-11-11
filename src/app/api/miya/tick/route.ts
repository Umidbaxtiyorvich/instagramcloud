import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { miyaTickYubor } from "@/lib/miya-tick";
import { runnerTekshir } from "@/lib/video-ish";

// Miya'ning tick'ini server o'zi har 10 daqiqada yurgizadi (instrumentation.ts). Bu manzil tashqi chaqiruvlar uchun:
// - Railway'dagi to'lov boti (TOLOV_BOT_API_KEY) — xabarlarni javobda oladi va o'zi Telegram'ga yuboradi;
// - GitHub'dagi uygoq.yml (OIDC tokeni, parolsiz) — xabarlarni Miya'ning o'z boti yuboradi.
export const maxDuration = 600;

function botKaliti(req: Request) {
  const kerak = process.env.TOLOV_BOT_API_KEY || "";
  const berilgan = req.headers.get("x-api-key") || "";
  if (!kerak || berilgan.length !== kerak.length) return false;
  return timingSafeEqual(Buffer.from(berilgan), Buffer.from(kerak));
}

async function ishla(req: Request) {
  const tolovBot = botKaliti(req);
  if (!tolovBot) {
    try {
      await runnerTekshir(req, "uygoq.yml");
    } catch {
      return NextResponse.json({ error: "Ruxsat yo'q" }, { status: 401 });
    }
  }
  try {
    const r = await miyaTickYubor(tolovBot ? "qaytar" : "bot");
    return NextResponse.json("band" in r ? { xabarlar: [], band: true } : r);
  } catch (e) {
    console.error("miya tick:", e);
    return NextResponse.json({ xabarlar: [], error: e instanceof Error ? e.message : "xato" }, { status: 500 });
  }
}

export const GET = ishla;
export const POST = ishla;
