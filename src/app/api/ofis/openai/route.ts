import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { moliyaRuxsat } from "@/lib/ofis-moliya";
import { OPENAI_KALIT, openaiKalitOrnat, openaiKalitSaytdan, openaiKalitYukla, openaiKaliti } from "@/lib/ofis-openai";

// AI Ofis «Ulanishlar» → ChatGPT: Miya va agentlar ishlatadigan OpenAI kaliti (butun sayt uchun bitta).
// Kalitning o'zi brauzerga qaytmaydi — faqat oxirgi 4 belgisi. Almashtirishni faqat admin (MOLIYA_ADMIN_EMAILS) qiladi.

async function holat(email: string | null | undefined) {
  const yangilandi = await openaiKalitYukla().catch(() => null);
  const kalit = openaiKaliti();
  return {
    ulangan: Boolean(kalit),
    manba: openaiKalitSaytdan() ? "sayt" : kalit ? "server" : null,
    oxiri: kalit ? kalit.slice(-4) : null,
    yangilandi,
    ruxsat: moliyaRuxsat(email),
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  return NextResponse.json(await holat(user.email));
}

const Kalit = z.object({ kalit: z.string().trim().min(20).max(400) });

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  if (!moliyaRuxsat(user.email)) return NextResponse.json({ error: "Kalitni faqat admin almashtiradi" }, { status: 403 });
  const p = Kalit.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Kalit noto'g'ri ko'rinishda" }, { status: 400 });
  const { kalit } = p.data;

  // saqlashdan oldin OpenAI'da tekshiramiz — ishlamaydigan kalit Miyani to'xtatib qo'ymasin
  try {
    await new OpenAI({ apiKey: kalit }).models.list();
  } catch (e) {
    const xato = e instanceof OpenAI.AuthenticationError ? "OpenAI bu kalitni qabul qilmadi" : `OpenAI bilan tekshirib bo'lmadi: ${(e as Error).message}`;
    return NextResponse.json({ error: xato }, { status: 400 });
  }

  const qiymat = encryptSecret(kalit);
  await prisma.sozlama.upsert({ where: { kalit: OPENAI_KALIT }, update: { qiymat }, create: { kalit: OPENAI_KALIT, qiymat } });
  openaiKalitOrnat(kalit);
  return NextResponse.json(await holat(user.email));
}

// saytdagi kalitni o'chiradi — serverdagi OPENAI_API_KEY (bo'lsa) yana ishlaydi
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  if (!moliyaRuxsat(user.email)) return NextResponse.json({ error: "Kalitni faqat admin almashtiradi" }, { status: 403 });
  await prisma.sozlama.deleteMany({ where: { kalit: OPENAI_KALIT } });
  openaiKalitOrnat(null);
  return NextResponse.json(await holat(user.email));
}
