import { prisma } from "@/lib/db";
import { imzoTogri, maydonlar } from "@/lib/twilio";

// Qo'ng'iroq tugadi (yoki ko'tarilmadi) — Twilio StatusCallback
export async function POST(req: Request) {
  const f = await maydonlar(req);
  if (!imzoTogri(req, f)) return new Response("Imzo noto'g'ri", { status: 403 });
  const q = f.CallSid ? await prisma.qongiroq.findFirst({ where: { sid: f.CallSid } }) : null;
  if (q) {
    const st = f.CallStatus ?? "";
    const holat = q.holat === "xato" ? "xato" : st === "completed" ? (q.holat === "boshlandi" ? "javobsiz" : "tugadi") : st === "failed" ? "xato" : "javobsiz";
    await prisma.qongiroq.update({ where: { id: q.id }, data: { holat, tugadi: new Date(), kutish: false } });
  }
  return new Response(null, { status: 204 });
}
