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
  const body = await req.json().catch(() => ({}));
  const account = await prisma.instagramAccount.findFirst({ where: { id: String(body.accountId || ""), userId: user.id } });
  if (!account) return NextResponse.json({ error: "Instagram akkaunt topilmadi" }, { status: 404 });
  const wantPost = body.post !== false;
  const wantStory = Boolean(body.story);
  if (!wantPost && !wantStory) return NextResponse.json({ error: "Post yoki Story ni tanlang" }, { status: 400 });
  const payload = {
    accountId: account.id,
    uploadId: String(body.uploadId || ""),
    caption: String(body.caption || ""),
    locationId: String(body.locationId || "").trim(),
    collaborators: String(body.collaborators || ""),
    baseUrl: baseUrl(req),
  };
  // Story goes first: publishing the post drops the uploaded bytes.
  const steps = [...(wantStory ? ["publish_story"] : []), ...(wantPost ? ["publish_reel"] : [])];
  const results: Record<string, unknown> = {};
  for (const step of steps) {
    const label = step === "publish_story" ? "story" : "post";
    try {
      const result = await executeApprovedAction(step, payload);
      results[label] = result;
      await prisma.approval.create({
        data: {
          userId: user.id,
          accountId: account.id,
          toolName: step,
          summary: `@${account.username}: kabinetdan joylandi (${label}) «${payload.caption.slice(0, 80)}»`,
          payload: JSON.stringify(payload),
          status: "executed",
          result: JSON.stringify(result),
          decidedAt: new Date(),
        },
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : "Joylanmadi";
      const done = Object.keys(results);
      return NextResponse.json(
        { error: done.length ? `${done.join(", ")} joylandi, ${label} joylanmadi: ${error}` : error, results },
        { status: 400 }
      );
    }
  }
  return NextResponse.json({ ok: true, ...results });
}
