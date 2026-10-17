import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { openai } from "@/lib/ofis-openai";
import { gapniIshla, matnniIshla, salomMatni, suhbatOl, tokenEgasi, tugmaJavob, xatoGap } from "@/lib/miya-telefon";
import { botOtkazildi } from "@/lib/miya-bot";
import type { Qongiroq } from "@prisma/client";

// Bepul «qo'ng'iroq»: telefon brauzerida Miya bilan ovozli suhbat (Twilio'siz)
export const maxDuration = 120;

const MAX_OVOZ = 8 * 1024 * 1024;

const korinish = (q: Qongiroq) => ({
  id: q.id,
  kalit: q.kalit,
  yonalish: q.yonalish,
  holat: q.holat,
  sabab: q.sabab,
  fikrId: q.fikrId,
  tugat: q.tugat,
  suhbat: suhbatOl(q),
});

// Saytga kirgan bo'lsa — sessiya; Telegram botidagi havoladan kelsa — havoladagi kalit
async function egasi(req: Request) {
  const t = req.headers.get("x-qongiroq") ?? "";
  if (t) {
    const id = await tokenEgasi(t);
    if (id) return { id };
  }
  const user = await getSessionUser();
  return user ? { id: user.id } : null;
}

async function ol(userId: string, id: string) {
  const q = await prisma.qongiroq.findFirst({ where: { id, userId } });
  if (!q) throw new Error("Qo'ng'iroq topilmadi");
  return q;
}

export async function GET(req: Request) {
  const user = await egasi(req);
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  try {
    return NextResponse.json({ qongiroq: korinish(await ol(user.id, new URL(req.url).searchParams.get("q") ?? "")) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}

const Amal = z.discriminatedUnion("amal", [
  z.object({ amal: z.literal("boshla") }),
  z.object({ amal: z.literal("javob"), q: z.string().max(64) }),
  z.object({ amal: z.literal("tugma"), q: z.string().max(64), ha: z.boolean() }),
  z.object({ amal: z.literal("matn"), q: z.string().max(64), matn: z.string().trim().min(1).max(1000) }),
  z.object({ amal: z.literal("tugat"), q: z.string().max(64), rad: z.boolean().optional() }),
]);

export async function POST(req: Request) {
  const user = await egasi(req);
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  if (!openai()) return NextResponse.json({ error: "OPENAI_API_KEY yo'q — Miya ovoz bilan gaplasha olmaydi" }, { status: 400 });
  try {
    // ovozli gap: multipart (q + audio)
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const f = await req.formData();
      const q = await ol(user.id, String(f.get("q") ?? ""));
      const audio = f.get("audio");
      if (!(audio instanceof File) || !audio.size) throw new Error("Ovoz yo'q");
      if (audio.size > MAX_OVOZ) throw new Error("Ovoz juda uzun");
      const tur = audio.type.split(";")[0] || "audio/webm";
      const kengaytma = tur.includes("mp4") || tur.includes("m4a") ? "m4a" : tur.includes("ogg") ? "ogg" : tur.includes("wav") ? "wav" : "webm";
      let yangi: Qongiroq;
      try {
        yangi = await gapniIshla(q.id, new Uint8Array(await audio.arrayBuffer()), `gap.${kengaytma}`, tur);
      } catch (e) {
        console.error("telefon web:", e);
        const s = [...suhbatOl(q), xatoGap(e)];
        yangi = await prisma.qongiroq.update({ where: { id: q.id }, data: { suhbat: JSON.stringify(s) } });
      }
      if (yangi.tugat) yangi = await prisma.qongiroq.update({ where: { id: q.id }, data: { holat: "tugadi", tugadi: new Date() } });
      return NextResponse.json({ qongiroq: korinish(yangi) });
    }

    const p = Amal.safeParse(await req.json().catch(() => null));
    if (!p.success) return NextResponse.json({ error: "Ma'lumot noto'g'ri" }, { status: 400 });
    const a = p.data;
    if (a.amal === "boshla") {
      const salom = await salomMatni(user.id);
      const q = await prisma.qongiroq.create({
        data: { userId: user.id, yonalish: "kiruvchi", kanal: "web", kalit: randomToken(16), holat: "gaplashmoqda", suhbat: JSON.stringify([{ kim: "miya", matn: salom }]) },
      });
      return NextResponse.json({ qongiroq: korinish(q) });
    }
    const q = await ol(user.id, a.q);
    if (a.amal === "javob") {
      // o'tkazib yuborilgan qo'ng'iroqqa keyinroq ham javob berish mumkin
      const yangi =
        q.holat === "boshlandi" || q.holat === "javobsiz" ? await prisma.qongiroq.update({ where: { id: q.id }, data: { holat: "gaplashmoqda", tugadi: null } }) : q;
      return NextResponse.json({ qongiroq: korinish(yangi) });
    }
    if (a.amal === "matn") {
      let yangi: Qongiroq;
      try {
        yangi = await matnniIshla(q.id, a.matn);
      } catch (e) {
        console.error("telefon web:", e);
        yangi = await prisma.qongiroq.update({ where: { id: q.id }, data: { suhbat: JSON.stringify([...suhbatOl(q), { kim: "men", matn: a.matn }, xatoGap(e)]) } });
      }
      if (yangi.tugat) yangi = await prisma.qongiroq.update({ where: { id: q.id }, data: { holat: "tugadi", tugadi: new Date() } });
      return NextResponse.json({ qongiroq: korinish(yangi) });
    }
    if (a.amal === "tugma") return NextResponse.json({ qongiroq: korinish(await tugmaJavob(q, a.ha ? "1" : "2")) });
    const rad = a.rad && q.holat === "boshlandi";
    const yangi = await prisma.qongiroq.update({ where: { id: q.id }, data: { holat: rad ? "javobsiz" : "tugadi", tugadi: q.tugadi ?? new Date() } });
    // rad etilgan qo'ng'iroq botdagi tarixda qoladi
    if (rad && q.yonalish === "chiquvchi") await botOtkazildi(yangi);
    return NextResponse.json({ qongiroq: korinish(yangi) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Xato" }, { status: 400 });
  }
}
