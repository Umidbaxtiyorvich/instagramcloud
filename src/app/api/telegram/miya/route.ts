import { after } from "next/server";
import { timingSafeEqual } from "crypto";
import { botBor, botSiri, botYangilanish } from "@/lib/miya-bot";

// Miya Telegram botining webhook'i. Telegram tez javob kutadi — ish javobdan keyin bajariladi.
export const maxDuration = 120;

export async function POST(req: Request) {
  const kerak = botSiri();
  const kelgan = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!botBor() || kelgan.length !== kerak.length || !timingSafeEqual(Buffer.from(kelgan), Buffer.from(kerak))) {
    return new Response("Ruxsat yo'q", { status: 401 });
  }
  const u = await req.json().catch(() => null);
  if (u) after(() => botYangilanish(u).catch((e) => console.error("miya bot:", e)));
  return new Response("ok");
}
