import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { handleComment, handleDm } from "@/lib/auto-reply";
import { webhookSignatureValid } from "@/lib/instagram";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge || "", { status: 200 });
  }
  return NextResponse.json({ error: "verify failed" }, { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!webhookSignatureValid(raw, req.headers.get("x-hub-signature-256"))) {
    console.error("instagram webhook: bad signature — check INSTAGRAM_APP_SECRET");
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const entries = Array.isArray(body.entry) ? body.entry : [];
  console.log(`instagram webhook: object=${body.object} entries=${entries.length}`);
  for (const entry of entries) {
    const igId = String(entry.id || "");
    const account = await prisma.instagramAccount.findFirst({ where: { igUserId: igId } });
    if (!account) {
      console.warn(`instagram webhook: no account for entry.id=${igId}`);
      continue;
    }
    await prisma.instagramAccount.updateMany({ where: { igUserId: igId }, data: { lastWebhookAt: new Date() } });

    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const ch of changes) {
      if (ch.field === "comments" && ch.value) {
        const v = ch.value;
        await handleComment({
          accountId: account.id,
          commentId: String(v.id),
          mediaId: String(v.media?.id || v.media_id || ""),
          text: String(v.text || ""),
          username: String(v.from?.username || v.username || "user"),
          fromId: String(v.from?.id || v.from?.ig_id || v.id),
        });
      }
    }

    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const m of messaging) {
      if (m.message?.is_echo || m.message?.is_self) continue;
      const text = m.message?.text;
      if (!text) continue;
      await handleDm({
        accountId: account.id,
        messageId: String(m.message.mid || ""),
        text: String(text),
        fromId: String(m.sender?.id || ""),
        username: String(m.sender?.username || m.sender?.id || "user"),
      });
    }
  }

  return NextResponse.json({ ok: true });
}
