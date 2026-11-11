import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ishTugadi, ishXato, runnerTekshir } from "@/lib/video-ish";
import { MAX_VIDEO_BYTES } from "@/lib/uploads";

// GitHub Actions runneri uchun: GET — ssenariy, POST — tayyor MP4 (yoki x-xato sarlavhasi bilan xato).
// Kirish faqat shu repodagi video.yml workflow'ining GitHub OIDC tokeni bilan.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

async function ruxsat(req: Request) {
  try {
    await runnerTekshir(req);
    return null;
  } catch (e) {
    return NextResponse.json({ error: `Ruxsat yo'q: ${e instanceof Error ? e.message : ""}` }, { status: 401 });
  }
}

export async function GET(req: Request, { params }: Ctx) {
  const yoq = await ruxsat(req);
  if (yoq) return yoq;
  const { id } = await params;
  const ish = await prisma.videoIsh.findUnique({ where: { id } });
  if (!ish || ish.holat === "tayyor" || ish.holat === "xato") return NextResponse.json({ error: "Ish topilmadi yoki tugagan" }, { status: 404 });
  await prisma.videoIsh.update({ where: { id }, data: { holat: "ishlanmoqda" } });
  return NextResponse.json({ spec: JSON.parse(ish.spec) });
}

export async function POST(req: Request, { params }: Ctx) {
  const yoq = await ruxsat(req);
  if (yoq) return yoq;
  const { id } = await params;
  try {
    const xato = req.headers.get("x-xato");
    if (xato) {
      await ishXato(id, decodeURIComponent(xato));
      return NextResponse.json({ ok: true });
    }
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) throw new Error("Video bo'sh yoki juda katta");
    await ishTugadi(id, bytes);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("video ish:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "xato" }, { status: 400 });
  }
}
