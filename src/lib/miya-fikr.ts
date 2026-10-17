import { z } from "zod";
import type { MiyaFikr } from "@prisma/client";
import { prisma } from "./db";
import { callTool, writeToolNow } from "./mcp";
import { configuredUrl } from "./url";
import { igAkkaunt } from "./ofis-instagram";
import { openai, openaiModel } from "./ofis-openai";
import { miyaXabar, sozlama, toshkent } from "./miya";

// Miya «o'ylaydi»: Instagram'dagi hamma narsani o'qiydi, odamday xulosa qiladi va aniq takliflar
// beradi. Har bir taklif — oq ro'yxatdagi amal; xavfini kod belgilaydi, model emas. Egasining
// mustaqillik sozlamasi va oldingi «ha/yo'q» javoblari qaysi taklifni Miya o'zi bajarishini hal qiladi.

export const AMALLAR = ["save_dm_rule", "save_comment_rule", "configure_direct", "reply_comment", "reels_vaqtlari", "eslatma"] as const;
export type Amal = (typeof AMALLAR)[number];
export const MUSTAQILLIK = ["maslahat", "ishonchli", "toliq"] as const;
export type Mustaqillik = (typeof MUSTAQILLIK)[number];
type Xavf = "past" | "orta" | "yuqori";

const vaqtlar = z.string().trim().regex(/^(\s*\d{1,2}:\d{2}\s*)(,\s*\d{1,2}:\d{2}\s*){0,3}$/);
const ARGS = {
  save_dm_rule: z.object({ rule_id: z.string().optional(), keywords: z.string().min(2).max(500), reply: z.string().min(5).max(1000), is_active: z.boolean().optional() }),
  save_comment_rule: z.object({
    rule_id: z.string().optional(),
    keywords: z.string().max(500).optional(),
    match: z.enum(["contains", "any"]).optional(),
    dm_message: z.string().min(5).max(1000),
    public_replies: z.array(z.string().min(2).max(200)).max(5).optional(),
    is_active: z.boolean().optional(),
  }),
  configure_direct: z.object({
    enabled: z.boolean().optional(),
    default_reply: z.string().min(5).max(1000).optional(),
    mode: z.enum(["first", "daily", "always", "off"]).optional(),
    comment_replies: z.boolean().optional(),
  }),
  reply_comment: z.object({ comment_id: z.string().min(3), text: z.string().min(2).max(500) }),
  reels_vaqtlari: z.object({ vaqtlar }),
  eslatma: z.object({}).passthrough(),
} satisfies Record<Amal, z.ZodType>;

// Xavf amalning o'zidan kelib chiqadi: ichki sozlama — past, mijozlar ko'radigan narsa — o'rta.
// O'chirish kabi qaytarib bo'lmaydigan amallar ro'yxatda umuman yo'q.
function xavfi(amal: Amal, args: Record<string, unknown>): Xavf {
  if (amal === "eslatma" || amal === "reels_vaqtlari") return "past";
  if (amal === "save_dm_rule") return args.rule_id ? "orta" : "past";
  if (amal === "configure_direct" && args.enabled === false) return "yuqori";
  return "orta";
}

const TOOL: Partial<Record<Amal, string>> = {
  save_dm_rule: "instagram_save_dm_rule",
  save_comment_rule: "instagram_save_comment_rule",
  configure_direct: "instagram_configure_direct",
  reply_comment: "instagram_reply_comment",
};

const AMAL_NOMI: Record<Amal, string> = {
  save_dm_rule: "Direct qoidasi",
  save_comment_rule: "Komment qoidasi",
  configure_direct: "Direct sozlamasi",
  reply_comment: "Kommentga javob",
  reels_vaqtlari: "Reels vaqtlari",
  eslatma: "Eslatma",
};

type Ishonch = Record<string, { ha: number; yoq: number }>;

// Egasi oxirgi 60 kunda har bir amal turiga necha marta «ha» va «yo'q» degan
export async function ishonchHisobi(userId: string): Promise<Ishonch> {
  const rows = await prisma.miyaFikr.groupBy({
    by: ["amal", "holat"],
    where: { userId, amal: { not: "eslatma" }, holat: { in: ["bajarildi", "rad"] }, createdAt: { gte: new Date(Date.now() - 60 * 86400_000) } },
    _count: true,
  });
  const out: Ishonch = {};
  for (const r of rows) {
    out[r.amal] ??= { ha: 0, yoq: 0 };
    if (r.holat === "bajarildi") out[r.amal].ha += r._count;
    else out[r.amal].yoq += r._count;
  }
  return out;
}

// O'zi bajaradimi yoki so'raydimi. «ishonchli» rejimda ishonch odamdagidek orttiriladi:
// past xavfli ish — 2 marta tasdiqlangandan keyin, o'rtacha — 5 marta, birorta ham rad bo'lmasa.
export function oziQiladimi(m: Mustaqillik, amal: Amal, xavf: Xavf, ishonch: number, tarix: Ishonch) {
  if (amal === "eslatma" || xavf === "yuqori" || m === "maslahat") return false;
  if (m === "toliq") return ishonch >= 70;
  const t = tarix[amal] ?? { ha: 0, yoq: 0 };
  if (t.yoq > 0) return false;
  if (xavf === "past") return ishonch >= 75 && t.ha >= 2;
  return ishonch >= 85 && t.ha >= 5;
}

// "Narx, necha pul" va "necha pul,narx" — bir xil qoida
function kalitlar(v: unknown) {
  return String(v ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
}

async function igJson(userId: string, nom: string, args: Record<string, unknown> = {}) {
  try {
    const r = await callTool(userId, nom, args, configuredUrl());
    return JSON.parse(r.content.map((c) => c.text).join("\n"));
  } catch {
    return null;
  }
}

// Model uchun hamma kerakli narsa — qisqa, raqamli, takrorsiz
async function kontekst(userId: string) {
  const akk = await igAkkaunt(userId);
  if (!akk) return null;
  const hafta = new Date(Date.now() - 7 * 86400_000);
  const [analytics, reels, report, automations, javobsizD, javobsizK, loglar, xotira, tarix, s] = await Promise.all([
    igJson(userId, "instagram_analytics"),
    igJson(userId, "instagram_reels_report", { limit: 10 }),
    igJson(userId, "instagram_automation_report"),
    igJson(userId, "instagram_list_automations"),
    igJson(userId, "instagram_list_direct_messages", { only_unanswered: true, limit: 15 }),
    igJson(userId, "instagram_unanswered_comments", { posts: 6 }),
    prisma.activityLog.findMany({
      where: { accountId: akk.id, createdAt: { gte: hafta }, kind: { in: ["dm", "dm_auto_reply", "comment", "comment_reply"] } },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.xotira.findUnique({ where: { userId } }),
    prisma.miyaFikr.findMany({ where: { userId, holat: { not: "kutmoqda" } }, orderBy: { createdAt: "desc" }, take: 25 }),
    sozlama(userId),
  ]);

  // kim nima yozdi va unga nima ketdi; standart javob ketganlari — hech bir qoidaga tushmaganlar
  const standart = akk.defaultDmReply.trim();
  const suhbat: string[] = [];
  for (let i = 0; i < loglar.length; i++) {
    const l = loglar[i];
    if (l.direction !== "in") continue;
    const javob = loglar.slice(i + 1, i + 4).find((x) => x.direction === "out" && x.igUserId === l.igUserId);
    const turi = l.kind === "comment" ? "komment" : "Direct";
    const holat = !javob ? "javobsiz" : javob.text.trim() === standart ? "faqat standart javob" : "qoida javob berdi";
    suhbat.push(`[${turi}] «${l.text.slice(0, 160)}» → ${holat}`);
  }

  const q = (x: unknown, n = 3500) => JSON.stringify(x ?? null).slice(0, n);
  // mavjud qoidalar kalit so'zlari — bir xil qoida ikkinchi marta yaratilmasin
  const qoidalar = new Set<string>();
  for (const [tur, royxat] of [["dm", automations?.dm_rules], ["comment", automations?.comment_rules]] as const) {
    for (const r of (royxat ?? []) as { keywords?: string }[]) qoidalar.add(`${tur}:${kalitlar(r.keywords)}`);
  }
  const kommentIdlar = new Set<string>(((javobsizK?.comments ?? []) as { id?: string }[]).map((c) => String(c.id)));
  return {
    akk,
    s,
    kommentIdlar,
    qoidalar,
    matn: [
      `Akkaunt: @${akk.username}. Bugun ${toshkent().sana} (Toshkent).`,
      xotira ? `Egasi va biznes haqida (ChatGPT tarixidan):\n${xotira.profil.slice(0, 2500)}` : "Egasi haqida profil yo'q.",
      `Statistika: ${q(analytics, 2500)}`,
      `Reels hisoboti: ${q(reels, 3000)}`,
      `Avto-javoblar 7 kunda: ${q(report, 1200)}`,
      `Hozirgi qoidalar va Direct sozlamasi: ${q(automations, 4000)}`,
      `Javob kutayotgan Direct: ${q(javobsizD, 2000)}`,
      `Javobsiz kommentlar (reply_comment uchun comment_id faqat shu yerdan): ${q(javobsizK, 2500)}`,
      `Oxirgi 7 kunda kelgan xabarlar:\n${suhbat.slice(-60).join("\n") || "yo'q"}`,
      `Reels avtomatik: ${s.autoReels ? "yoqilgan" : "o'chirilgan"}, vaqtlari ${s.reelsVaqtlari}.`,
      tarix.length
        ? `Oldingi takliflaringiz va egasining javobi (shundan o'rganing, rad etilganini takrorlamang):\n` +
          tarix.map((f) => `- [${f.holat}] ${AMAL_NOMI[f.amal as Amal] ?? f.amal}: ${f.sarlavha}${f.izoh ? ` — egasi: «${f.izoh}»` : ""}${f.natija ? ` (${f.natija.slice(0, 120)})` : ""}`).join("\n")
        : "Hali taklif bermagansiz.",
    ].join("\n\n"),
  };
}

const KORSATMA = `Siz «Miya»siz — shu Instagram biznesining egasiga yordam beradigan, o'z fikri bor tajribali menejer.
Har safar ma'lumotlarni o'qib, odamday o'ylaysiz: nima yaxshi ketyapti, nima yomon, mijozlar nimani so'rayapti va javobsiz qolyapti,
qaysi Reels ishlagan va nega. O'zbek tilida (lotin), birinchi shaxsda, samimiy va qisqa yozasiz. Aniq raqamlarga tayaning, taxmin qilsangiz shuni ayting,
hech narsani o'ylab topmang.

kuzatuv: egasiga 2-5 jumlada nimani sezganingizni va fikringizni ayting (yaxshi va yomon tomonini).
takliflar: 0-4 ta aniq, foydali ish. Har biri uchun:
- amal: save_dm_rule (Direct'dagi takror savolga avto-javob; args: keywords — vergul bilan o'zaklar, reply; mavjud qoidani o'zgartirish uchun rule_id),
  save_comment_rule (args: keywords yoki match:"any", dm_message, public_replies), configure_direct (args: default_reply, mode, comment_replies),
  reply_comment (args: comment_id faqat javobsiz kommentlar ro'yxatidan, text), reels_vaqtlari (args: vaqtlar "10:00,19:00" — faqat statistika asoslasa),
  eslatma (egasi o'zi qilishi kerak bo'lgan narsa, masalan narxni aytish yoki video olish; args: {}).
- sarlavha: bir qatorda nima qilinadi.
- fikr: nega — qaysi ma'lumotga qarab shu xulosaga keldingiz (1-3 jumla).
- ishonch: 0-100, bu to'g'ri ish ekaniga qanchalik ishonasiz. Ma'lumot kam bo'lsa — past qo'ying.
- args: JSON matn.
Javob matnlari mijozlar tilida, biznes ma'lumotlari faqat kontekstdan (telefon, manzil, narxni o'ylab topmang; bilmasangiz — eslatma qiling).
Hech narsa qilish kerak bo'lmasa takliflar bo'sh bo'lsin. Mavjud qoida bilan bir xil qoidani taklif qilmang.`;

const SXEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kuzatuv", "takliflar"],
  properties: {
    kuzatuv: { type: "string" },
    takliflar: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["amal", "sarlavha", "fikr", "ishonch", "args"],
        properties: {
          amal: { type: "string", enum: [...AMALLAR] },
          sarlavha: { type: "string" },
          fikr: { type: "string" },
          ishonch: { type: "integer" },
          args: { type: "string" },
        },
      },
    },
  },
} as const;

type Javob = { kuzatuv: string; takliflar: { amal: Amal; sarlavha: string; fikr: string; ishonch: number; args: string }[] };

// Taklifni bajaradi va natijani qisqa matn qilib qaytaradi
export async function bajar(userId: string, f: Pick<MiyaFikr, "amal" | "payload">) {
  const amal = f.amal as Amal;
  const args = JSON.parse(f.payload) as Record<string, unknown>;
  if (amal === "eslatma") return "eslatma";
  if (amal === "reels_vaqtlari") {
    await sozlama(userId);
    await prisma.miyaSozlama.update({ where: { userId }, data: { reelsVaqtlari: String(args.vaqtlar).replace(/\s+/g, "") } });
    return `Reels vaqtlari: ${args.vaqtlar}`;
  }
  const tool = TOOL[amal];
  if (!tool) throw new Error(`Noma'lum amal: ${amal}`);
  const res = await writeToolNow(userId, tool, args, configuredUrl(), "Miya");
  return JSON.stringify(res).slice(0, 300);
}

async function xabarYoz(userId: string, f: MiyaFikr) {
  const nom = AMAL_NOMI[f.amal as Amal] ?? f.amal;
  const ofis = configuredUrl() ? `${configuredUrl()}/ofis` : "Ofis";
  if (f.holat === "avtomatik") {
    await miyaXabar(userId, "fikr", "info", `🧠 O'zim qildim — ${nom}: ${f.sarlavha}\nNega: ${f.fikr}\n(ishonchim ${f.ishonch}%. Bekor qilish kerak bo'lsa, menga ayting.)`, `fikr:${f.id}`);
  } else if (f.holat === "xato") {
    await miyaXabar(userId, "fikr", "xavf", `🧠 Qilmoqchi edim, bo'lmadi — ${f.sarlavha}: ${f.natija ?? "xato"}`, `fikr:${f.id}`);
  } else if (f.amal === "eslatma") {
    await miyaXabar(userId, "fikr", "ogoh", `🧠 Sizga bir gap: ${f.sarlavha}\n${f.fikr}`, `fikr:${f.id}`);
  } else {
    await miyaXabar(
      userId,
      "fikr",
      "ogoh",
      `🧠 Taklifim — ${nom}: ${f.sarlavha}\nNega: ${f.fikr}\nIshonchim ${f.ishonch}%. Rozi bo'lsangiz: ${ofis} → Miya → 💭 Fikrlar → «Ha».`,
      `fikr:${f.id}`,
    );
  }
}

// Bitta fikrlash sikli. Qaytaradi: nechta taklif, nechtasini o'zi qildi
export async function fikrla(userId: string) {
  const client = openai();
  if (!client) throw new Error("OPENAI_API_KEY yo'q — Miya o'ylay olmaydi");
  // javobsiz qolgan eski takliflar eskiradi — vaziyat o'zgargan bo'ladi
  await prisma.miyaFikr.updateMany({ where: { userId, holat: "kutmoqda", createdAt: { lt: new Date(Date.now() - 3 * 86400_000) } }, data: { holat: "eskirdi", hal: new Date() } });

  const k = await kontekst(userId);
  if (!k) throw new Error("Instagram ulanmagan");
  const r = await client.responses.create({
    model: openaiModel(),
    instructions: KORSATMA,
    input: k.matn,
    text: { format: { type: "json_schema", name: "miya_fikr", strict: true, schema: SXEMA } },
  });
  const j = JSON.parse(r.output_text) as Javob;

  const sana = toshkent().sana;
  if (j.kuzatuv?.trim()) await miyaXabar(userId, "fikr", "info", `🧠 Miya o'yladi:\n${j.kuzatuv.trim().slice(0, 1500)}`, `kuzatuv:${sana}:${Date.now()}`);

  const tarix = await ishonchHisobi(userId);
  const mustaqillik = (MUSTAQILLIK as readonly string[]).includes(k.s.mustaqillik) ? (k.s.mustaqillik as Mustaqillik) : "ishonchli";
  const kutayotgan = await prisma.miyaFikr.findMany({ where: { userId, holat: "kutmoqda" }, select: { amal: true, payload: true } });
  let qildi = 0;
  let soni = 0;
  for (const t of (j.takliflar ?? []).slice(0, 4)) {
    if (!(AMALLAR as readonly string[]).includes(t.amal)) continue;
    let args: Record<string, unknown>;
    try {
      args = ARGS[t.amal].parse(JSON.parse(t.args || "{}")) as Record<string, unknown>;
    } catch {
      continue; // noto'g'ri argumentli taklif — e'tiborsiz
    }
    if ((t.amal === "save_dm_rule" || t.amal === "save_comment_rule") && !args.rule_id) {
      const kalit = `${t.amal === "save_dm_rule" ? "dm" : "comment"}:${kalitlar(args.keywords)}`;
      if (k.qoidalar.has(kalit)) continue;
    }
    // model comment_id ni o'ylab topmasin: faqat haqiqatan javobsiz kommentlarga
    if (t.amal === "reply_comment" && !k.kommentIdlar.has(String(args.comment_id))) continue;
    const payload = JSON.stringify(args);
    if (kutayotgan.some((x) => x.amal === t.amal && x.payload === payload)) continue;
    // bir xil eslatmani 3 kun ichida qayta aytmaydi
    if (t.amal === "eslatma" && (await prisma.miyaFikr.count({ where: { userId, amal: "eslatma", sarlavha: t.sarlavha.slice(0, 200), createdAt: { gte: new Date(Date.now() - 3 * 86400_000) } } }))) continue;
    const xavf = xavfi(t.amal, args);
    const ishonch = Math.max(0, Math.min(100, Math.round(t.ishonch)));
    let f = await prisma.miyaFikr.create({
      data: { userId, amal: t.amal, sarlavha: t.sarlavha.slice(0, 200), fikr: t.fikr.slice(0, 1200), payload, ishonch, xavf },
    });
    soni++;
    if (t.amal === "eslatma") {
      f = await prisma.miyaFikr.update({ where: { id: f.id }, data: { holat: "bajarildi", hal: new Date(), natija: "egasiga aytildi" } });
    } else if (oziQiladimi(mustaqillik, t.amal, xavf, ishonch, tarix)) {
      try {
        const natija = await bajar(userId, f);
        f = await prisma.miyaFikr.update({ where: { id: f.id }, data: { holat: "avtomatik", hal: new Date(), natija } });
        qildi++;
      } catch (e) {
        f = await prisma.miyaFikr.update({ where: { id: f.id }, data: { holat: "xato", hal: new Date(), natija: e instanceof Error ? e.message : "xato" } });
      }
    }
    await xabarYoz(userId, f);
  }
  await prisma.miyaSozlama.update({ where: { userId }, data: { oxirgiFikr: new Date() } });
  return { takliflar: soni, ozi: qildi, kuzatuv: j.kuzatuv };
}

// Egasining qarori. «ha» — bajaradi; «yo'q» — sababi bilan eslab qoladi
export async function qaror(userId: string, id: string, ha: boolean, izoh?: string) {
  const f = await prisma.miyaFikr.findFirst({ where: { id, userId, holat: "kutmoqda" } });
  if (!f) throw new Error("Taklif topilmadi yoki allaqachon hal qilingan");
  if (!ha) {
    return prisma.miyaFikr.update({ where: { id }, data: { holat: "rad", hal: new Date(), izoh: izoh?.slice(0, 500) || null } });
  }
  try {
    const natija = await bajar(userId, f);
    return prisma.miyaFikr.update({ where: { id }, data: { holat: "bajarildi", hal: new Date(), natija } });
  } catch (e) {
    await prisma.miyaFikr.update({ where: { id }, data: { holat: "xato", hal: new Date(), natija: e instanceof Error ? e.message : "xato" } });
    throw e;
  }
}
