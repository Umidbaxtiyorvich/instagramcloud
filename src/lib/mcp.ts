import { prisma } from "./db";
import { executeApprovedAction } from "./actions";

type Json = Record<string, unknown>;

const WRITE_TOOLS = new Set([
  "instagram_reply_comment",
  "instagram_send_dm",
  "instagram_hide_comment",
  "instagram_publish_reel",
  "instagram_create_rule",
  "instagram_update_rule",
  "instagram_delete_rule",
]);

export const MCP_TOOLS = [
  {
    name: "instagram_accounts",
    description: "Foydalanuvchining ulangan Instagram akkauntlarini ko'rsatadi.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "instagram_reels_report",
    description: "Reels va postlar bo'yicha ko'rish, ulashish, saqlash va o'rtacha tomosha vaqti hisoboti.",
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "instagram_insights",
    description: "Akkaunt qamrovi va asosiy ko'rsatkichlar.",
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "instagram_list_comments",
    description: "Oxirgi kommentlar va ularga berilgan avto-javoblar.",
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "instagram_list_dms",
    description: "Direct xabarlar jurnali.",
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "instagram_list_rules",
    description: "Kalit so'z avto-javob qoidalarini ro'yxatlaydi.",
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "instagram_inbox_topics",
    description: "Direct'da nimalar so'ralayotganini guruhlab aytadi.",
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "instagram_reply_comment",
    description:
      "Kommentga ochiq javob yozadi. Avval tasdiq navbatiga tushadi — foydalanuvchi kabinetda 'ha' demaguncha yuborilmaydi.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        commentId: { type: "string" },
        text: { type: "string" },
      },
      required: ["commentId", "text"],
    },
  },
  {
    name: "instagram_send_dm",
    description:
      "Direct xabar yuboradi. Faqat avval yozgan odamga. Kabinetda tasdiqlash talab qilinadi.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        recipientId: { type: "string" },
        text: { type: "string" },
      },
      required: ["recipientId", "text"],
    },
  },
  {
    name: "instagram_hide_comment",
    description: "Spam kommentni yashiradi. Tasdiq talab qilinadi.",
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string" }, commentId: { type: "string" } },
      required: ["commentId"],
    },
  },
  {
    name: "instagram_publish_reel",
    description:
      "Ommaviy URL'dagi videoni Reels sifatida joylaydi. Tasdiq talab qilinadi. Instagram parolini so'ramaydi.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        videoUrl: { type: "string" },
        caption: { type: "string" },
      },
      required: ["videoUrl", "caption"],
    },
  },
  {
    name: "instagram_create_rule",
    description: "Kalit so'z avto-javob qoidasini yaratadi. Tasdiq talab qilinadi.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        type: { type: "string", enum: ["comment", "dm"] },
        keywords: { type: "array", items: { type: "string" } },
        dmMessage: { type: "string" },
        publicReplies: { type: "array", items: { type: "string" } },
        matchMode: { type: "string", enum: ["contains", "any"] },
      },
      required: ["type", "keywords", "dmMessage"],
    },
  },
  {
    name: "instagram_update_rule",
    description: "Mavjud qoidani o'zgartiradi. Tasdiq talab qilinadi.",
    inputSchema: {
      type: "object",
      properties: {
        ruleId: { type: "string" },
        keywords: { type: "array", items: { type: "string" } },
        dmMessage: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["ruleId"],
    },
  },
  {
    name: "instagram_delete_rule",
    description: "Qoidani o'chiradi. Tasdiq talab qilinadi.",
    inputSchema: {
      type: "object",
      properties: { ruleId: { type: "string" } },
      required: ["ruleId"],
    },
  },
  {
    name: "list_pending_approvals",
    description: "Hali tasdiqlanmagan AI harakatlarini ko'rsatadi.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

async function defaultAccount(userId: string, accountId?: string) {
  if (accountId) {
    const a = await prisma.instagramAccount.findFirst({ where: { id: accountId, userId } });
    if (!a) throw new Error("Akkaunt topilmadi");
    return a;
  }
  const a = await prisma.instagramAccount.findFirst({ where: { userId }, orderBy: { connectedAt: "desc" } });
  if (!a) throw new Error("Instagram hali ulanmagan");
  return a;
}

async function queue(userId: string, tool: string, summary: string, payload: Json) {
  const accountId = typeof payload.accountId === "string" ? payload.accountId : null;
  const row = await prisma.approval.create({
    data: {
      userId,
      accountId,
      toolName: tool.replace("instagram_", ""),
      summary,
      payload: JSON.stringify(payload),
    },
  });
  return textResult(
    `Harakat navbatga qo'yildi va foydalanuvchi tasdig'ini kutmoqda.\n` +
      `ID: ${row.id}\n` +
      `Nima qilinadi: ${summary}\n` +
      `Kabinetdagi «Tasdiqlar» sahifasida «Ha» bosilmaguncha Instagramga hech narsa yuborilmaydi.`
  );
}

export async function callTool(userId: string, name: string, args: Json) {
  if (WRITE_TOOLS.has(name)) {
    const account = await defaultAccount(userId, args.accountId as string | undefined);
    args.accountId = account.id;
    const summaries: Record<string, string> = {
      instagram_reply_comment: `Komment ${args.commentId} ga javob: «${args.text}»`,
      instagram_send_dm: `Direct ${args.recipientId} ga: «${args.text}»`,
      instagram_hide_comment: `Komment ${args.commentId} ni yashirish`,
      instagram_publish_reel: `Reels joylash: «${args.caption}» (${args.videoUrl})`,
      instagram_create_rule: `Yangi ${args.type} qoidasi, kalit so'zlar: ${JSON.stringify(args.keywords)}`,
      instagram_update_rule: `Qoida ${args.ruleId} ni yangilash`,
      instagram_delete_rule: `Qoida ${args.ruleId} ni o'chirish`,
    };
    return queue(userId, name, summaries[name] || name, args);
  }

  switch (name) {
    case "instagram_accounts": {
      const accounts = await prisma.instagramAccount.findMany({ where: { userId } });
      return textResult(JSON.stringify(accounts.map((a) => ({
        id: a.id,
        username: a.username,
        name: a.name,
        followers: a.followersCount,
        demo: a.isDemo,
        dmAutoReply: a.dmAutoReplyEnabled,
      })), null, 2));
    }
    case "instagram_reels_report": {
      const account = await defaultAccount(userId, args.accountId as string | undefined);
      const media = await prisma.mediaItem.findMany({
        where: { accountId: account.id },
        orderBy: { shares: "desc" },
      });
      const lines = media.map((m) => ({
        caption: m.caption,
        type: m.mediaType,
        views: m.views,
        reach: m.reach,
        shareRate: m.reach ? `${((m.shares / m.reach) * 100).toFixed(1)}%` : "n/a",
        avgWatchSec: m.avgWatchSec,
        saves: m.saves,
      }));
      return textResult(JSON.stringify({ username: account.username, items: lines }, null, 2));
    }
    case "instagram_insights": {
      const account = await defaultAccount(userId, args.accountId as string | undefined);
      const media = await prisma.mediaItem.findMany({ where: { accountId: account.id } });
      const sum = media.reduce(
        (acc, m) => {
          acc.views += m.views;
          acc.reach += m.reach;
          acc.shares += m.shares;
          acc.saves += m.saves;
          return acc;
        },
        { views: 0, reach: 0, shares: 0, saves: 0 }
      );
      return textResult(JSON.stringify({ username: account.username, followers: account.followersCount, ...sum }, null, 2));
    }
    case "instagram_list_comments": {
      const account = await defaultAccount(userId, args.accountId as string | undefined);
      const logs = await prisma.activityLog.findMany({
        where: { accountId: account.id, kind: { in: ["comment", "comment_reply"] } },
        orderBy: { createdAt: "desc" },
        take: Number(args.limit || 30),
      });
      return textResult(JSON.stringify(logs, null, 2));
    }
    case "instagram_list_dms": {
      const account = await defaultAccount(userId, args.accountId as string | undefined);
      const logs = await prisma.activityLog.findMany({
        where: { accountId: account.id, kind: { in: ["dm", "dm_reply"] } },
        orderBy: { createdAt: "desc" },
        take: Number(args.limit || 30),
      });
      return textResult(JSON.stringify(logs, null, 2));
    }
    case "instagram_list_rules": {
      const account = await defaultAccount(userId, args.accountId as string | undefined);
      const rules = await prisma.autoRule.findMany({ where: { accountId: account.id } });
      return textResult(JSON.stringify(rules, null, 2));
    }
    case "instagram_inbox_topics": {
      const account = await defaultAccount(userId, args.accountId as string | undefined);
      const logs = await prisma.activityLog.findMany({
        where: { accountId: account.id, kind: "dm", direction: "in" },
        take: 200,
      });
      const buckets: Record<string, number> = {};
      for (const l of logs) {
        const t = l.text.toLowerCase();
        const key = t.includes("narx") || t.includes("price")
          ? "narx"
          : t.includes("yetkaz") || t.includes("dostav")
            ? "yetkazib berish"
            : t.includes("olcham") || t.includes("size")
              ? "o'lcham"
              : "boshqa";
        buckets[key] = (buckets[key] || 0) + 1;
      }
      return textResult(JSON.stringify(buckets, null, 2));
    }
    case "list_pending_approvals": {
      const rows = await prisma.approval.findMany({
        where: { userId, status: "pending" },
        orderBy: { createdAt: "desc" },
      });
      return textResult(JSON.stringify(rows.map((r) => ({ id: r.id, summary: r.summary, status: r.status })), null, 2));
    }
    default:
      throw new Error(`Noma'lum vosita: ${name}`);
  }
}

export function mcpInitialize() {
  return {
    protocolVersion: "2025-03-26",
    capabilities: { tools: {} },
    serverInfo: { name: "instagram-cloud", version: "1.0.0" },
    instructions:
      "Bu Instagram Cloud MCP serveri. O'qish vositalari darhol ishlaydi. Yozish (javob, Direct, Reels, qoida) foydalanuvchi kabinetida tasdiqlanmaguncha bajarilmaydi.",
  };
}

export async function handleJsonRpc(userId: string, body: Json) {
  const id = body.id;
  const method = String(body.method || "");
  const params = (body.params || {}) as Json;

  try {
    if (method === "initialize") {
      return { jsonrpc: "2.0", id, result: mcpInitialize() };
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      return null;
    }
    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }
    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
    }
    if (method === "tools/call") {
      const name = String(params.name || "");
      const args = (params.arguments || {}) as Json;
      const result = await callTool(userId, name, args);
      return { jsonrpc: "2.0", id, result };
    }
    if (method === "resources/list") {
      return { jsonrpc: "2.0", id, result: { resources: [] } };
    }
    if (method === "prompts/list") {
      return { jsonrpc: "2.0", id, result: { prompts: [] } };
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: e instanceof Error ? e.message : "Xato" },
    };
  }
}

export { executeApprovedAction };
