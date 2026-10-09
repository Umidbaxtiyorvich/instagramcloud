import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handleComment, handleDm } from "@/lib/auto-reply";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const { accountId, kind, text, username } = await req.json();
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, userId: user.id },
  });
  if (!account) return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  const fromId = `sim_${(username || "anna.k").replace(/\W/g, "_")}`;
  if (kind === "comment") {
    const result = await handleComment({
      accountId: account.id,
      commentId: `c_${Date.now()}`,
      mediaId: "demo_reel_1",
      text: text || "NARX",
      username: username || "anna.k",
      fromId,
    });
    return NextResponse.json({ ok: true, result });
  }
  const result = await handleDm({
    accountId: account.id,
    messageId: `m_${Date.now()}`,
    text: text || "yetkazib berish qanday?",
    fromId,
    username: username || "anna.k",
  });
  return NextResponse.json({ ok: true, result });
}
