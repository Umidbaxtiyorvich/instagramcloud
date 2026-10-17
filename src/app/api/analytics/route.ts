import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { syncIfStale, syncMedia } from "@/lib/ig-data";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const accountId = new URL(req.url).searchParams.get("accountId");
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId || "", userId: user.id },
  });
  if (!account) return NextResponse.json({ media: [] });
  let syncError = "";
  if (new URL(req.url).searchParams.get("refresh")) {
    try {
      await syncMedia(account);
    } catch (e) {
      syncError = e instanceof Error ? e.message : "xato";
    }
  } else {
    await syncIfStale(account);
  }
  const media = await prisma.mediaItem.findMany({
    where: { accountId: account.id },
    orderBy: [{ timestamp: "desc" }, { views: "desc" }],
    take: 50,
  });
  return NextResponse.json({ media, followers: account.followersCount, syncError });
}
