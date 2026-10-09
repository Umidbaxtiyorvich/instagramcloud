import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import {
  createReelContainer,
  hideComment,
  publishMedia,
  replyToComment,
  sendDm,
  tokenOf,
} from "./instagram";

export type ActionPayload = {
  accountId: string;
  [k: string]: unknown;
};

export async function executeApprovedAction(toolName: string, payload: ActionPayload) {
  const account = await prisma.instagramAccount.findUnique({ where: { id: payload.accountId } });
  if (!account) throw new Error("Instagram akkaunt topilmadi");

  switch (toolName) {
    case "reply_comment": {
      const text = String(payload.text || "");
      const commentId = String(payload.commentId || "");
      if (account.isDemo) {
        await prisma.activityLog.create({
          data: {
            accountId: account.id,
            kind: "comment_reply",
            direction: "out",
            text,
            commentId,
          },
        });
        return { ok: true, demo: true };
      }
      const token = tokenOf(account.accessTokenEnc);
      await replyToComment(commentId, token, text);
      return { ok: true };
    }
    case "send_dm": {
      const text = String(payload.text || "");
      const recipientId = String(payload.recipientId || "");
      if (account.isDemo) {
        await prisma.activityLog.create({
          data: {
            accountId: account.id,
            kind: "dm_reply",
            direction: "out",
            igUserId: recipientId,
            text,
          },
        });
        return { ok: true, demo: true };
      }
      await sendDm(account.igUserId, tokenOf(account.accessTokenEnc), recipientId, text);
      return { ok: true };
    }
    case "hide_comment": {
      const commentId = String(payload.commentId || "");
      if (account.isDemo) return { ok: true, demo: true, hidden: commentId };
      await hideComment(commentId, tokenOf(account.accessTokenEnc), true);
      return { ok: true };
    }
    case "publish_reel": {
      const videoUrl = String(payload.videoUrl || "");
      const caption = String(payload.caption || "");
      if (account.isDemo) {
        const igMediaId = `demo_pub_${Date.now()}`;
        await prisma.mediaItem.create({
          data: {
            accountId: account.id,
            igMediaId,
            mediaType: "REELS",
            caption,
            permalink: videoUrl,
          },
        });
        await prisma.activityLog.create({
          data: {
            accountId: account.id,
            kind: "publish",
            direction: "out",
            text: caption,
            mediaId: igMediaId,
          },
        });
        return { ok: true, demo: true, igMediaId };
      }
      const token = tokenOf(account.accessTokenEnc);
      const created = await createReelContainer(account.igUserId, token, videoUrl, caption);
      const published = await publishMedia(account.igUserId, token, created.id);
      return { ok: true, id: published.id };
    }
    case "create_rule": {
      const rule = await prisma.autoRule.create({
        data: {
          accountId: account.id,
          type: String(payload.type || "comment"),
          keywords: JSON.stringify(payload.keywords || []),
          matchMode: String(payload.matchMode || "contains"),
          scope: String(payload.scope || "all"),
          mediaIds: JSON.stringify(payload.mediaIds || []),
          dmMessage: String(payload.dmMessage || ""),
          publicReplies: JSON.stringify(payload.publicReplies || ["Direct'ga yubordik 📩"]),
          enabled: payload.enabled !== false,
        },
      });
      return { ok: true, id: rule.id };
    }
    case "update_rule": {
      const id = String(payload.ruleId || "");
      const data: Prisma.AutoRuleUpdateInput = {};
      if (payload.keywords) data.keywords = JSON.stringify(payload.keywords);
      if (payload.dmMessage != null) data.dmMessage = String(payload.dmMessage);
      if (payload.publicReplies) data.publicReplies = JSON.stringify(payload.publicReplies);
      if (payload.enabled != null) data.enabled = Boolean(payload.enabled);
      if (payload.matchMode) data.matchMode = String(payload.matchMode);
      const rule = await prisma.autoRule.update({ where: { id }, data });
      return { ok: true, id: rule.id };
    }
    case "delete_rule": {
      await prisma.autoRule.delete({ where: { id: String(payload.ruleId) } });
      return { ok: true };
    }
    default:
      throw new Error(`Noma'lum harakat: ${toolName}`);
  }
}
