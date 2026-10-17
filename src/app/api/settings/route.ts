import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { randomToken } from "@/lib/crypto";

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.aiApproval !== "chat" && body.aiApproval !== "dashboard") {
    return NextResponse.json({ error: "aiApproval: chat yoki dashboard" }, { status: 400 });
  }
  await prisma.user.update({ where: { id: user.id }, data: { aiApproval: body.aiApproval } });
  return NextResponse.json({ ok: true });
}

// New personal token: anything configured with the old one stops working.
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const mcpToken = `ic_${randomToken(24)}`;
  await prisma.user.update({ where: { id: user.id }, data: { mcpToken } });
  return NextResponse.json({ ok: true, mcpToken });
}
