import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { moliyaRuxsat } from "@/lib/ofis-moliya";
import { CLAUDE_KALIT, claudeKalitOrnat, claudeKalitSaytdan, claudeKalitYukla, claudeKaliti, claudeXatoMatni } from "@/lib/ofis-claude";

// AI Ofis «Ulanishlar» → Claude: agentlar ishlatadigan Anthropic kaliti (butun sayt uchun bitta).
// Kalitning o'zi brauzerga qaytmaydi — faqat oxirgi 4 belgisi. Almashtirishni faqat admin (MOLIYA_ADMIN_EMAILS) qiladi.

async function holat(email: string | null | undefined) {
  const yangilandi = await claudeKalitYukla().catch(() => null);
  const kalit = claudeKaliti();
  return {
    ulangan: Boolean(kalit),
    manba: claudeKalitSaytdan() ? "sayt" : kalit ? "server" : null,
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

  // saqlashdan oldin haqiqiy (eng kichik) so'rov: kalit to'g'riligi va hisobda pul borligi tekshiriladi
  try {
    await new Anthropic({ apiKey: kalit }).messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "salom" }],
    });
  } catch (e) {
    return NextResponse.json({ error: claudeXatoMatni(e) }, { status: 400 });
  }

  const qiymat = encryptSecret(kalit);
  await prisma.sozlama.upsert({ where: { kalit: CLAUDE_KALIT }, update: { qiymat }, create: { kalit: CLAUDE_KALIT, qiymat } });
  claudeKalitOrnat(kalit);
  return NextResponse.json(await holat(user.email));
}

// saytdagi kalitni o'chiradi — serverdagi ANTHROPIC_API_KEY (bo'lsa) yana ishlaydi
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  if (!moliyaRuxsat(user.email)) return NextResponse.json({ error: "Kalitni faqat admin almashtiradi" }, { status: 403 });
  await prisma.sozlama.deleteMany({ where: { kalit: CLAUDE_KALIT } });
  claudeKalitOrnat(null);
  return NextResponse.json(await holat(user.email));
}
