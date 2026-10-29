import { prisma } from "./db";
import { callTool, MCP_TOOLS } from "./mcp";
import type { JamoaId } from "./ofis";

// AI Ofis agentlari Instagram Cloud vositalaridan (MCP bilan bir xil) foydalanadi.
// O'qish darhol bajariladi; yozish (javob, Direct, Reels, qoida) mavjud «Tasdiqlar»
// navbatiga tushadi va foydalanuvchi «Ha» demaguncha Instagramga hech narsa ketmaydi.

export const IG_VOSITALAR = MCP_TOOLS;

const NOMLAR: Record<string, string> = {
  list_instagram_accounts: "Ulangan akkauntlar ko'rildi",
  instagram_analytics: "Akkaunt statistikasi o'qildi",
  instagram_reels_report: "Reels hisoboti o'qildi",
  instagram_list_media: "Postlar ro'yxati o'qildi",
  instagram_media_insights: "Post statistikasi o'qildi",
  instagram_list_comments: "Kommentlar o'qildi",
  instagram_unanswered_comments: "Javobsiz kommentlar o'qildi",
  instagram_list_direct_messages: "Direct xabarlar o'qildi",
  instagram_list_automations: "Avto-javob qoidalari ko'rildi",
  instagram_automation_report: "Avto-javob hisoboti o'qildi",
  instagram_list_uploads: "Yuklangan fayllar ko'rildi",
  list_pending_approvals: "Tasdiq navbati ko'rildi",
};

export const amalNomi = (vosita: string) => NOMLAR[vosita] ?? vosita.replace("instagram_", "");

export type IgTasdiq = { id: string; summary: string };

export async function igVosita(userId: string, nom: string, args: Record<string, unknown>) {
  const r = await callTool(userId, nom, { ...args });
  return r.content.map((c) => c.text).join("\n");
}

// Shu so'rov davomida navbatga tushgan tasdiqlar
export async function yangiTasdiqlar(userId: string, dan: Date): Promise<IgTasdiq[]> {
  const rows = await prisma.approval.findMany({
    where: { userId, status: "pending", createdAt: { gte: dan } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, summary: r.summary }));
}

export async function igAkkaunt(userId: string) {
  return prisma.instagramAccount.findFirst({ where: { userId }, orderBy: { connectedAt: "desc" } });
}

const son = (n: number) => n.toLocaleString("uz-UZ").replace(/,/g, " ");

type Natija = { jamoa: JamoaId; natija: string; amallar: string[]; qadamlar: string[] };

// Claude ulanmagan bo'lsa ham Instagram ma'lumotlarini o'qiydigan oddiy yo'naltirgich.
// Instagram so'rovi aniqlansa, xato bo'lsa ham shu yerda javob beriladi — aks holda
// vazifa jimgina boshqa jamoaga (masalan, moliyaga) o'tib ketadi.
export async function lokalInstagram(userId: string, matn: string): Promise<Natija | null> {
  const t = matn.toLowerCase().replace(/[‘’ʻʼ`]/g, "'");
  const ig = /instagram|insta|reels|komment|direct|\bdm\b|obunachi|avto-?javob|qoida|tasdiq/.test(t);
  if (!ig) return null;
  try {
    return await igJavob(userId, t);
  } catch (e) {
    return {
      jamoa: "tahlil",
      natija: `⚠️ Instagram ma'lumotini o'qib bo'lmadi: ${e instanceof Error ? e.message : "xato"}`,
      amallar: [],
      qadamlar: ["Instagram ma'lumotini o'qish"],
    };
  }
}

async function igJavob(userId: string, t: string): Promise<Natija | null> {
  const akk = await igAkkaunt(userId);
  if (!akk) {
    return {
      jamoa: "ijtimoiy",
      natija: "Instagram hali ulanmagan. Kabinetda «Instagramni ulash» tugmasini bosing — keyin men statistika, kommentlar va Direct bilan ishlay olaman.",
      amallar: [],
      qadamlar: ["Instagram ulanishini tekshirish"],
    };
  }

  if (/statist|hisobot|reels|ko'rish|qamrov|obunachi|tahlil/.test(t)) {
    const [ins, rep] = await Promise.all([
      igVosita(userId, "instagram_analytics", {}),
      igVosita(userId, "instagram_reels_report", {}),
    ]);
    const s = JSON.parse(ins) as {
      username: string;
      followers?: number;
      posts?: number;
      totals?: Record<string, number>;
      last_30_days?: Record<string, unknown> & { error?: string };
      recent_posts_engagement?: { engagement_rate: string };
    };
    const r = JSON.parse(rep) as { items: { caption: string; views: number; share_rate: string; avg_watch_sec: number }[] };
    // haqiqiy akkauntda oxirgi 30 kun, demo akkauntda jami ko'rsatkichlar
    const oy = s.last_30_days && !s.last_30_days.error ? s.last_30_days : null;
    const d = (oy ?? s.totals ?? {}) as Record<string, unknown>;
    const n = (k: string) => (typeof d[k] === "number" ? son(d[k] as number) : "—");
    const eng = [...(r.items ?? [])].sort((a, b) => b.views - a.views).slice(0, 3);
    return {
      jamoa: "tahlil",
      amallar: [amalNomi("instagram_analytics"), amalNomi("instagram_reels_report")],
      qadamlar: ["Instagram statistikasini o'qish", "Reels'larni solishtirish", "Hisobot yozish"],
      natija:
        `📊 @${s.username} hisoboti (${oy ? "oxirgi 30 kun" : "jami"})\n` +
        `Obunachilar: ${son(s.followers ?? 0)}${s.posts != null ? ` · Postlar: ${son(s.posts)}` : ""}\n` +
        `Ko'rishlar: ${n("views")} · Qamrov: ${n("reach")}\n` +
        `Like: ${n("likes")} · Komment: ${n("comments")} · Ulashish: ${n("shares")} · Saqlash: ${n("saves")}\n` +
        (s.recent_posts_engagement ? `Oxirgi postlardagi faollik: ${s.recent_posts_engagement.engagement_rate}\n` : "") +
        (s.last_30_days?.error ? `⚠️ 30 kunlik statistika olinmadi: ${s.last_30_days.error}\n` : "") +
        "\n" +
        (eng.length
          ? `Eng ko'p ko'rilgan Reels:\n${eng
              .map((m, i) => `${i + 1}. «${(m.caption || "").slice(0, 50) || "izohsiz"}» — ${son(m.views)} ko'rish, ulashish ${m.share_rate}, o'rtacha ${m.avg_watch_sec}s`)
              .join("\n")}`
          : "Hali Reels ma'lumoti yo'q."),
    };
  }

  if (/komment/.test(t)) {
    const r = JSON.parse(await igVosita(userId, "instagram_unanswered_comments", { posts: 5 })) as {
      comments: { username: string | null; text: string; media_caption?: string }[];
    };
    const javobsiz = r.comments ?? [];
    return {
      jamoa: "ijtimoiy",
      amallar: [amalNomi("instagram_unanswered_comments")],
      qadamlar: ["Kommentlarni o'qish", "Javob berilganini tekshirish", "Xulosa"],
      natija: javobsiz.length
        ? `💬 Javob berilmagan ${javobsiz.length} ta komment:\n` +
          javobsiz
            .slice(0, 8)
            .map((l) => `• @${l.username ?? "?"}: «${(l.text || "").slice(0, 80)}»${l.media_caption ? `\n   ↳ post: «${l.media_caption.slice(0, 40)}»` : ""}`)
            .join("\n") +
          "\n\nJavob yozishimni xohlasangiz, qaysi kommentga va nima deb — ayting (tasdiqingizdan keyin yuboriladi)."
        : "Oxirgi postlarda javobsiz komment yo'q.",
    };
  }

  if (/direct|\bdm\b|xabar|savol/.test(t)) {
    const r = JSON.parse(await igVosita(userId, "instagram_list_direct_messages", { limit: 20 })) as {
      conversations: { username: string | null; answered: boolean; messages: { direction: string; text: string }[] }[];
    };
    const suhbat = r.conversations ?? [];
    const javobsiz = suhbat.filter((x) => !x.answered);
    const oxirgi = (x: (typeof suhbat)[number]) => [...x.messages].reverse().find((m) => m.direction === "kelgan")?.text ?? "";
    return {
      jamoa: "mijozlar",
      amallar: [amalNomi("instagram_list_direct_messages")],
      qadamlar: ["Direct xabarlarni o'qish", "Javobsizlarini ajratish", "Xulosa"],
      natija: suhbat.length
        ? `📩 Direct: ${suhbat.length} ta suhbat, javob kutayotgani — ${javobsiz.length} ta.\n` +
          (javobsiz.length ? javobsiz : suhbat)
            .slice(0, 6)
            .map((x) => `• @${x.username ?? "?"}: «${oxirgi(x).slice(0, 70)}»${x.answered ? "" : "  — javobsiz"}`)
            .join("\n")
        : "Hali Direct xabar kelmagan (xabarlar akkaunt ulangandan keyin keladi).",
    };
  }

  if (/qoida|avto-?javob|kalit so'z/.test(t)) {
    type Qoida = { keywords: string; reply: string; is_active: boolean };
    const r = JSON.parse(await igVosita(userId, "instagram_list_automations", {})) as {
      comment_rules?: Qoida[];
      dm_rules?: Qoida[];
      webhooks_note?: string;
    };
    const rules = [
      ...(r.comment_rules ?? []).map((q) => ({ ...q, tur: "Komment" })),
      ...(r.dm_rules ?? []).map((q) => ({ ...q, tur: "Direct" })),
    ];
    return {
      jamoa: "ijtimoiy",
      amallar: [amalNomi("instagram_list_automations")],
      qadamlar: ["Qoidalarni o'qish", "Xulosa"],
      natija:
        (rules.length
          ? `⚙️ Avto-javob qoidalari (${rules.length}):\n` +
            rules
              .map((q) => `• ${q.tur} · ${q.keywords || "har qanday so'z"} ${q.is_active ? "✅" : "⏸"}\n   ↳ «${(q.reply || "").slice(0, 70)}»`)
              .join("\n") +
            "\n\nYangi qoida yaratish yoki o'zgartirish uchun Claude rejimi (ANTHROPIC_API_KEY) yoki kabinetdagi «Qoidalar» bo'limidan foydalaning."
          : "Hali qoida yo'q. Kabinetdagi «Qoidalar» bo'limida yaratishingiz mumkin.") +
        (r.webhooks_note ? `\n\n⚠️ ${r.webhooks_note}` : ""),
    };
  }

  if (/tasdiq/.test(t)) {
    const rows = JSON.parse(await igVosita(userId, "list_pending_approvals", {})) as { summary: string }[];
    return {
      jamoa: "ijtimoiy",
      amallar: [amalNomi("list_pending_approvals")],
      qadamlar: ["Tasdiq navbatini ko'rish"],
      natija: rows.length
        ? `✋ Tasdiq kutayotgan ${rows.length} ta harakat:\n${rows.map((r) => `• ${r.summary}`).join("\n")}\n\n«Vazifalar» bo'limida tasdiqlashingiz mumkin.`
        : "Tasdiq kutayotgan harakat yo'q.",
    };
  }

  return null;
}
