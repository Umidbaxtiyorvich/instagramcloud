import { after } from "next/server";
import { prisma } from "@/lib/db";
import { openai } from "@/lib/ofis-openai";
import { imzoTogri, maydonlar, tw, twiml } from "@/lib/twilio";
import { STATIK, gapir, salomMatni, gapirStatik, suhbatOl, tingla, tugmaJavob, twimlUrl, xesh } from "@/lib/miya-telefon";

// Twilio qo'ng'iroq davomida shu yerga keladi. b — bosqich:
// boshla (Miya gapiradi) → eshit (yozuv keldi) → kut (javob tayyorlanmoqda) → yana eshit … ; pin, tasdiq
export const maxDuration = 120;

export async function POST(req: Request) {
  const f = await maydonlar(req);
  if (!imzoTogri(req, f)) return new Response("Imzo noto'g'ri", { status: 403 });
  const u = new URL(req.url).searchParams;
  const q = await prisma.qongiroq.findUnique({ where: { id: u.get("q") ?? "" } });
  if (!q || q.kalit !== u.get("k")) return twiml(tw.hangup());
  const b = u.get("b");
  const s = suhbatOl(q);
  const oxirgi = s.length - 1;
  const tingla_ = () => [tw.record(twimlUrl(q, "eshit")), gapirStatik(q, "xayr"), tw.hangup()];

  if (b === "tasdiq") {
    await prisma.qongiroq.update({ where: { id: q.id }, data: { holat: "gaplashmoqda" } });
    return twiml(gapir(q, 0, s[0]?.matn ?? ""), tw.hangup());
  }

  if (b === "boshla") {
    await prisma.qongiroq.update({ where: { id: q.id }, data: { holat: "gaplashmoqda" } });
    // OpenAI'siz gapni eshitib bo'lmaydi — faqat tugma (taklif bo'lsa) yoki xabarni aytib qo'yish
    if (!openai()) {
      if (q.fikrId) return twiml(tw.pin(twimlUrl(q, "eshit"), tw.say(s[0].matn)), tw.hangup());
      return twiml(tw.say(s[0].matn), tw.hangup());
    }
    return twiml(gapir(q, 0, s[0].matn), ...tingla_());
  }

  if (b === "pin") {
    const s0 = await prisma.miyaSozlama.findUnique({ where: { userId: q.userId } });
    if (!s0?.telefonPin || xesh(q.userId, `pin:${(f.Digits ?? "").trim()}`) !== s0.telefonPin) {
      await prisma.qongiroq.update({ where: { id: q.id }, data: { holat: "xato", sabab: "⚠️ PIN noto'g'ri terildi" } });
      return twiml(gapirStatik(q, "pinXato"), tw.hangup());
    }
    const salom = await salomMatni(q.userId);
    const yangi = await prisma.qongiroq.update({ where: { id: q.id }, data: { pinOtdi: true, holat: "gaplashmoqda", suhbat: JSON.stringify([{ kim: "miya", matn: salom }]) } });
    return twiml(gapir(yangi, 0, salom), ...tingla_());
  }

  // pin kiritilmagan kiruvchi qo'ng'iroq boshqa bosqichga o'tolmaydi
  if (q.yonalish === "kiruvchi" && !q.pinOtdi) return twiml(tw.hangup());

  if (b === "eshit") {
    const raqam = (f.Digits ?? "").replace(/[^0-9]/g, "");
    if (q.fikrId && (raqam === "1" || raqam === "2")) {
      const yangi = await tugmaJavob(q, raqam);
      const s2 = suhbatOl(yangi);
      if (!openai()) return twiml(tw.say(s2[s2.length - 1].matn), tw.hangup());
      return twiml(gapir(yangi, s2.length - 1, s2[s2.length - 1].matn), ...tingla_());
    }
    if (!f.RecordingUrl || !openai()) return twiml(gapirStatik(q, "xayr"), tw.hangup());
    await prisma.qongiroq.update({ where: { id: q.id }, data: { kutish: true } });
    after(() => tingla(q.id, f.RecordingUrl, f.RecordingSid ?? ""));
    return twiml(gapirStatik(q, "kut"), tw.redirect(twimlUrl(q, "kut", 1)));
  }

  if (b === "kut") {
    const n = Number(u.get("n") ?? 1);
    if (q.kutish) {
      if (n < 20) return twiml(tw.pause(2), tw.redirect(twimlUrl(q, "kut", n + 1)));
      await prisma.qongiroq.update({ where: { id: q.id }, data: { tugat: true } });
      return twiml(gapirStatik(q, "kechikdi"), tw.hangup());
    }
    const javob = s[oxirgi];
    if (!javob || javob.kim !== "miya") return twiml(gapirStatik(q, "takrorla"), ...tingla_());
    if (q.tugat) return twiml(gapir(q, oxirgi, javob.matn), tw.hangup());
    return twiml(gapir(q, oxirgi, javob.matn), ...tingla_());
  }

  return twiml(gapir(q, "xayr", STATIK.xayr), tw.hangup());
}
