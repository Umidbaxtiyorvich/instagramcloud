import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { openai, openaiModel } from "@/lib/ofis-openai";
import { aql } from "@/lib/ofis-aql";

// ChatGPT eksportidan foydalanuvchi profili. ZIP brauzerda ochiladi; bu yerga faqat
// foydalanuvchining o'z xabarlari (va saqlangan xotiralar bo'lsa) keladi, profil shulardan yoziladi.
export const maxDuration = 300;

const Kirish = z.object({
  xotiralar: z.array(z.string().max(2000)).max(500).default([]),
  xabarlar: z.array(z.string().max(4000)).max(3000),
  sarlavhalar: z.array(z.string().max(200)).max(3000).default([]),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const client = aql();
  if (!client) return NextResponse.json({ error: "AI ulanmagan — profilni yozib bo'lmaydi" }, { status: 400 });
  const p = Kirish.safeParse(await req.json().catch(() => null));
  if (!p.success || (!p.data.xabarlar.length && !p.data.xotiralar.length)) {
    return NextResponse.json({ error: "Faylda xabarlar topilmadi" }, { status: 400 });
  }
  const { xotiralar, xabarlar, sarlavhalar } = p.data;
  // ~250 ming belgigacha (eng yangilari birinchi keladi)
  let hajm = 0;
  const tanlangan: string[] = [];
  for (const x of xabarlar) {
    if (hajm + x.length > 250_000) break;
    tanlangan.push(x);
    hajm += x.length;
  }
  try {
    const r = await client.responses.create({
      model: openaiModel(),
      instructions:
        "Sizga bir odamning ChatGPT bilan yozishmalaridan uning O'Z xabarlari, suhbat sarlavhalari va ChatGPT saqlagan xotiralari beriladi. " +
        "Shulardan uning AI yordamchisi uchun profil yozing — o'zbek tilida (lotin), 2500-4000 belgi, bo'limlar bilan:\n" +
        "1) Kim: ismi, joyi, tillari, kasbi; 2) Biznes: nima sotadi/qiladi, mahsulotlar, mijozlar, jamoa, ishlatadigan tizimlar; " +
        "3) Maqsadlar va hozirgi loyihalar; 4) Muloqot uslubi: qanday javob yoqadi (qisqa/batafsil, til, ohang); " +
        "5) Instagram va marketing: auditoriya, mavzular, uslub; 6) Muhim afzalliklar va 'qilmaslik kerak' narsalar.\n" +
        "Faqat matnda aniq ko'ringan narsalarni yozing, taxmin qilmang. Parollar, karta raqamlari, tokenlar, telefon/manzil kabi maxfiy ma'lumotlarni YOZMANG.",
      input: [
        xotiralar.length ? `ChatGPT saqlagan xotiralar:\n${xotiralar.map((x) => `- ${x}`).join("\n")}` : "",
        sarlavhalar.length ? `Suhbat sarlavhalari:\n${sarlavhalar.slice(0, 800).join("; ")}` : "",
        `Uning xabarlari (eng yangisi birinchi):\n${tanlangan.map((x) => `— ${x}`).join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    const profil = r.output_text.trim().slice(0, 8000);
    if (!profil) throw new Error("Profil bo'sh chiqdi");
    await prisma.xotira.upsert({
      where: { userId: user.id },
      update: { profil, manba: "chatgpt", yangilandi: new Date() },
      create: { userId: user.id, profil, manba: "chatgpt" },
    });
    return NextResponse.json({ ok: true, profil, xabarlarSoni: tanlangan.length });
  } catch (e) {
    console.error("miya xotira:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Profil yozilmadi" }, { status: 502 });
  }
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  await prisma.xotira.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ ok: true });
}
