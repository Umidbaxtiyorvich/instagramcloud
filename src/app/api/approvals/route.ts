import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tasdiqHal } from "@/lib/actions";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const approvals = await prisma.approval.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ approvals });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const { id, decision } = await req.json();
  const row = await prisma.approval.findFirst({ where: { id: String(id ?? ""), userId: user.id } });
  if (!row) return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  if (row.status !== "pending") return NextResponse.json({ error: "Allaqachon qaror qilingan" }, { status: 400 });
  try {
    const r = await tasdiqHal(user.id, row.id, decision !== "reject");
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "xato" }, { status: 500 });
  }
}
