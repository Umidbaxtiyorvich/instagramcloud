import type { InstagramAccount } from "@prisma/client";
import { prisma } from "./db";
import { freshToken } from "./ig-data";
import { markPublished, uploadForPublish } from "./uploads";
import {
  createImageContainer,
  createReelContainer,
  createStoryContainer,
  deleteComment,
  hideComment,
  publishMedia,
  replyToComment,
  sendDm,
  sendPrivateReply,
  waitForContainer,
} from "./instagram";

export type ActionPayload = {
  accountId: string;
  [k: string]: unknown;
};

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

async function log(account: InstagramAccount, data: { kind: string; text: string; igUserId?: string; commentId?: string; mediaId?: string; replyText?: string }) {
  await prisma.activityLog.create({ data: { accountId: account.id, direction: "out", ...data } });
}

async function ownRule(account: InstagramAccount, ruleId: string) {
  const rule = await prisma.autoRule.findFirst({ where: { id: ruleId, accountId: account.id } });
  if (!rule) throw new Error("Qoida topilmadi");
  return rule;
}

async function saveRule(account: InstagramAccount, type: "comment" | "dm", p: ActionPayload) {
  const keywords = list(p.keywords);
  const matchMode = p.matchMode === "any" || (type === "comment" && !keywords.length) ? "any" : "contains";
  const mediaIds = list(p.mediaIds ?? (p.mediaId ? [p.mediaId] : []));
  const data = {
    type,
    keywords: JSON.stringify(keywords),
    matchMode,
    scope: mediaIds.length ? "selected" : "all",
    mediaIds: JSON.stringify(mediaIds),
    dmMessage: String(p.dmMessage ?? p.reply ?? ""),
    publicReplies: JSON.stringify(type === "comment" ? list(p.publicReplies) : []),
    enabled: p.enabled !== false && p.is_active !== false,
  };
  if (!data.dmMessage) throw new Error("Javob matni bo'sh");
  if (type === "dm" && !keywords.length) throw new Error("Direct qoidasi uchun kalit so'z kerak");
  const ruleId = p.ruleId ? String(p.ruleId) : "";
  if (ruleId) {
    const rule = await ownRule(account, ruleId);
    const updated = await prisma.autoRule.update({ where: { id: rule.id }, data });
    return { ok: true, ruleId: updated.id, updated: true };
  }
  const rule = await prisma.autoRule.create({ data: { accountId: account.id, ...data } });
  return { ok: true, ruleId: rule.id, created: true };
}

export async function executeApprovedAction(toolName: string, payload: ActionPayload) {
  const account = await prisma.instagramAccount.findUnique({ where: { id: payload.accountId } });
  if (!account) throw new Error("Instagram akkaunt topilmadi");
  const demo = account.isDemo;
  const token = demo ? "" : await freshToken(account);
  const text = String(payload.text || "");
  const commentId = String(payload.commentId || "");

  switch (toolName) {
    case "reply_comment": {
      if (!demo) await replyToComment(commentId, token, text);
      await log(account, { kind: "comment_reply", text, commentId });
      return { ok: true, demo };
    }
    case "private_reply": {
      if (!demo) await sendPrivateReply(account.igUserId, token, commentId, text);
      await log(account, { kind: "comment_reply", text: "", replyText: text, commentId });
      return { ok: true, demo };
    }
    case "send_dm": {
      const recipientId = String(payload.recipientId || "");
      if (!demo) await sendDm(account.igUserId, token, recipientId, text);
      await log(account, { kind: "dm_reply", text, igUserId: recipientId });
      return { ok: true, demo };
    }
    case "hide_comment": {
      const hide = payload.hide !== false;
      if (!demo) await hideComment(commentId, token, hide);
      return { ok: true, demo, commentId, hidden: hide };
    }
    case "delete_comment": {
      if (!demo) await deleteComment(commentId, token);
      return { ok: true, demo, commentId, deleted: true };
    }
    case "publish_reel":
    case "publish_photo":
    case "publish_story": {
      const isStory = toolName === "publish_story";
      const caption = isStory ? "" : String(payload.caption || "");
      const upload = payload.uploadId
        ? await uploadForPublish(account.userId, String(payload.uploadId), payload.baseUrl ? String(payload.baseUrl) : undefined)
        : null;
      const isPhoto = upload ? upload.kind === "image" : toolName === "publish_photo" || (isStory && Boolean(payload.imageUrl));
      const url = upload?.url || String((isPhoto ? payload.imageUrl : payload.videoUrl) || "");
      if (!url) throw new Error("Fayl yo'q: avval saytda yuklang (upload_id) yoki ochiq URL bering");
      const extras = {
        locationId: payload.locationId ? String(payload.locationId).trim() : undefined,
        collaborators: list(payload.collaborators),
        shareToFeed: payload.shareToFeed !== false,
      };
      const type = isStory ? "story" : isPhoto ? "photo" : "reel";
      if (demo) {
        const igMediaId = `demo_pub_${Date.now()}`;
        await prisma.mediaItem.create({
          data: { accountId: account.id, igMediaId, mediaType: isStory ? "STORY" : isPhoto ? "FEED" : "REELS", caption, permalink: url },
        });
        await log(account, { kind: "publish", text: caption, mediaId: igMediaId });
        if (upload) await markPublished(upload.id, igMediaId);
        return { ok: true, demo, igMediaId, type };
      }
      const created = isStory
        ? await createStoryContainer(account.igUserId, token, url, isPhoto)
        : isPhoto
          ? await createImageContainer(account.igUserId, token, url, caption, extras)
          : await createReelContainer(account.igUserId, token, url, caption, extras);
      await waitForContainer(created.id, token);
      const published = await publishMedia(account.igUserId, token, created.id);
      await log(account, { kind: "publish", text: caption || "(story)", mediaId: published.id });
      // a story and a post can be made from the same upload, so only a post marks it used
      if (upload && !isStory) await markPublished(upload.id, published.id);
      return { ok: true, id: published.id, type };
    }
    case "save_comment_rule":
      return saveRule(account, "comment", payload);
    case "save_dm_rule":
      return saveRule(account, "dm", payload);
    // approvals queued before the rename
    case "create_rule":
    case "update_rule": {
      const type = payload.type === "dm" ? "dm" : "comment";
      if (payload.ruleId) {
        const rule = await ownRule(account, String(payload.ruleId));
        return saveRule(account, rule.type === "dm" ? "dm" : "comment", {
          keywords: JSON.parse(rule.keywords),
          dmMessage: rule.dmMessage,
          publicReplies: JSON.parse(rule.publicReplies),
          matchMode: rule.matchMode,
          ...payload,
        });
      }
      return saveRule(account, type, payload);
    }
    case "delete_rule": {
      const rule = await ownRule(account, String(payload.ruleId || ""));
      await prisma.autoRule.delete({ where: { id: rule.id } });
      return { ok: true, ruleId: rule.id, deleted: true };
    }
    case "configure_direct": {
      const mode = String(payload.mode || "");
      const updated = await prisma.instagramAccount.update({
        where: { id: account.id },
        data: {
          ...(payload.enabled != null ? { dmAutoReplyEnabled: Boolean(payload.enabled) } : {}),
          ...(payload.commentRepliesOn != null ? { commentRepliesOn: Boolean(payload.commentRepliesOn) } : {}),
          ...(payload.defaultReply != null ? { defaultDmReply: String(payload.defaultReply) } : {}),
          ...(["first", "daily", "always", "off"].includes(mode) ? { defaultDmMode: mode } : {}),
        },
      });
      return {
        ok: true,
        directAutoReply: updated.dmAutoReplyEnabled,
        commentAutoReply: updated.commentRepliesOn,
        defaultReply: updated.defaultDmReply,
        mode: updated.defaultDmMode,
      };
    }
    default:
      throw new Error(`Noma'lum harakat: ${toolName}`);
  }
}

// Navbatdagi tasdiqni hal qiladi: «ha» — bajaradi, «yo'q» — rad etadi (sayt va telefon uchun umumiy)
export async function tasdiqHal(userId: string, id: string, ha: boolean) {
  const row = await prisma.approval.findFirst({ where: { id, userId } });
  if (!row) throw new Error("Tasdiq topilmadi");
  if (row.status !== "pending") throw new Error("Allaqachon qaror qilingan");
  if (!ha) {
    await prisma.approval.update({ where: { id }, data: { status: "rejected", decidedAt: new Date() } });
    const kalit = (JSON.parse(row.payload) as { miyaKalit?: string }).miyaKalit;
    if (kalit) await (await import("./miya")).reelsRad(userId, kalit);
    return { status: "rejected" as const };
  }
  try {
    const payload = JSON.parse(row.payload);
    const result = await executeApprovedAction(row.toolName, payload);
    await prisma.approval.update({ where: { id }, data: { status: "executed", result: JSON.stringify(result), decidedAt: new Date() } });
    // Miya yasagan Reels — xabarini yangilaydi va natijasini kuzatishga oladi
    if (payload.miyaKalit) {
      const r = result as { id?: string; igMediaId?: string };
      await (await import("./miya")).reelsJoylandi(userId, String(payload.miyaKalit), String(payload.caption ?? ""), r.id ?? r.igMediaId);
    }
    return { status: "executed" as const, result };
  } catch (e) {
    await prisma.approval.update({
      where: { id },
      data: { status: "error", result: JSON.stringify({ error: e instanceof Error ? e.message : "xato" }), decidedAt: new Date() },
    });
    throw e;
  }
}
