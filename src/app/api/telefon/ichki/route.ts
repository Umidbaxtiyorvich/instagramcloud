import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { ichkiKalit, ruxsatRaqam, sessiyaOl, sessiyaSaqla, tgEgasi } from "@/lib/miya-tg";
import { gapYoz, jonliKontekst, matnniIshla, salomMatni, suhbatOl, vositaJavob, xatoGap } from "@/lib/miya-telefon";
import { botOtkazildi, botXabar } from "@/lib/miya-bot";
import { openaiKaliti } from "@/lib/ofis-openai";

// Faqat miya-tg (shu serverdagi Telegram qo'ng'iroq dasturi) uchun
export const maxDuration = 120;

const Amal = z.discriminatedUnion("amal", [
  z.object({ amal: z.literal("sessiya_ol") }),
  z.object({ amal: z.literal("sessiya_saqla"), sessiya: z.string().min(10).max(2000) }),
  z.object({ amal: z.literal("kiruvchi"), tgId: z.string().max(32), telefon: z.string().max(20).optional() }),
  z.object({ amal: z.literal("ruxsat") }),
  z.object({ amal: z.literal("openai_kalit") }),
  z.object({ amal: z.literal("gap"), q: z.string().max(64), matn: z.string().max(2000) }),
  z.object({ amal: z.literal("tugadi"), q: z.string().max(64) }),
  z.object({ amal: z.literal("javobsiz"), q: z.string().max(64), xato: z.string().max(300).optional() }),
  z.object({ amal: z.literal("izoh"), q: z.string().max(64), matn: z.string().max(300) }),
  z.object({ amal: z.literal("begona"), ism: z.string().max(200) }),
  z.object({ amal: z.literal("jonli_boshla"), q: z.string().max(64) }),
  z.object({ amal: z.literal("jonli_ish"), q: z.string().max(64), sorov: z.string().max(2000) }),
  z.object({ amal: z.literal("yoz"), q: z.string().max(64), kim: z.enum(["miya", "men"]), matn: z.string().max(2000) }),
]);

export async function POST(req: Request) {
  const kerak = ichkiKalit();
  const kelgan = req.headers.get("x-ichki") ?? "";
  if (kelgan.length !== kerak.length || !timingSafeEqual(Buffer.from(kelgan), Buffer.from(kerak))) {
    return NextResponse.json({ error: "Ruxsat yo'q" }, { status: 401 });
  }
  const p = Amal.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Ma'lumot noto'g'ri" }, { status: 400 });
  const a = p.data;

  if (a.amal === "sessiya_ol") return NextResponse.json({ sessiya: await sessiyaOl() });
  if (a.amal === "sessiya_saqla") {
    await sessiyaSaqla(a.sessiya);
    return NextResponse.json({ ok: true });
  }

  // begona odam Miya akkauntiga qo'ng'iroq qilyapti — Miya ko'tarmaydi, egasiga aytadi
  if (a.amal === "begona") {
    const egasi = await tgEgasi();
    if (egasi) await botXabar(egasi, `📞 ${a.ism} Miya raqamiga (Telegram) qo'ng'iroq qilyapti — Miya akkaunti ochilgan telefonda ko'tarishingiz mumkin.`);
    return NextResponse.json({ ok: true });
  }

  // egasi Miya akkauntiga o'zi qo'ng'iroq qildi (shaxsiy chatda chat id = foydalanuvchi id)
  if (a.amal === "ruxsat") return NextResponse.json({ telefon: await ruxsatRaqam() });

  // «Ulanishlar»da almashtirilgan ChatGPT kaliti (miya-tg ovoz va jonli suhbat uchun)
  if (a.amal === "openai_kalit") return NextResponse.json({ kalit: openaiKaliti() });

  if (a.amal === "kiruvchi") {
    // faqat egasining raqamidan kelgan qo'ng'iroqni ko'taradi (raqam berilgan bo'lsa — qat'iy shu raqam)
    const ruxsat = (await ruxsatRaqam()).replace(/\D/g, "");
    let s = null;
    if (ruxsat) {
      const egasi = (a.telefon ?? "").replace(/\D/g, "") === ruxsat ? await tgEgasi() : null;
      s = egasi ? await prisma.miyaSozlama.findUnique({ where: { userId: egasi } }) : null;
    } else {
      s = await prisma.miyaSozlama.findUnique({ where: { telegramChat: a.tgId } });
    }
    if (!s) return NextResponse.json({ error: "Bu odam Miya'ga ulanmagan" }, { status: 404 });
    const salom = await salomMatni(s.userId);
    const q = await prisma.qongiroq.create({
      data: { userId: s.userId, yonalish: "kiruvchi", kanal: "tgcall", kalit: randomToken(16), holat: "gaplashmoqda", suhbat: JSON.stringify([{ kim: "miya", matn: salom }]) },
    });
    return NextResponse.json({ q: q.id, salom });
  }

  const q = await prisma.qongiroq.findUnique({ where: { id: a.q } });
  if (!q) return NextResponse.json({ error: "Qo'ng'iroq topilmadi" }, { status: 404 });

  // Realtime (jonli ovoz) suhbati: boshida kontekst, o'rtada ma'lumot/ish so'rovlari, gaplar tarixga
  if (a.amal === "jonli_boshla") {
    if (q.holat === "boshlandi") await prisma.qongiroq.update({ where: { id: q.id }, data: { holat: "gaplashmoqda" } });
    return NextResponse.json({ kontekst: await jonliKontekst(q.id) });
  }
  if (a.amal === "jonli_ish") {
    try {
      return NextResponse.json({ javob: await vositaJavob(q.id, a.sorov) });
    } catch (e) {
      console.error("miya-tg jonli_ish:", e);
      return NextResponse.json({ javob: `Xatolik: ${e instanceof Error ? e.message.slice(0, 200) : "noma'lum"}` });
    }
  }
  if (a.amal === "yoz") {
    await gapYoz(q.id, a.kim, a.matn);
    return NextResponse.json({ ok: true });
  }

  // texnik qayd: Telefon bo'limidagi qo'ng'iroq tarixida ko'rinadi
  if (a.amal === "izoh") {
    await prisma.qongiroq.update({ where: { id: q.id }, data: { sabab: `${q.sabab}\n${a.matn}`.trim().slice(-3000) } });
    return NextResponse.json({ ok: true });
  }

  if (a.amal === "gap") {
    if (q.holat === "boshlandi") await prisma.qongiroq.update({ where: { id: q.id }, data: { holat: "gaplashmoqda" } });
    try {
      const yangi = await matnniIshla(q.id, a.matn);
      const s = suhbatOl(yangi);
      return NextResponse.json({ javob: s[s.length - 1]?.matn ?? "", tugat: yangi.tugat });
    } catch (e) {
      console.error("miya-tg gap:", e);
      const x = xatoGap(e);
      await prisma.qongiroq.update({ where: { id: q.id }, data: { suhbat: JSON.stringify([...suhbatOl(q), { kim: "men", matn: a.matn }, x]) } });
      return NextResponse.json({ javob: x.matn, tugat: false });
    }
  }

  if (a.amal === "tugadi") {
    await prisma.qongiroq.update({ where: { id: q.id }, data: { holat: q.holat === "javobsiz" || q.holat === "xato" ? q.holat : "tugadi", tugadi: new Date() } });
    return NextResponse.json({ ok: true });
  }

  // ko'tarilmadi — Miya o'zi qilgan qo'ng'iroq bo'lsa, botda tarix bo'lib qoladi
  const yangi = await prisma.qongiroq.update({
    where: { id: q.id },
    data: { holat: "javobsiz", tugadi: new Date(), ...(a.xato ? { sabab: `${q.sabab}\n⚠️ ${a.xato}`.trim() } : {}) },
  });
  if (q.yonalish === "chiquvchi") await botOtkazildi(yangi);
  return NextResponse.json({ ok: true });
}
