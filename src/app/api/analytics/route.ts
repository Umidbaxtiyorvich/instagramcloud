import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const accountId = new URL(req.url).searchParams.get("accountId");
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId || "", userId: user.id },
  });
  if (!account) return NextResponse.json({ media: [] });
  const media = await prisma.mediaItem.findMany({
    where: { accountId: account.id },
    orderBy: { views: "desc" },
  });
  return NextResponse.json({ media, followers: account.followersCount });
}
