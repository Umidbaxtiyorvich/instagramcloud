import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { executeApprovedAction } from "@/lib/actions";
import { baseUrl } from "@/lib/url";

export const runtime = "nodejs";
// waiting for Instagram to process a video can take a couple of minutes
export const maxDuration = 300;

// The user publishes their own upload from the dashboard — no approval step needed.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const { accountId, uploadId, caption } = await req.json().catch(() => ({}));
  const account = await prisma.instagramAccount.findFirst({ where: { id: String(accountId || ""), userId: user.id } });
  if (!account) return NextResponse.json({ error: "Instagram akkaunt topilmadi" }, { status: 404 });
  const payload = { accountId: account.id, uploadId: String(uploadId || ""), caption: String(caption || ""), baseUrl: baseUrl(req) };
  try {
    const result = await executeApprovedAction("publish_reel", payload);
    await prisma.approval.create({
      data: {
        userId: user.id,
        accountId: account.id,
        toolName: "publish_reel",
        summary: `@${account.username}: kabinetdan joylandi «${payload.caption.slice(0, 80)}»`,
        payload: JSON.stringify(payload),
        status: "executed",
        result: JSON.stringify(result),
        decidedAt: new Date(),
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Joylanmadi" }, { status: 400 });
  }
}
