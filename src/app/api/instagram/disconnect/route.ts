import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const { accountId } = await req.json();
  await prisma.instagramAccount.deleteMany({ where: { id: accountId, userId: user.id } });
  return NextResponse.json({ ok: true });
}
