import type { InstagramAccount } from "@prisma/client";
import { prisma } from "./db";
import { executeApprovedAction } from "./actions";
import { freshToken, mediaWithInsights, safeInsights, syncIfStale } from "./ig-data";
import { createUploadToken, listUploads, mediaUrl, saveBytes } from "./uploads";
import { configuredUrl } from "./url";
import { renderVideo, THEME_NAMES, type VideoSpec } from "./video";
import { accountTotals, followerDemographics, listComments, listMedia, profile, type IgComment } from "./instagram";

type Json = Record<string, unknown>;
type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[] };
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
};

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const account = { type: "string", description: "Instagram username yoki id. Bitta akkaunt bo'lsa, shart emas." };
const locationId = {
  type: "string",
  description:
    "Lokatsiya: joyning Facebook sahifasi ID si (raqam). Shahrisabz shahri — 361740101103266. Boshqa joyni instagram.com/explore/locations/ dagi uzun raqamli ID dan oling (qisqa 9 xonalilar ishlamaydi).",
};
const collaborators = {
  type: "array",
  items: { type: "string" },
  description: "Hamkorlar (collab): 3 tagacha Instagram username. Ularga taklif boradi, qabul qilsa post ikkala profilda ko'rinadi.",
};
const READ = { readOnlyHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

function tool(name: string, title: string, description: string, properties: Record<string, unknown>, required: string[] = [], annotations: Tool["annotations"] = READ): Tool {
  return {
    name,
    title,
    description,
    inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) },
    annotations,
  };
}

export const MCP_TOOLS: Tool[] = [
  tool("list_instagram_accounts", "Instagram akkauntlar", "Ulangan Instagram akkauntlari. Shundan boshlang.", {}),
  tool(
    "instagram_analytics",
    "Akkaunt statistikasi",
    "Obunachilar, 30 kunlik qamrov/ko'rishlar/interaksiyalar, obunachi o'sishi va demografiya (yosh, jins, davlat, shahar). Avval `definitions` ni o'qing: reach — noyob akkauntlar, kunlik qiymatlarni qo'shib bo'lmaydi.",
    { account }
  ),
  tool(
    "instagram_reels_report",
    "Reels hisoboti",
    "Oxirgi Reels'larning barcha ko'rsatkichlari bitta chaqiriqda: ko'rishlar, qamrov, ulashish, saqlash, o'rtacha tomosha vaqti, qamrovga nisbatan foizlar va medianaga solishtirish. «Qaysi Reels ishladi va nega» uchun.",
    { account, limit: { type: "number", description: "Nechta Reels (standart 20, ko'pi 50)" } }
  ),
  tool(
    "instagram_list_media",
    "Postlar",
    "Postlar sahifama-sahifa (`after`), har birining qamrovi, interaksiyasi va engagement rate bilan.",
    { account, limit: { type: "number" }, after: { type: "string", description: "Oldingi javobdagi `next_after`" } }
  ),
  tool("instagram_media_insights", "Post statistikasi", "Bitta post yoki Reels'ning to'liq ko'rsatkichlari.", { account, media_id: { type: "string" } }, ["media_id"]),
  tool(
    "instagram_list_comments",
    "Kommentlar",
    "Post ostidagi kommentlar va javoblar, sahifama-sahifa (`after`). media_id berilmasa — avto-javob jurnalidagi oxirgi kommentlar.",
    { account, media_id: { type: "string" }, after: { type: "string" } }
  ),
  tool(
    "instagram_unanswered_comments",
    "Javobsiz kommentlar",
    "Oxirgi postlardagi akkaunt hali javob bermagan kommentlar.",
    { account, posts: { type: "number", description: "Nechta oxirgi post ko'riladi (standart 5, ko'pi 15)" } }
  ),
  tool(
    "instagram_list_direct_messages",
    "Direct xabarlar",
    "Kelgan Direct xabarlar va avto-javob nima qilgani. `only_unanswered` — odam javob berishi kerak bo'lganlar.",
    { account, only_unanswered: { type: "boolean" }, limit: { type: "number" } }
  ),
  tool("instagram_list_automations", "Avto-javoblar", "Barcha komment qoidalari, Direct qoidalari, Direct avto-javob holati va standart javob.", { account }),
  tool(
    "instagram_automation_report",
    "Avto-javob hisoboti",
    "Avto-javoblar davr ichida nima qilgani: nechta komment/Direct keldi, nechtasiga javob ketdi, qaysi qoidalar ishladi.",
    { account, since: { type: "string", description: "ISO-8601, standart: 7 kun oldin" }, until: { type: "string" } }
  ),
  tool("list_pending_approvals", "Kutilayotgan tasdiqlar", "Kabinetda hali tasdiqlanmagan AI harakatlari.", {}),

  tool("instagram_reply_comment", "Kommentga javob", "Kommentga ochiq javob yozadi.", { account, comment_id: { type: "string" }, text: { type: "string" } }, ["comment_id", "text"], WRITE),
  tool(
    "instagram_private_reply",
    "Kommentchiga Direct",
    "Komment yozgan odamga Direct'da javob yozadi (komment 7 kundan eski bo'lmasin).",
    { account, comment_id: { type: "string" }, text: { type: "string" } },
    ["comment_id", "text"],
    WRITE
  ),
  tool(
    "instagram_hide_comment",
    "Kommentni yashirish",
    "Kommentni yashiradi (hide=false — qaytaradi). O'chirishdan ko'ra shuni afzal ko'ring.",
    { account, comment_id: { type: "string" }, hide: { type: "boolean" } },
    ["comment_id"],
    { ...WRITE, idempotentHint: true }
  ),
  tool("instagram_delete_comment", "Kommentni o'chirish", "Kommentni butunlay o'chiradi. Qaytarib bo'lmaydi.", { account, comment_id: { type: "string" } }, ["comment_id"], { ...WRITE, destructiveHint: true }),
  tool(
    "instagram_send_dm",
    "Direct yuborish",
    "Akkauntga yozgan odamga Direct yuboradi (faqat uning oxirgi xabaridan 24 soat ichida). recipient_id — instagram_list_direct_messages dagi `from_id`.",
    { account, recipient_id: { type: "string" }, text: { type: "string" } },
    ["recipient_id", "text"],
    WRITE
  ),
  tool(
    "instagram_upload_link",
    "Fayl yuklash havolasi",
    "Chatdagi video yoki rasmni Instagramga joylash uchun: bu vosita fayl yuklanadigan sahifa havolasini beradi. Foydalanuvchiga havolani bering, u faylni o'sha yerga yuklaydi, keyin instagram_list_uploads dan upload_id ni olib joylang. Chatga biriktirilgan faylni to'g'ridan-to'g'ri uzatib bo'lmaydi.",
    {}
  ),
  tool(
    "instagram_make_video",
    "Video yasash",
    `Vertikal (9:16) Reels videoni serverda yasaydi — ffmpeg yo'q joyda ham (masalan telefondagi Claude). Siz ssenariyni berasiz: slaydlar (sarlavha + ixtiyoriy izoh + soniya), mavzu rangi, tepadagi brend nomi va pastdagi doimiy qator (telefon). Natija — upload_id va ko'rish havolasi; keyin instagram_publish_reel / instagram_publish_story bilan joylang. Jami 3–60 s, 12 slaydgacha. Matnlar animatsiya bilan chiqadi; emoji chizilmaydi.`,
    {
      slides: {
        type: "array",
        description: "Ketma-ket slaydlar",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Katta matn, ~40 belgigacha" },
            subtitle: { type: "string", description: "Kichik izoh (ixtiyoriy)" },
            seconds: { type: "number", description: "1.5–10, standart 3" },
          },
          required: ["title"],
        },
      },
      theme: { type: "string", enum: THEME_NAMES, description: "Rang: sky (standart), ocean, red, sunset, dark, light" },
      brand: { type: "string", description: "Tepada har slaydda turadigan nom, masalan «Oson Market POS»" },
      footer: { type: "string", description: "Pastda doim turadigan qator, masalan telefon raqam" },
    },
    ["slides"],
    WRITE
  ),
  tool(
    "instagram_upload_url",
    "To'g'ridan-to'g'ri yuklash havolasi",
    "Shell'i bor AI uchun (Claude Code va h.k.): o'zingiz yasagan video yoki JPEG ni brauzersiz yuklash havolasi, 30 daqiqa amal qiladi. `curl -X POST --data-binary @video.mp4 -H \"Content-Type: video/mp4\" \"<upload_url>\"` — javobda upload_id keladi, keyin joylang.",
    {}
  ),
  tool(
    "instagram_list_uploads",
    "Yuklangan fayllar",
    "Saytga yuklangan video va rasmlar (upload_id, nomi, turi, joylanganmi). `available: false` — muddati o'tgan yoki joylangan, qayta yuklash kerak.",
    {}
  ),
  tool(
    "instagram_publish_reel",
    "Reels joylash",
    "Videoni (MP4/MOV, 9:16, 3–90 s) Reels sifatida joylaydi; share_to_feed (standart true) — profil lentasida post bo'lib ham ko'rinadi. upload_id (saytga yuklangan fayl) yoki ochiq video_url bering. Video Instagramda qayta ishlanguncha 1–2 daqiqa kutiladi. Bitta fayldan story ham kerak bo'lsa, avval instagram_publish_story ni chaqiring — post joylangach fayl o'chiriladi.",
    {
      account,
      upload_id: { type: "string" },
      video_url: { type: "string" },
      caption: { type: "string" },
      location_id: locationId,
      collaborators,
      share_to_feed: { type: "boolean", description: "Lentada ham ko'rinsin (standart true)" },
    },
    ["caption"],
    WRITE
  ),
  tool(
    "instagram_publish_photo",
    "Rasm joylash",
    "JPEG rasmni post sifatida joylaydi. upload_id (saytga yuklangan rasm) yoki ochiq image_url bering. Bitta fayldan story ham kerak bo'lsa, avval instagram_publish_story ni chaqiring.",
    { account, upload_id: { type: "string" }, image_url: { type: "string" }, caption: { type: "string" }, location_id: locationId, collaborators },
    ["caption"],
    WRITE
  ),
  tool(
    "instagram_publish_story",
    "Story joylash",
    "Video (MP4/MOV, 9:16, 60 s gacha) yoki JPEG rasmni Story qilib joylaydi, 24 soat turadi. Story'ga API orqali matn, lokatsiya va hamkor qo'shib bo'lmaydi. upload_id yoki ochiq video_url / image_url bering. Fayl o'chirilmaydi — keyin shu upload_id dan post ham joylash mumkin.",
    { account, upload_id: { type: "string" }, video_url: { type: "string" }, image_url: { type: "string" } },
    [],
    WRITE
  ),
  tool(
    "instagram_save_comment_rule",
    "Komment qoidasi",
    "Kalit so'zli (yoki istalgan) komment → kommentchiga Direct + ixtiyoriy ochiq javob. rule_id berilsa — o'sha qoida yangilanadi. Kalit so'zlar vergul bilan, katta-kichik harf farqsiz, «contains» — qism mos kelishi.",
    {
      account,
      rule_id: { type: "string" },
      keywords: { type: "string", description: "narx, necha pul, price — bo'sh bo'lsa istalgan komment" },
      match: { type: "string", enum: ["contains", "any"] },
      media_id: { type: "string", description: "Faqat shu post ostida" },
      dm_message: { type: "string" },
      public_replies: { type: "array", items: { type: "string" }, description: "Navbat bilan ishlatiladigan ochiq javoblar" },
      is_active: { type: "boolean" },
    },
    ["dm_message"],
    WRITE
  ),
  tool(
    "instagram_save_dm_rule",
    "Direct qoidasi",
    "Kalit so'zli Direct xabar → avtomatik javob. rule_id berilsa — yangilanadi.",
    { account, rule_id: { type: "string" }, keywords: { type: "string" }, reply: { type: "string" }, is_active: { type: "boolean" } },
    ["keywords", "reply"],
    WRITE
  ),
  tool("instagram_delete_automation_rule", "Qoidani o'chirish", "Avto-javob qoidasini o'chiradi (to'xtatish uchun is_active=false bilan saqlang).", { account, rule_id: { type: "string" } }, ["rule_id"], { ...WRITE, destructiveHint: true }),
  tool(
    "instagram_configure_direct",
    "Direct sozlamalari",
    "Direct avto-javob yoqish/o'chirish, standart javob va u qanchalik tez-tez ketishi (first — faqat birinchi xabarga, daily — kuniga bir marta, always — har doim, off — yo'q). comment_replies — komment avto-javoblari.",
    {
      account,
      enabled: { type: "boolean" },
      default_reply: { type: "string" },
      mode: { type: "string", enum: ["first", "daily", "always", "off"] },
      comment_replies: { type: "boolean" },
    },
    [],
    { ...WRITE, idempotentHint: true }
  ),
];

function postExtrasSummary(a: Json) {
  const parts = [];
  if (a.location_id) parts.push(`lokatsiya ${a.location_id}`);
  if (Array.isArray(a.collaborators) && a.collaborators.length) parts.push(`hamkorlar: ${a.collaborators.join(", ")}`);
  return parts.length ? `, ${parts.join(", ")}` : "";
}

// MCP tool name → action in actions.ts, with the arguments renamed
const WRITE_ACTIONS: Record<string, { action: string; payload: (a: Json) => Json; summary: (a: Json) => string }> = {
  instagram_reply_comment: {
    action: "reply_comment",
    payload: (a) => ({ commentId: a.comment_id, text: a.text }),
    summary: (a) => `Komment ${a.comment_id} ga ochiq javob: «${a.text}»`,
  },
  instagram_private_reply: {
    action: "private_reply",
    payload: (a) => ({ commentId: a.comment_id, text: a.text }),
    summary: (a) => `Komment ${a.comment_id} egasiga Direct: «${a.text}»`,
  },
  instagram_hide_comment: {
    action: "hide_comment",
    payload: (a) => ({ commentId: a.comment_id, hide: a.hide !== false }),
    summary: (a) => `Komment ${a.comment_id} ni ${a.hide === false ? "qaytarish" : "yashirish"}`,
  },
  instagram_delete_comment: {
    action: "delete_comment",
    payload: (a) => ({ commentId: a.comment_id }),
    summary: (a) => `Komment ${a.comment_id} ni o'chirish`,
  },
  instagram_send_dm: {
    action: "send_dm",
    payload: (a) => ({ recipientId: a.recipient_id, text: a.text }),
    summary: (a) => `Direct ${a.recipient_id} ga: «${a.text}»`,
  },
  instagram_publish_reel: {
    action: "publish_reel",
    payload: (a) => ({
      uploadId: a.upload_id,
      videoUrl: a.video_url,
      caption: a.caption,
      locationId: a.location_id,
      collaborators: a.collaborators,
      shareToFeed: a.share_to_feed,
    }),
    summary: (a) => `Reels joylash: «${a.caption}» (${a.upload_id ? `fayl ${a.upload_id}` : a.video_url})${postExtrasSummary(a)}`,
  },
  instagram_publish_photo: {
    action: "publish_photo",
    payload: (a) => ({ uploadId: a.upload_id, imageUrl: a.image_url, caption: a.caption, locationId: a.location_id, collaborators: a.collaborators }),
    summary: (a) => `Rasm joylash: «${a.caption}» (${a.upload_id ? `fayl ${a.upload_id}` : a.image_url})${postExtrasSummary(a)}`,
  },
  instagram_publish_story: {
    action: "publish_story",
    payload: (a) => ({ uploadId: a.upload_id, videoUrl: a.video_url, imageUrl: a.image_url }),
    summary: (a) => `Story joylash (${a.upload_id ? `fayl ${a.upload_id}` : a.video_url || a.image_url})`,
  },
  instagram_save_comment_rule: {
    action: "save_comment_rule",
    payload: (a) => ({
      ruleId: a.rule_id,
      keywords: a.keywords,
      matchMode: a.match,
      mediaId: a.media_id,
      dmMessage: a.dm_message,
      publicReplies: a.public_replies,
      enabled: a.is_active,
    }),
    summary: (a) => `${a.rule_id ? "Komment qoidasini yangilash" : "Yangi komment qoidasi"}: «${a.keywords || "istalgan komment"}» → «${a.dm_message}»`,
  },
  instagram_save_dm_rule: {
    action: "save_dm_rule",
    payload: (a) => ({ ruleId: a.rule_id, keywords: a.keywords, dmMessage: a.reply, enabled: a.is_active }),
    summary: (a) => `${a.rule_id ? "Direct qoidasini yangilash" : "Yangi Direct qoidasi"}: «${a.keywords}» → «${a.reply}»`,
  },
  instagram_delete_automation_rule: {
    action: "delete_rule",
    payload: (a) => ({ ruleId: a.rule_id }),
    summary: (a) => `Qoida ${a.rule_id} ni o'chirish`,
  },
  instagram_configure_direct: {
    action: "configure_direct",
    payload: (a) => ({ enabled: a.enabled, defaultReply: a.default_reply, mode: a.mode, commentRepliesOn: a.comment_replies }),
    summary: (a) => `Direct sozlamalari: ${JSON.stringify(a)}`,
  },
};

function result(data: unknown) {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

class ToolError extends Error {}

async function pickAccount(userId: string, ref?: unknown) {
  const accounts = await prisma.instagramAccount.findMany({ where: { userId }, orderBy: { connectedAt: "desc" } });
  if (!accounts.length) throw new ToolError("Instagram hali ulanmagan. Saytdagi kabinetda «Instagramni ulash» ni bosing.");
  if (ref) {
    const r = String(ref).replace(/^@/, "").toLowerCase();
    const a = accounts.find((x) => x.id === ref || x.igUserId === ref || x.username.toLowerCase() === r);
    if (!a) throw new ToolError(`Akkaunt topilmadi: ${ref}. Bor akkauntlar: ${accounts.map((x) => "@" + x.username).join(", ")}`);
    return a;
  }
  if (accounts.length > 1) {
    throw new ToolError(`Bir nechta akkaunt bor — \`account\` ni ko'rsating: ${accounts.map((x) => "@" + x.username).join(", ")}`);
  }
  return accounts[0];
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : null);

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

async function analytics(a: InstagramAccount) {
  const definitions = {
    reach: "Noyob akkauntlar soni davr bo'yicha. Kunlik reach'larni qo'shib bo'lmaydi.",
    views: "Ko'rishlar soni (takroriy ko'rishlar ham).",
    total_interactions: "Like + komment + saqlash + ulashish (+ javoblar).",
    engagement_rate: "Oxirgi postlardagi interaksiyalar / obunachilar.",
  };
  if (a.isDemo) {
    await syncIfStale(a);
    const media = await prisma.mediaItem.findMany({ where: { accountId: a.id } });
    const sum = (k: "views" | "reach" | "likes" | "comments" | "saves" | "shares") => media.reduce((s, m) => s + m[k], 0);
    return {
      demo: true,
      username: a.username,
      followers: a.followersCount,
      period: "demo ma'lumotlar",
      totals: { views: sum("views"), likes: sum("likes"), comments: sum("comments"), saves: sum("saves"), shares: sum("shares") },
      definitions,
    };
  }
  const token = await freshToken(a);
  const until = new Date();
  const since = new Date(until.getTime() - 29 * 24 * 60 * 60 * 1000);
  const p = await profile(a.igUserId, token);
  await prisma.instagramAccount.update({
    where: { id: a.id },
    data: { followersCount: p.followers_count ?? a.followersCount, profilePic: p.profile_picture_url || a.profilePic },
  });
  const out: Json = {
    username: p.username,
    name: p.name,
    followers: p.followers_count,
    following: p.follows_count,
    posts: p.media_count,
    definitions,
  };
  try {
    out.last_30_days = { period: { since: since.toISOString(), until: until.toISOString() }, ...(await accountTotals(a.igUserId, token, since, until)) };
  } catch (e) {
    out.last_30_days = { error: (e as Error).message };
  }
  const demographics: Json = { period: "this_month", note: "100+ obunachisi bor akkauntlar uchun" };
  for (const b of ["age", "gender", "country", "city"] as const) {
    try {
      demographics[b] = await followerDemographics(a.igUserId, token, b);
    } catch (e) {
      demographics[b] = { error: (e as Error).message };
    }
  }
  out.follower_demographics = demographics;
  try {
    const recent = await listMedia(a.igUserId, token, 12);
    const inter = (recent.data || []).map((m) => (m.like_count || 0) + (m.comments_count || 0));
    out.recent_posts_engagement = {
      posts: inter.length,
      avg_likes_plus_comments: inter.length ? Math.round(inter.reduce((x, y) => x + y, 0) / inter.length) : 0,
      engagement_rate: pct(inter.length ? inter.reduce((x, y) => x + y, 0) / inter.length : 0, p.followers_count || 0),
    };
  } catch {}
  return out;
}

async function reelsReport(a: InstagramAccount, limit: number) {
  if (!a.isDemo) {
    const token = await freshToken(a);
    const page = await listMedia(a.igUserId, token, 50);
    const reels = (page.data || []).filter((m) => m.media_product_type === "REELS").slice(0, limit);
    const rows = [];
    for (const m of reels) {
      const i = await safeInsights(m, token);
      rows.push({
        id: m.id,
        caption: (m.caption || "").slice(0, 120),
        date: m.timestamp,
        permalink: m.permalink,
        views: i.views || 0,
        reach: i.reach || 0,
        likes: i.likes ?? m.like_count ?? 0,
        comments: i.comments ?? m.comments_count ?? 0,
        shares: i.shares || 0,
        saves: i.saved || 0,
        avg_watch_sec: +((i.ig_reels_avg_watch_time || 0) / 1000).toFixed(1),
        total_watch_hours: +((i.ig_reels_video_view_total_time || 0) / 3_600_000).toFixed(1),
      });
    }
    return withMedians(a.username, rows);
  }
  const media = await prisma.mediaItem.findMany({ where: { accountId: a.id, mediaType: "REELS" }, orderBy: { timestamp: "desc" }, take: limit });
  return withMedians(
    a.username,
    media.map((m) => ({
      id: m.igMediaId,
      caption: m.caption,
      date: m.timestamp?.toISOString(),
      permalink: m.permalink,
      views: m.views,
      reach: m.reach,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      saves: m.saves,
      avg_watch_sec: m.avgWatchSec,
      total_watch_hours: 0,
    }))
  );
}

type ReelRow = { views: number; reach: number; shares: number; saves: number; avg_watch_sec: number; [k: string]: unknown };

function withMedians(username: string, rows: ReelRow[]) {
  const med = {
    views: median(rows.map((r) => r.views)),
    reach: median(rows.map((r) => r.reach)),
    shares: median(rows.map((r) => r.shares)),
    saves: median(rows.map((r) => r.saves)),
    avg_watch_sec: median(rows.map((r) => r.avg_watch_sec)),
  };
  return {
    username,
    reels: rows.length,
    median: med,
    items: rows.map((r) => ({
      ...r,
      share_rate: pct(r.shares, r.reach),
      save_rate: pct(r.saves, r.reach),
      views_vs_median: med.views ? `${(r.views / med.views).toFixed(2)}x` : null,
    })),
  };
}

function shapeComment(c: IgComment, own: string) {
  return {
    id: c.id,
    username: c.username || c.from?.username,
    from_id: c.from?.id,
    text: c.text,
    timestamp: c.timestamp,
    likes: c.like_count,
    hidden: c.hidden,
    replies: (c.replies?.data || []).map((r) => ({ id: r.id, username: r.username, text: r.text, timestamp: r.timestamp, by_account: r.username === own })),
  };
}

async function unansweredComments(a: InstagramAccount, posts: number) {
  if (a.isDemo) {
    const logs = await prisma.activityLog.findMany({ where: { accountId: a.id, kind: { in: ["comment", "comment_reply"] } }, orderBy: { createdAt: "desc" }, take: 200 });
    const answered = new Set(logs.filter((l) => l.kind === "comment_reply" && l.text).map((l) => l.commentId));
    return {
      demo: true,
      comments: logs.filter((l) => l.kind === "comment" && !answered.has(l.commentId)).map((l) => ({ id: l.commentId, username: l.username, text: l.text, media_id: l.mediaId, timestamp: l.createdAt })),
    };
  }
  const token = await freshToken(a);
  const media = await listMedia(a.igUserId, token, posts);
  const out = [];
  for (const m of media.data || []) {
    if (!m.comments_count) continue;
    const page = await listComments(m.id, token, 50);
    for (const c of page.data || []) {
      const by = c.username || c.from?.username;
      if (by === a.username) continue;
      if ((c.replies?.data || []).some((r) => r.username === a.username)) continue;
      out.push({ id: c.id, username: by, from_id: c.from?.id, text: c.text, timestamp: c.timestamp, hidden: c.hidden, media_id: m.id, media_caption: (m.caption || "").slice(0, 80), permalink: m.permalink });
    }
  }
  return { username: a.username, posts_checked: media.data?.length || 0, unanswered: out.length, comments: out };
}

async function directMessages(a: InstagramAccount, onlyUnanswered: boolean, limit: number) {
  const logs = await prisma.activityLog.findMany({
    where: { accountId: a.id, kind: { in: ["dm", "dm_reply", "dm_auto_reply"] } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  // last_out counts only replies by a person or the AI; auto-replies don't settle a conversation
  const convos = new Map<string, { from_id: string; username: string | null; last_in?: Date; last_out?: Date; auto_replied?: boolean; messages: Json[] }>();
  for (const l of logs) {
    const key = l.igUserId || "?";
    const c = convos.get(key) || { from_id: key, username: null, messages: [] };
    if (l.direction === "in") {
      c.username = c.username || l.username;
      c.last_in = c.last_in || l.createdAt;
    } else if (l.kind === "dm_auto_reply") {
      c.auto_replied = true;
    } else {
      c.last_out = c.last_out || l.createdAt;
    }
    const direction = l.direction === "in" ? "kelgan" : l.kind === "dm_auto_reply" ? "avto-javob" : "javob";
    if (c.messages.length < 6) c.messages.push({ direction, text: l.text, at: l.createdAt });
    convos.set(key, c);
  }
  let rows = [...convos.values()].filter((c) => c.last_in);
  if (onlyUnanswered) rows = rows.filter((c) => !c.last_out || c.last_out < c.last_in!);
  return {
    username: a.username,
    note: "Xabarlar akkaunt ulangandan keyin keladi (webhook). Javob faqat oxirgi xabardan 24 soat ichida yuboriladi.",
    conversations: rows.slice(0, limit).map((c) => ({
      from_id: c.from_id,
      username: c.username,
      last_message_at: c.last_in,
      answered: Boolean(c.last_out && c.last_out >= c.last_in!),
      auto_replied: Boolean(c.auto_replied),
      can_reply_until: new Date(c.last_in!.getTime() + 24 * 60 * 60 * 1000),
      messages: c.messages.reverse(),
    })),
  };
}

async function automations(a: InstagramAccount) {
  const rules = await prisma.autoRule.findMany({ where: { accountId: a.id }, orderBy: { createdAt: "asc" } });
  const shape = (r: (typeof rules)[number]) => ({
    rule_id: r.id,
    keywords: parseList(r.keywords).join(", "),
    match: r.matchMode,
    media_ids: parseList(r.mediaIds),
    reply: r.dmMessage,
    public_replies: r.type === "comment" ? parseList(r.publicReplies) : undefined,
    is_active: r.enabled,
  });
  return {
    username: a.username,
    comment_auto_replies: a.commentRepliesOn,
    direct_auto_replies: a.dmAutoReplyEnabled,
    webhooks_last_received: a.lastWebhookAt,
    webhooks_note: a.isDemo || a.lastWebhookAt
      ? undefined
      : "Instagram'dan hali bitta ham webhook kelmagan — qoidalar saqlangan, lekin komment/Direct kelmaguncha ishlamaydi. Meta ilovasida Webhooks (comments, messages) obunasi va ilova rejimini tekshirish kerak; kabinetdagi «Boshqaruv» sahifasida ko'rsatma bor.",
    default_reply: a.defaultDmReply,
    default_reply_mode: a.defaultDmMode,
    comment_rules: rules.filter((r) => r.type === "comment").map(shape),
    dm_rules: rules.filter((r) => r.type === "dm").map(shape),
  };
}

async function automationReport(userId: string, ref: unknown, sinceRaw: unknown, untilRaw: unknown) {
  const until = untilRaw ? new Date(String(untilRaw)) : new Date();
  const since = sinceRaw ? new Date(String(sinceRaw)) : new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
  const accounts = ref ? [await pickAccount(userId, ref)] : await prisma.instagramAccount.findMany({ where: { userId } });
  const out = [];
  for (const a of accounts) {
    const logs = await prisma.activityLog.findMany({ where: { accountId: a.id, createdAt: { gte: since, lte: until } } });
    const n = (kind: string, dir: string) => logs.filter((l) => l.kind === kind && l.direction === dir).length;
    const topWords: Record<string, number> = {};
    for (const l of logs.filter((x) => x.direction === "in")) {
      for (const w of l.text.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter((x) => x.length > 2)) topWords[w] = (topWords[w] || 0) + 1;
    }
    out.push({
      username: a.username,
      comments_in: n("comment", "in"),
      comment_auto_replies: n("comment_reply", "out"),
      dms_in: n("dm", "in"),
      dm_auto_replies: n("dm_auto_reply", "out"),
      dm_manual_replies: n("dm_reply", "out"),
      published: n("publish", "out"),
      frequent_words: Object.entries(topWords).sort((x, y) => y[1] - x[1]).slice(0, 15).map(([w, c]) => `${w} (${c})`),
    });
  }
  return { period: { since: since.toISOString(), until: until.toISOString() }, accounts: out };
}

async function readTool(userId: string, name: string, args: Json, base: string) {
  switch (name) {
    case "list_instagram_accounts": {
      const accounts = await prisma.instagramAccount.findMany({ where: { userId } });
      if (!accounts.length) return "Instagram hali ulanmagan. Saytdagi kabinetda «Instagramni ulash» ni bosing.";
      return accounts.map((a) => ({ id: a.id, username: a.username, name: a.name, followers: a.followersCount, demo: a.isDemo, connected_at: a.connectedAt }));
    }
    case "instagram_analytics":
      return analytics(await pickAccount(userId, args.account));
    case "instagram_reels_report":
      return reelsReport(await pickAccount(userId, args.account), Math.min(Number(args.limit) || 20, 50));
    case "instagram_list_media": {
      const a = await pickAccount(userId, args.account);
      const limit = Math.min(Number(args.limit) || 12, 25);
      if (a.isDemo) {
        const media = await prisma.mediaItem.findMany({ where: { accountId: a.id }, orderBy: { timestamp: "desc" }, take: limit });
        return { demo: true, items: media.map((m) => ({ id: m.igMediaId, type: m.mediaType, caption: m.caption, reach: m.reach, views: m.views, interactions: m.likes + m.comments + m.saves + m.shares })) };
      }
      const token = await freshToken(a);
      const page = await listMedia(a.igUserId, token, limit, args.after ? String(args.after) : undefined);
      const items = [];
      for (const m of page.data || []) {
        const i = await safeInsights(m, token);
        items.push({
          id: m.id,
          type: m.media_product_type || m.media_type,
          caption: (m.caption || "").slice(0, 160),
          date: m.timestamp,
          permalink: m.permalink,
          reach: i.reach,
          views: i.views,
          interactions: i.total_interactions,
          engagement_rate_by_reach: pct(i.total_interactions || 0, i.reach || 0),
        });
      }
      return { items, next_after: page.paging?.next ? page.paging.cursors?.after : null };
    }
    case "instagram_media_insights": {
      const a = await pickAccount(userId, args.account);
      if (a.isDemo) {
        const m = await prisma.mediaItem.findFirst({ where: { accountId: a.id, igMediaId: String(args.media_id) } });
        if (!m) throw new ToolError("Post topilmadi");
        return { demo: true, ...m };
      }
      return mediaWithInsights(a, String(args.media_id));
    }
    case "instagram_list_comments": {
      const a = await pickAccount(userId, args.account);
      if (a.isDemo || !args.media_id) {
        const logs = await prisma.activityLog.findMany({
          where: { accountId: a.id, kind: { in: ["comment", "comment_reply"] }, ...(args.media_id ? { mediaId: String(args.media_id) } : {}) },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return { source: "avto-javob jurnali", items: logs.map((l) => ({ comment_id: l.commentId, kind: l.kind, username: l.username, text: l.text, dm_sent: l.replyText, media_id: l.mediaId, at: l.createdAt })) };
      }
      const token = await freshToken(a);
      const page = await listComments(String(args.media_id), token, 50, args.after ? String(args.after) : undefined);
      return { items: (page.data || []).map((c) => shapeComment(c, a.username)), next_after: page.paging?.cursors?.after || null };
    }
    case "instagram_unanswered_comments":
      return unansweredComments(await pickAccount(userId, args.account), Math.min(Number(args.posts) || 5, 15));
    case "instagram_list_direct_messages":
      return directMessages(await pickAccount(userId, args.account), Boolean(args.only_unanswered), Math.min(Number(args.limit) || 30, 100));
    case "instagram_list_automations":
      return automations(await pickAccount(userId, args.account));
    case "instagram_automation_report":
      return automationReport(userId, args.account, args.since, args.until);
    case "instagram_upload_link":
      return {
        url: `${base}/dashboard?tab=publish`,
        say: "Shu havolani oching, video (MP4/MOV, 100 MB gacha) yoki JPEG rasmni yuklang va menga «yukladim» deb yozing.",
      };
    case "instagram_make_video": {
      const { bytes, seconds } = await renderVideo(args as unknown as VideoSpec);
      const u = await saveBytes(userId, bytes, `claude-${Date.now()}.mp4`, "video/mp4");
      return {
        upload_id: u.id,
        seconds,
        size_mb: +(u.size / 1024 / 1024).toFixed(2),
        preview_url: mediaUrl(u.publicToken, base),
        next: "Joylash uchun instagram_publish_reel (upload_id) — story ham kerak bo'lsa avval instagram_publish_story.",
      };
    }
    case "instagram_upload_url": {
      const origin = configuredUrl() || base;
      const url = `${origin}/api/uploads/direct?token=${await createUploadToken(userId)}`;
      return {
        upload_url: url,
        expires_in_minutes: 30,
        example: `curl -X POST --data-binary @video.mp4 -H "Content-Type: video/mp4" "${url}"`,
        note: "Content-Type: video/mp4, video/quicktime yoki image/jpeg. Javobdagi upload_id bilan joylang.",
      };
    }
    case "instagram_list_uploads":
      return (await listUploads(userId)).map((u) => ({
        upload_id: u.id,
        filename: u.filename,
        kind: u.kind,
        size_mb: +(u.size / 1024 / 1024).toFixed(1),
        uploaded_at: u.createdAt,
        available: u.available,
        published_id: u.publishedId,
      }));
    case "list_pending_approvals": {
      const rows = await prisma.approval.findMany({ where: { userId, status: "pending" }, orderBy: { createdAt: "desc" } });
      return rows.map((r) => ({ id: r.id, summary: r.summary, created_at: r.createdAt }));
    }
  }
  throw new ToolError(`Noma'lum vosita: ${name}`);
}

export async function callTool(userId: string, name: string, args: Json, base = "") {
  const write = WRITE_ACTIONS[name];
  if (!write) return result(await readTool(userId, name, args, base));

  const a = await pickAccount(userId, args.account);
  const payload = { ...write.payload(args), accountId: a.id, baseUrl: base };
  const summary = `@${a.username}: ${write.summary(args)}`;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { aiApproval: true } });

  if (user?.aiApproval === "dashboard") {
    const row = await prisma.approval.create({
      data: { userId, accountId: a.id, toolName: write.action, summary, payload: JSON.stringify(payload) },
    });
    return result(
      `Navbatga qo'yildi (ID: ${row.id}). Nima qilinadi: ${summary}\n` +
        `Foydalanuvchi saytdagi kabinetda «AI harakatlari» bo'limida «Ha» bosmaguncha hech narsa yuborilmaydi. Foydalanuvchiga shuni ayting.`
    );
  }

  const res = await executeApprovedAction(write.action, payload);
  await prisma.approval.create({
    data: {
      userId,
      accountId: a.id,
      toolName: write.action,
      summary,
      payload: JSON.stringify(payload),
      status: "executed",
      result: JSON.stringify(res),
      decidedAt: new Date(),
    },
  });
  return result(res);
}

const INSTRUCTIONS = `Bu server foydalanuvchining Instagram business akkauntlarini Instagram Cloud orqali boshqaradi: statistika, postlar, kommentlar, Direct va avto-javoblar. Sanalar ISO-8601.

list_instagram_accounts dan boshlang. Har bir instagram_* vosita \`account\` (username yoki id) oladi; bitta akkaunt bo'lsa, shart emas.

STATISTIKA: instagram_analytics (obunachilar, 30 kun, demografiya — avval definitions ni o'qing), instagram_reels_report (Reels'lar medianaga solishtirib), instagram_list_media, instagram_media_insights.
KOMMENTLAR: instagram_list_comments, instagram_unanswered_comments, instagram_reply_comment (ochiq), instagram_private_reply (Direct'ga), instagram_hide_comment / instagram_delete_comment (yashirishni afzal ko'ring).
DIRECT: instagram_list_direct_messages (only_unanswered — odam javobi kerak bo'lganlar), instagram_send_dm (faqat 24 soat ichida).
VIDEO YASASH: instagram_make_video — ssenariy (slaydlar, rang, brend, telefon) bering, server 9:16 video yasaydi va upload_id qaytaradi; brauzer kerak emas. Shell'i bor AI o'zi yasagan faylni instagram_upload_url orqali curl bilan yuklaydi.
JOYLASH: chatga biriktirilgan faylni uzatib bo'lmaydi — instagram_upload_link havolasini foydalanuvchiga bering, u saytga yuklaydi (yoki yuqoridagi ikki yo'l); keyin instagram_list_uploads dan upload_id olib instagram_publish_reel (video), instagram_publish_photo (JPEG) yoki instagram_publish_story ni chaqiring. Story + post bitta fayldan bo'lsa — avval story, keyin post (post joylangach fayl o'chiriladi). Post va Reels'ga location_id (joyning Facebook sahifa ID si) va collaborators (3 tagacha username) qo'shish mumkin. Ochiq URL bo'lsa, to'g'ridan-to'g'ri video_url / image_url ham bo'ladi.
AVTO-JAVOBLAR: instagram_list_automations, instagram_save_comment_rule, instagram_save_dm_rule, instagram_configure_direct, instagram_delete_automation_rule, instagram_automation_report.
Kalit so'zlar vergul bilan, harf katta-kichikligi farqsiz; "contains" qism mos kelishi, shuning uchun o'zak ("narx") barcha shakllarini ushlaydi. Javoblarni auditoriya tilida yozing (odatda o'zbekcha).

Nashr qiladigan yoki yuboradigan har qanday harakatdan oldin — ochiq javob, Direct, yangi yoki o'zgargan qoida, o'chirish, Reels — foydalanuvchiga aniq matnni ko'rsating va «ha» olganingizdan keyingina vositani chaqiring. Vosita xato qaytarsa, ko'r-ko'rona qayta urinmang — xatoni foydalanuvchiga ayting.`;

export function mcpInitialize(requested?: unknown) {
  const v = typeof requested === "string" && SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
  return {
    protocolVersion: v,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "instagram-cloud", title: "Instagram Cloud", version: "2.0.0" },
    instructions: INSTRUCTIONS,
  };
}

export async function handleJsonRpc(userId: string, body: Json, base = "") {
  const id = body.id;
  const method = String(body.method || "");
  const params = (body.params || {}) as Json;
  // notifications have no id and get no response
  if (id === undefined || method.startsWith("notifications/")) return null;

  try {
    if (method === "initialize") return { jsonrpc: "2.0", id, result: mcpInitialize(params.protocolVersion) };
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
    if (method === "tools/call") {
      const name = String(params.name || "");
      const args = (params.arguments || {}) as Json;
      try {
        return { jsonrpc: "2.0", id, result: await callTool(userId, name, args, base) };
      } catch (e) {
        // tool failures go back to the model as a result it can read and explain
        return { jsonrpc: "2.0", id, result: { ...result({ ok: false, error: e instanceof Error ? e.message : "Xato" }), isError: true } };
      }
    }
    if (method === "resources/list") return { jsonrpc: "2.0", id, result: { resources: [] } };
    if (method === "resources/templates/list") return { jsonrpc: "2.0", id, result: { resourceTemplates: [] } };
    if (method === "prompts/list") return { jsonrpc: "2.0", id, result: { prompts: [] } };
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: -32000, message: e instanceof Error ? e.message : "Xato" } };
  }
}
