import { prisma } from "./db";
import { callTool, MCP_TOOLS } from "./mcp";
import type { JamoaId } from "./ofis";

// AI Ofis agentlari Instagram Cloud vositalaridan (MCP bilan bir xil) foydalanadi.
// O'qish darhol bajariladi; yozish (javob, Direct, Reels, qoida) mavjud «Tasdiqlar»
// navbatiga tushadi va foydalanuvchi «Ha» demaguncha Instagramga hech narsa ketmaydi.

export const IG_VOSITALAR = MCP_TOOLS;

const NOMLAR: Record<string, string> = {
  instagram_accounts: "Ulangan akkauntlar ko'rildi",
  instagram_reels_report: "Reels hisoboti o'qildi",
  instagram_insights: "Akkaunt statistikasi o'qildi",
  instagram_list_comments: "Kommentlar o'qildi",
  instagram_list_dms: "Direct xabarlar o'qildi",
  instagram_list_rules: "Avto-javob qoidalari ko'rildi",
  instagram_inbox_topics: "Direct mavzulari tahlil qilindi",
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
export async function lokalInstagram(userId: string, matn: string): Promise<Natija | null> {
  const t = matn.toLowerCase().replace(/[‘’ʻʼ`]/g, "'");
  const ig = /instagram|insta|reels|komment|direct|\bdm\b|obunachi|avto-?javob|qoida|tasdiq/.test(t);
  if (!ig) return null;
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
      igVosita(userId, "instagram_insights", {}),
      igVosita(userId, "instagram_reels_report", {}),
    ]);
    const s = JSON.parse(ins) as { username: string; followers: number; views: number; reach: number; shares: number; saves: number };
    const r = JSON.parse(rep) as { items: { caption: string; views: number; shareRate: string; avgWatchSec: number; saves: number }[] };
    const eng = [...r.items].sort((a, b) => b.views - a.views).slice(0, 3);
    return {
      jamoa: "tahlil",
      amallar: [amalNomi("instagram_insights"), amalNomi("instagram_reels_report")],
      qadamlar: ["Instagram statistikasini o'qish", "Reels'larni solishtirish", "Hisobot yozish"],
      natija:
        `📊 @${s.username} hisoboti\n` +
        `Obunachilar: ${son(s.followers)}\nKo'rishlar: ${son(s.views)} · Qamrov: ${son(s.reach)}\n` +
        `Ulashishlar: ${son(s.shares)} · Saqlashlar: ${son(s.saves)}\n\n` +
        (eng.length
          ? `Eng ko'p ko'rilgan:\n${eng
              .map((m, i) => `${i + 1}. «${m.caption.slice(0, 50) || "izohsiz"}» — ${son(m.views)} ko'rish, ulashish ${m.shareRate}, o'rtacha ${m.avgWatchSec}s`)
              .join("\n")}`
          : "Hali post yoki Reels ma'lumoti yo'q."),
    };
  }

  if (/komment/.test(t)) {
    const logs = JSON.parse(await igVosita(userId, "instagram_list_comments", { limit: 12 })) as {
      kind: string;
      direction: string;
      username: string | null;
      text: string;
      replyText: string | null;
    }[];
    const kelgan = logs.filter((l) => l.direction === "in");
    return {
      jamoa: "ijtimoiy",
      amallar: [amalNomi("instagram_list_comments")],
      qadamlar: ["Kommentlarni o'qish", "Javob berilganini tekshirish", "Xulosa"],
      natija: kelgan.length
        ? `💬 Oxirgi ${kelgan.length} ta komment:\n` +
          kelgan
            .slice(0, 8)
            .map((l) => `• @${l.username ?? "?"}: «${l.text.slice(0, 80)}»${l.replyText ? `\n   ↳ javob: «${l.replyText.slice(0, 60)}»` : "  — javobsiz"}`)
            .join("\n") +
          "\n\nJavob yozishimni xohlasangiz, qaysi kommentga va nima deb — ayting (tasdiqingizdan keyin yuboriladi)."
        : "Hali komment yo'q.",
    };
  }

  if (/direct|\bdm\b|xabar|savol/.test(t)) {
    const [mavzu, dms] = await Promise.all([
      igVosita(userId, "instagram_inbox_topics", {}),
      igVosita(userId, "instagram_list_dms", { limit: 10 }),
    ]);
    const m = JSON.parse(mavzu) as Record<string, number>;
    const d = (JSON.parse(dms) as { direction: string; username: string | null; text: string }[]).filter((x) => x.direction === "in");
    return {
      jamoa: "mijozlar",
      amallar: [amalNomi("instagram_inbox_topics"), amalNomi("instagram_list_dms")],
      qadamlar: ["Direct xabarlarni o'qish", "Mavzular bo'yicha guruhlash", "Xulosa"],
      natija:
        `📩 Direct'da nimalar so'ralyapti:\n${Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `• ${k}: ${v} ta`)
          .join("\n") || "• hali xabar yo'q"}` +
        (d.length ? `\n\nOxirgi xabarlar:\n${d.slice(0, 5).map((x) => `• @${x.username ?? "?"}: «${x.text.slice(0, 70)}»`).join("\n")}` : ""),
    };
  }

  if (/qoida|avto-?javob|kalit so'z/.test(t)) {
    const rules = JSON.parse(await igVosita(userId, "instagram_list_rules", {})) as {
      type: string;
      keywords: string;
      enabled: boolean;
      dmMessage: string;
    }[];
    return {
      jamoa: "ijtimoiy",
      amallar: [amalNomi("instagram_list_rules")],
      qadamlar: ["Qoidalarni o'qish", "Xulosa"],
      natija: rules.length
        ? `⚙️ Avto-javob qoidalari (${rules.length}):\n` +
          rules
            .map((r) => `• ${r.type === "dm" ? "Direct" : "Komment"} · ${(JSON.parse(r.keywords) as string[]).join(", ")} ${r.enabled ? "✅" : "⏸"}\n   ↳ «${r.dmMessage.slice(0, 70)}»`)
            .join("\n") +
          "\n\nYangi qoida yaratish yoki o'zgartirish uchun Claude rejimi (ANTHROPIC_API_KEY) yoki kabinetdagi «Qoidalar» bo'limidan foydalaning."
        : "Hali qoida yo'q. Kabinetdagi «Qoidalar» bo'limida yaratishingiz mumkin.",
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
