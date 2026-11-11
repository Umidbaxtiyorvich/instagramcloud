import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { moliyaRuxsat } from "@/lib/ofis-moliya";
import { openai, openaiXatoMatni } from "@/lib/ofis-openai";
import { encryptSecret } from "@/lib/crypto";
import { AQL_TANLOV, AQL_TURLARI, GROQ_KALIT, UMID_URL, aqlSinov, aqlSozlama, aqlTanlovi, aqlYukla, geminiBor, type AqlTur } from "@/lib/ofis-aql";

// AI Ofis «Ulanishlar» → Miya'ning AI'si: Gemini yoki Groq (bepul), Umid AI (egasining kompyuteri) yoki ChatGPT.
// Groq kalitining o'zi brauzerga qaytmaydi — faqat oxirgi 4 belgisi.
// Tanlashni faqat admin (MOLIYA_ADMIN_EMAILS) qiladi.

async function holat(email: string | null | undefined) {
  await aqlYukla().catch(() => null);
  const s = aqlSozlama();
  return {
    tanlov: aqlTanlovi(),
    gemini: geminiBor(),
    chatgpt: Boolean(openai()),
    umidUrl: s.umidUrl,
    groq: s.groqKalit ? s.groqKalit.slice(-4) : null,
    ruxsat: moliyaRuxsat(email),
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  return NextResponse.json(await holat(user.email));
}

const Sorov = z.object({
  tanlov: z.enum(AQL_TURLARI as unknown as [AqlTur, ...AqlTur[]]).optional(),
  // Cloudflare tunnel manzili (https://...trycloudflare.com); bo'sh satr — o'chirish
  umidUrl: z.string().trim().max(300).optional(),
  // console.groq.com → API Keys (gsk_...); bo'sh satr — o'chirish
  groqKalit: z.string().trim().max(300).optional(),
  sinov: z.enum(AQL_TURLARI as unknown as [AqlTur, ...AqlTur[]]).optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  if (!moliyaRuxsat(user.email)) return NextResponse.json({ error: "Faqat admin o'zgartiradi" }, { status: 403 });
  const p = Sorov.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 });
  const { tanlov, umidUrl, groqKalit, sinov } = p.data;

  if (groqKalit !== undefined) {
    if (groqKalit) {
      // saqlashdan oldin haqiqiy so'rov — kalit ishlaydimi
      try {
        await aqlSinov("groq", groqKalit);
      } catch (e) {
        return NextResponse.json({ ...(await holat(user.email)), error: `Groq: ${openaiXatoMatni(e)}` }, { status: 400 });
      }
      const qiymat = encryptSecret(groqKalit);
      await prisma.sozlama.upsert({ where: { kalit: GROQ_KALIT }, update: { qiymat }, create: { kalit: GROQ_KALIT, qiymat } });
    } else {
      await prisma.sozlama.deleteMany({ where: { kalit: GROQ_KALIT } });
    }
  }

  if (umidUrl !== undefined) {
    if (umidUrl) {
      let u: URL;
      try {
        u = new URL(umidUrl);
      } catch {
        return NextResponse.json({ error: "Manzil noto'g'ri — https://... ko'rinishida bo'lsin" }, { status: 400 });
      }
      if (u.protocol !== "https:") return NextResponse.json({ error: "Manzil https:// bilan boshlansin" }, { status: 400 });
      const toza = u.origin;
      // Ollama javob beradimi — kompyuter yoniq va tunnel ishlayaptimi
      try {
        const r = await fetch(`${toza}/api/tags`, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        return NextResponse.json(
          { error: `Umid AI javob bermadi (${e instanceof Error ? e.message : "xato"}) — kompyuterda «miyaga_ulash.bat» ishlab turibdimi?` },
          { status: 400 },
        );
      }
      await prisma.sozlama.upsert({ where: { kalit: UMID_URL }, update: { qiymat: toza }, create: { kalit: UMID_URL, qiymat: toza } });
    } else {
      await prisma.sozlama.deleteMany({ where: { kalit: UMID_URL } });
    }
  }
  if (tanlov) await prisma.sozlama.upsert({ where: { kalit: AQL_TANLOV }, update: { qiymat: tanlov }, create: { kalit: AQL_TANLOV, qiymat: tanlov } });
  await aqlYukla();

  let javob: string | null = null;
  if (sinov) {
    try {
      javob = await aqlSinov(sinov);
    } catch (e) {
      return NextResponse.json({ ...(await holat(user.email)), error: openaiXatoMatni(e) }, { status: 400 });
    }
  }
  return NextResponse.json({ ...(await holat(user.email)), javob });
}
