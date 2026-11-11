import { prisma } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { openai } from "@/lib/ofis-openai";
import { imzoTogri, maydonlar, raqamTozala, tw, twiml } from "@/lib/twilio";
import { gapirStatik, twimlUrl } from "@/lib/miya-telefon";

// Egasi Miya raqamiga qo'ng'iroq qildi. Raqam tasdiqlangan bo'lishi va PIN to'g'ri terilishi kerak.
export async function POST(req: Request) {
  const f = await maydonlar(req);
  if (!imzoTogri(req, f)) return new Response("Imzo noto'g'ri", { status: 403 });
  const kim = raqamTozala(f.From ?? "");
  const s = kim ? await prisma.miyaSozlama.findFirst({ where: { telefon: kim, telefonTasdiq: true } }) : null;
  if (!s) return twiml(tw.say("Salom. Bu raqam Miya'ga ulanmagan. Xayr."), tw.hangup());
  if (!openai()) return twiml(tw.say("Miya hozir telefonda gaplasha olmaydi: OpenAI kaliti sozlanmagan. Xayr."), tw.hangup());
  if (!s.telefonPin) return twiml(tw.say("Avval saytda, Miya, Telefon bo'limida PIN kod o'rnating. Xayr."), tw.hangup());
  const q = await prisma.qongiroq.create({
    data: { userId: s.userId, yonalish: "kiruvchi", kalit: randomToken(16), sid: f.CallSid || null, holat: "gaplashmoqda" },
  });
  return twiml(tw.pin(twimlUrl(q, "pin"), gapirStatik(q, "pin")), tw.hangup());
}
