import { prisma } from "@/lib/db";
import { STATIK, ovozYasa, suhbatOl, type Statik } from "@/lib/miya-telefon";

// Miya gapining ovozi (mp3). Twilio <Play> bilan oladi; kalit — qo'ng'iroqning maxfiy kaliti.
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const q = await prisma.qongiroq.findUnique({ where: { id: u.get("q") ?? "" } });
  if (!q || q.kalit !== u.get("k")) return new Response("Topilmadi", { status: 404 });
  const st = u.get("s") as Statik | null;
  let kalit: string;
  let matn: string | undefined;
  if (st) {
    matn = STATIK[st];
    kalit = `s:${st}`;
  } else {
    const n = Number(u.get("n"));
    const g = suhbatOl(q)[n];
    matn = g?.kim === "miya" ? g.matn : undefined;
    kalit = `${q.id}:${n}`;
  }
  if (!matn) return new Response("Topilmadi", { status: 404 });
  try {
    const mp3 = await ovozYasa(kalit, matn);
    return new Response(Buffer.from(mp3), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    console.error("telefon ovoz:", e);
    return new Response("Ovoz yasalmadi", { status: 502 });
  }
}
