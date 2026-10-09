import { prisma } from "./db";
import { hideComment, replyToComment, sendDm, sendPrivateReply, tokenOf } from "./instagram";

type IncomingComment = {
  accountId: string;
  commentId: string;
  mediaId: string;
  text: string;
  username: string;
  fromId: string;
};

type IncomingDm = {
  accountId: string;
  messageId: string;
  text: string;
  fromId: string;
  username: string;
};

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

function matches(text: string, keywords: string[], mode: string) {
  if (mode === "any") return true;
  const hay = text.toLowerCase();
  return keywords.some((k) => hay.includes(k.toLowerCase().trim()));
}

function pickReply(replies: string[], seed: string) {
  if (!replies.length) return "";
  const idx = Math.abs(hash(seed)) % replies.length;
  return replies[idx];
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

async function optedOut(accountId: string, igUserId: string) {
  const row = await prisma.optOut.findUnique({
    where: { accountId_igScopedUserId: { accountId, igScopedUserId: igUserId } },
  });
  return Boolean(row);
}

export async function handleComment(evt: IncomingComment) {
  const account = await prisma.instagramAccount.findUnique({ where: { id: evt.accountId } });
  if (!account || !account.commentRepliesOn) return;
  if (await optedOut(account.id, evt.fromId)) return;

  const rules = await prisma.autoRule.findMany({
    where: { accountId: account.id, type: "comment", enabled: true },
  });
  const hit = rules.find((r) => {
    if (r.scope === "selected") {
      const ids = parseList(r.mediaIds);
      if (ids.length && !ids.includes(evt.mediaId)) return false;
    }
    return matches(evt.text, parseList(r.keywords), r.matchMode);
  });
  if (!hit) return;

  const publicReplies = parseList(hit.publicReplies);
  const publicText = pickReply(publicReplies, evt.commentId) || "Direct'ga yubordik 📩";

  await prisma.activityLog.create({
    data: {
      accountId: account.id,
      kind: "comment",
      direction: "in",
      username: evt.username,
      igUserId: evt.fromId,
      text: evt.text,
      mediaId: evt.mediaId,
      commentId: evt.commentId,
    },
  });

  if (account.isDemo) {
    await prisma.activityLog.create({
      data: {
        accountId: account.id,
        kind: "comment_reply",
        direction: "out",
        username: evt.username,
        igUserId: evt.fromId,
        text: publicText,
        replyText: hit.dmMessage,
        mediaId: evt.mediaId,
        commentId: evt.commentId,
      },
    });
    return { demo: true, publicText, dm: hit.dmMessage };
  }

  const token = tokenOf(account.accessTokenEnc);
  try {
    await sendPrivateReply(account.igUserId, token, evt.commentId, hit.dmMessage);
  } catch (e) {
    console.error("private reply", e);
  }
  try {
    await replyToComment(evt.commentId, token, publicText);
  } catch (e) {
    console.error("public reply", e);
  }

  await prisma.activityLog.create({
    data: {
      accountId: account.id,
      kind: "comment_reply",
      direction: "out",
      username: evt.username,
      igUserId: evt.fromId,
      text: publicText,
      replyText: hit.dmMessage,
      mediaId: evt.mediaId,
      commentId: evt.commentId,
    },
  });
  return { publicText, dm: hit.dmMessage };
}

export async function handleDm(evt: IncomingDm) {
  const account = await prisma.instagramAccount.findUnique({ where: { id: evt.accountId } });
  if (!account || !account.dmAutoReplyEnabled) return;

  const lower = evt.text.trim().toLowerCase();
  if (lower === "stop" || lower === "toxta" || lower === "to‘xta") {
    await prisma.optOut.upsert({
      where: { accountId_igScopedUserId: { accountId: account.id, igScopedUserId: evt.fromId } },
      create: { accountId: account.id, igScopedUserId: evt.fromId },
      update: {},
    });
    return { optedOut: true };
  }

  if (await optedOut(account.id, evt.fromId)) return;

  const convo = await prisma.conversation.upsert({
    where: { accountId_igScopedUserId: { accountId: account.id, igScopedUserId: evt.fromId } },
    create: {
      accountId: account.id,
      igScopedUserId: evt.fromId,
      username: evt.username,
      lastMessage: evt.text,
    },
    update: { lastMessage: evt.text, lastAt: new Date(), username: evt.username },
  });

  await prisma.activityLog.create({
    data: {
      accountId: account.id,
      kind: "dm",
      direction: "in",
      username: evt.username,
      igUserId: evt.fromId,
      text: evt.text,
      messageId: evt.messageId,
    },
  });

  const rules = await prisma.autoRule.findMany({
    where: { accountId: account.id, type: "dm", enabled: true },
  });
  const hit = rules.find((r) => matches(evt.text, parseList(r.keywords), r.matchMode));
  let reply = hit?.dmMessage || "";

  if (!reply && account.defaultDmReply) {
    const mode = account.defaultDmMode;
    const now = Date.now();
    const last = convo.lastAutoReply?.getTime() || 0;
    const firstOk = !convo.lastAutoReply;
    const dailyOk = now - last > 20 * 60 * 60 * 1000;
    if (mode === "always" || (mode === "first" && firstOk) || (mode === "daily" && dailyOk)) {
      reply = account.defaultDmReply;
    }
  }
  if (!reply) return;

  if (account.isDemo) {
    await prisma.conversation.update({
      where: { id: convo.id },
      data: { lastAutoReply: new Date() },
    });
    await prisma.activityLog.create({
      data: {
        accountId: account.id,
        kind: "dm_reply",
        direction: "out",
        username: evt.username,
        igUserId: evt.fromId,
        text: reply,
        messageId: evt.messageId,
      },
    });
    return { demo: true, reply };
  }

  const token = tokenOf(account.accessTokenEnc);
  try {
    await sendDm(account.igUserId, token, evt.fromId, reply);
  } catch (e) {
    console.error("dm send", e);
    return;
  }
  await prisma.conversation.update({
    where: { id: convo.id },
    data: { lastAutoReply: new Date() },
  });
  await prisma.activityLog.create({
    data: {
      accountId: account.id,
      kind: "dm_reply",
      direction: "out",
      username: evt.username,
      igUserId: evt.fromId,
      text: reply,
      messageId: evt.messageId,
    },
  });
  return { reply };
}

export async function seedDemoMedia(accountId: string) {
  const samples = [
    {
      igMediaId: "demo_reel_1",
      mediaType: "REELS",
      caption: "Mikroto'lqinli pech qanday ishlaydi",
      views: 1530000,
      reach: 1200000,
      shares: 52800,
      saves: 41000,
      likes: 89000,
      comments: 2100,
      avgWatchSec: 26,
    },
    {
      igMediaId: "demo_reel_2",
      mediaType: "REELS",
      caption: "Nega osmon ko'k",
      views: 412000,
      reach: 380000,
      shares: 11780,
      saves: 9200,
      likes: 24000,
      comments: 640,
      avgWatchSec: 21,
    },
    {
      igMediaId: "demo_reel_3",
      mediaType: "FEED",
      caption: "Yangi studiyamiz",
      views: 96000,
      reach: 88000,
      shares: 528,
      saves: 1100,
      likes: 4300,
      comments: 90,
      avgWatchSec: 9,
    },
  ];
  for (const m of samples) {
    await prisma.mediaItem.upsert({
      where: { accountId_igMediaId: { accountId, igMediaId: m.igMediaId } },
      create: { accountId, ...m, permalink: `https://instagram.com/reel/${m.igMediaId}` },
      update: m,
    });
  }
}
