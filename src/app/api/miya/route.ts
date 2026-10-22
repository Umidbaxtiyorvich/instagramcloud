import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { instagramTekshir, moliyaTekshir, rejaQosh, sozlama } from "@/lib/miya";
import { moliyaRuxsat } from "@/lib/ofis-moliya";
import { cloudshopSozlangan } from "@/lib/cloudshop";
import { listUploads } from "@/lib/uploads";
import { MUSTAQILLIK, fikrla, ishonchHisobi, qaror } from "@/lib/miya-fikr";

// AI Ofis «Miya» paneli: ogohlantirishlar, avtomatik Reels sozlamasi, rejadagi postlar, xotira holati
export const maxDuration = 300;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const [s, xabarlar, rejalar, xotira, uploads, fikrlar, ishonch] = await Promise.all([
    sozlama(user.id),
    prisma.miyaXabar.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 60 }),
    prisma.rejaPost.findMany({
      where: { userId: user.id, OR: [{ holat: { in: ["kutmoqda", "joylanmoqda"] } }, { vaqt: { gte: new Date(Date.now() - 3 * 86400_000) } }] },
      orderBy: { vaqt: "asc" },
      take: 40,
    }),
    prisma.xotira.findUnique({ where: { userId: user.id } }),
    listUploads(user.id),
    prisma.miyaFikr.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 40 }),
    ishonchHisobi(user.id),
  ]);
  return NextResponse.json({
    sozlama: {
      autoReels: s.autoReels,
      reelsVaqtlari: s.reelsVaqtlari,
      reelsBrend: s.reelsBrend,
      reelsFooter: s.reelsFooter,
      kamQoldiq: s.kamQoldiq,
      qarzKunlari: s.qarzKunlari,
      oxirgiMoliya: s.oxirgiMoliya,
      oxirgiInstagram: s.oxirgiInstagram,
      mustaqillik: s.mustaqillik,
      oxirgiFikr: s.oxirgiFikr,
      qoidalar: s.qoidalar,
    },
    fikrlar,
    ishonch,
    moliya: moliyaRuxsat(user.email) && cloudshopSozlangan(),
    chatgpt: Boolean(process.env.OPENAI_API_KEY),
    xabarlar,
    rejalar,
    xotira: xotira ? { yangilandi: xotira.yangilandi, profil: xotira.profil } : null,
    uploads: uploads.filter((u) => u.available && !u.publishedId),
  });
}

const Sozla = z.object({
  autoReels: z.boolean().optional(),
  reelsVaqtlari: z
    .string()
    .trim()
    .regex(/^(\s*\d{1,2}:\d{2}\s*)(,\s*\d{1,2}:\d{2}\s*){0,3}$/, "Vaqtlar «10:00,19:00» ko'rinishida")
    .optional(),
  reelsBrend: z.string().trim().max(60).optional(),
  reelsFooter: z.string().trim().max(80).optional(),
  kamQoldiq: z.number().int().min(0).max(100000).optional(),
  qarzKunlari: z.number().int().min(3).max(365).optional(),
  mustaqillik: z.enum(MUSTAQILLIK).optional(),
  // bir qator — bitta qoida
  qoidalar: z.string().max(6000).transform((v) => v.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 40).join("\n")).optional(),
});

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const p = Sozla.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri" }, { status: 400 });
  await sozlama(user.id);
  await prisma.miyaSozlama.update({ where: { userId: user.id }, data: p.data });
  return NextResponse.json({ ok: true });
}

const Amal = z.discriminatedUnion("amal", [
  z.object({ amal: z.literal("tekshir") }),
  z.object({ amal: z.literal("oqildi") }),
  z.object({ amal: z.literal("fikrla") }),
  z.object({ amal: z.literal("fikr_ha"), id: z.string().max(64) }),
  z.object({ amal: z.literal("fikr_yoq"), id: z.string().max(64), izoh: z.string().max(500).optional() }),
  z.object({
    amal: z.literal("reja"),
    upload_id: z.string().max(64),
    tur: z.string().max(20),
    caption: z.string().max(2200).optional(),
    vaqt: z.string().max(40),
  }),
]);

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const p = Amal.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Ma'lumot noto'g'ri" }, { status: 400 });
  try {
    if (p.data.amal === "fikrla") {
      await sozlama(user.id);
      return NextResponse.json({ ok: true, ...(await fikrla(user.id)) });
    } else if (p.data.amal === "fikr_ha" || p.data.amal === "fikr_yoq") {
      await qaror(user.id, p.data.id, p.data.amal === "fikr_ha", p.data.amal === "fikr_yoq" ? p.data.izoh : undefined);
    } else if (p.data.amal === "oqildi") {
      await prisma.miyaXabar.updateMany({ where: { userId: user.id, oqildi: false }, data: { oqildi: true } });
    } else if (p.data.amal === "tekshir") {
      const s = await sozlama(user.id);
      if (moliyaRuxsat(user.email) && cloudshopSozlangan()) {
        await moliyaTekshir(user.id, s);
        await prisma.miyaSozlama.update({ where: { userId: user.id }, data: { oxirgiMoliya: new Date() } });
      }
      await instagramTekshir(user.id);
      await prisma.miyaSozlama.update({ where: { userId: user.id }, data: { oxirgiInstagram: new Date() } });
    } else {
      await rejaQosh(user.id, p.data);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Xato" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("reja") ?? "";
  await prisma.rejaPost.deleteMany({ where: { id, userId: user.id, holat: "kutmoqda" } });
  return NextResponse.json({ ok: true });
}
