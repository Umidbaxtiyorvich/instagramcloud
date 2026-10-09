import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const body = await req.json();
  const account = await prisma.instagramAccount.findFirst({
    where: { id: body.accountId, userId: user.id },
  });
  if (!account) return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  const updated = await prisma.instagramAccount.update({
    where: { id: account.id },
    data: {
      dmAutoReplyEnabled: body.dmAutoReplyEnabled ?? account.dmAutoReplyEnabled,
      commentRepliesOn: body.commentRepliesOn ?? account.commentRepliesOn,
      defaultDmReply: body.defaultDmReply ?? account.defaultDmReply,
      defaultDmMode: body.defaultDmMode ?? account.defaultDmMode,
    },
  });
  return NextResponse.json({ account: updated });
}
