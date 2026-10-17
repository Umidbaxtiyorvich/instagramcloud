import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sozlama } from "@/lib/miya";
import { openai } from "@/lib/ofis-openai";
import { miyaRaqami, raqamniSozla, twilioSozlangan } from "@/lib/twilio";
import { botBor, botSozla, ulashHavolasi } from "@/lib/miya-bot";
import { kodTekshir, kodYubor, miyaQongiroq, suhbatOl, xesh } from "@/lib/miya-telefon";

// Miya → Telefon sozlamalari: raqamni qo'ng'iroq bilan tasdiqlash, PIN, qachon qo'ng'iroq qilish, tarix
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const s = await sozlama(user.id);
  const qongiroqlar = await prisma.qongiroq.findMany({ where: { userId: user.id, yonalish: { not: "tasdiq" } }, orderBy: { createdAt: "desc" }, take: 15 });
  // bot webhook'ini birinchi ochilishda o'rnatib qo'yamiz
  const botXato = botBor() ? await botSozla().then(() => null).catch((e: Error) => e.message) : null;
  return NextResponse.json({
    bot: botBor(),
    botXato,
    telegram: Boolean(s.telegramChat),
    twilio: twilioSozlangan(),
    openai: Boolean(openai()),
    miyaRaqami: miyaRaqami(),
    telefon: s.telefon,
    tasdiq: s.telefonTasdiq,
    kodKutilmoqda: Boolean(s.telefonKod),
    pinBor: Boolean(s.telefonPin),
    rejim: s.qongiroqRejim,
    qongiroqlar: qongiroqlar.map((q) => ({
      id: q.id,
      kanal: q.kanal,
      yonalish: q.yonalish,
      holat: q.holat,
      sabab: q.sabab,
      suhbat: suhbatOl(q),
      createdAt: q.createdAt,
    })),
  });
}

const Amal = z.discriminatedUnion("amal", [
  z.object({ amal: z.literal("kod_yubor"), telefon: z.string().max(30) }),
  z.object({ amal: z.literal("kod"), kod: z.string().regex(/^\d{4}$/, "Kod 4 ta raqam") }),
  z.object({ amal: z.literal("pin"), pin: z.string().regex(/^\d{4,6}$/, "PIN 4-6 ta raqam") }),
  z.object({ amal: z.literal("rejim"), rejim: z.enum(["off", "xavf", "muhim"]) }),
  z.object({ amal: z.literal("sinov") }),
  z.object({ amal: z.literal("ochir") }),
  z.object({ amal: z.literal("telegram_ulash") }),
  z.object({ amal: z.literal("telegram_uz") }),
]);

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const p = Amal.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri" }, { status: 400 });
  const a = p.data;
  await sozlama(user.id);
  try {
    if (a.amal === "kod_yubor") {
      if (!twilioSozlangan()) throw new Error("Twilio sozlanmagan — Render'da TWILIO_* o'zgaruvchilarini qo'ying");
      const telefon = await kodYubor(user.id, a.telefon);
      // Miya raqamiga kelgan qo'ng'iroqlar shu saytga kelsin
      await raqamniSozla().catch((e) => console.error("twilio raqam:", e instanceof Error ? e.message : e));
      return NextResponse.json({ ok: true, telefon });
    }
    if (a.amal === "telegram_ulash") {
      if (!botBor()) throw new Error("Miya boti sozlanmagan — Render'ga MIYA_BOT_TOKEN qo'ying");
      return NextResponse.json({ ok: true, havola: await ulashHavolasi(user.id) });
    }
    if (a.amal === "telegram_uz") await prisma.miyaSozlama.update({ where: { userId: user.id }, data: { telegramChat: null } });
    else if (a.amal === "kod") await kodTekshir(user.id, a.kod);
    else if (a.amal === "pin") await prisma.miyaSozlama.update({ where: { userId: user.id }, data: { telefonPin: xesh(user.id, `pin:${a.pin}`) } });
    else if (a.amal === "rejim") await prisma.miyaSozlama.update({ where: { userId: user.id }, data: { qongiroqRejim: a.rejim } });
    else if (a.amal === "ochir")
      await prisma.miyaSozlama.update({ where: { userId: user.id }, data: { telefon: null, telefonTasdiq: false, telefonKod: null, telefonPin: null } });
    else {
      const oxirgi = await prisma.qongiroq.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
      if (oxirgi && Date.now() - oxirgi.createdAt.getTime() < 60_000) throw new Error("Bir daqiqadan keyin qayta urinib ko'ring");
      const q = await miyaQongiroq(
        user.id,
        twilioSozlangan()
          ? "Bu sinov qo'ng'irog'i: telefon ulandi, muhim gap bo'lsa shu raqamga qo'ng'iroq qilaman."
          : "Bu sinov qo'ng'irog'i: muhim gap bo'lsa shunday chaqiraman.",
      );
      return NextResponse.json({ ok: true, qongiroq: q.kanal === "web" ? q.id : undefined });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Xato" }, { status: 400 });
  }
}
