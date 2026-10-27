import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { telegramYuborildi, tick } from "@/lib/miya";
import { qongiroqlar } from "@/lib/miya-telefon";
import { botXabar } from "@/lib/miya-bot";
import { runnerTekshir } from "@/lib/video-ish";

// Miya'ning tick'ini ikki joy chaqiradi:
// - Railway'dagi to'lov boti (TOLOV_BOT_API_KEY) — xabarlarni javobda oladi va o'zi Telegram'ga yuboradi;
// - GitHub'dagi uygoq.yml (OIDC tokeni, parolsiz) — xabarlarni Miya'ning o'z boti yuboradi.
export const maxDuration = 600;

let ishlayapti = false;

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
  if (ishlayapti) return NextResponse.json({ xabarlar: [], band: true });
  ishlayapti = true;
  try {
    // muhim gap bo'lsa — egasiga qo'ng'iroq (havolali qo'ng'iroq xabari shu tick'da Telegram'ga ketadi)
    await qongiroqlar().catch((e) => console.error("miya telefon:", e));
    const xabarlar = await tick();
    if (tolovBot) {
      await telegramYuborildi(xabarlar.map((x) => x.id));
      return NextResponse.json({ xabarlar: [...new Set(xabarlar.map((x) => x.matn))] });
    }
    const yetdi: string[] = [];
    for (const x of xabarlar) if (await botXabar(x.userId, x.matn)) yetdi.push(x.id);
    await telegramYuborildi(yetdi);
    return NextResponse.json({ yuborildi: yetdi.length, kutmoqda: xabarlar.length - yetdi.length });
  } catch (e) {
    console.error("miya tick:", e);
    return NextResponse.json({ xabarlar: [], error: e instanceof Error ? e.message : "xato" }, { status: 500 });
  } finally {
    ishlayapti = false;
  }
}

export const GET = ishla;
export const POST = ishla;
