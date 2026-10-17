import type { MiyaSozlama } from "@prisma/client";
import { prisma } from "./db";
import { executeApprovedAction } from "./actions";
import { callTool } from "./mcp";
import { configuredUrl } from "./url";
import { igAkkaunt } from "./ofis-instagram";
import { openai, openaiModel } from "./ofis-openai";
import { cloudshopSozlangan, hujjatlar, kassa, qarzlar, tovarlar } from "./cloudshop";
import { moliyaRuxsat, pul } from "./ofis-moliya";
import { githubdaYasash, osilganIshlar, videoNavbat } from "./video-ish";
import type { VideoSpec } from "./video";
import { fikrla } from "./miya-fikr";

// AI Ofis «Miya» — avtomatik kuzatuvchi. Railway'dagi bot har 10 daqiqada /api/miya/tick ni chaqiradi:
// belgilangan postlarni joylaydi, Reels vaqti kelsa video yasab joylaydi, CloudShop va Instagram'ni
// tekshirib, topganini ofisga va Telegram'ga yuboradi.

const KUN = 86400_000;
const TZ = 5 * 3600_000;

// Toshkent vaqti
export function toshkent(d = new Date()) {
  const t = new Date(d.getTime() + TZ);
  return { sana: t.toISOString().slice(0, 10), daqiqa: t.getUTCHours() * 60 + t.getUTCMinutes(), kun: Math.floor(t.getTime() / KUN) };
}

// "2026-10-20 18:30" (Toshkent) yoki ISO → Date
export function toshkentVaqt(s: string): Date | null {
  const m = s.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (m) return new Date(Date.parse(`${m[1]}T${m[2].padStart(2, "0")}:${m[3]}:00Z`) - TZ);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function sozlama(userId: string) {
  return prisma.miyaSozlama.upsert({ where: { userId }, update: {}, create: { userId } });
}

type Daraja = "info" | "ogoh" | "xavf";

export async function miyaXabar(userId: string, tur: string, daraja: Daraja, matn: string, kalit: string) {
  return xabar(userId, tur, daraja, matn, kalit);
}

async function xabar(userId: string, tur: string, daraja: Daraja, matn: string, kalit: string) {
  const r = await prisma.miyaXabar.createMany({ data: [{ userId, tur, daraja, matn: matn.slice(0, 4000), kalit }], skipDuplicates: true });
  return r.count > 0;
}

const qisqa = (n: number) => `${Math.round(n).toLocaleString("en-US").replace(/,/g, " ")}`;
const sanaQisqa = (ts: number) => new Date(ts * 1000 + TZ).toISOString().slice(5, 10).split("-").reverse().join(".");

// ---------- CloudShop ----------

export async function moliyaTekshir(userId: string, s: MiyaSozlama) {
  const { sana, kun } = toshkent();
  const uch = Math.floor(kun / 3); // tez-tez takrorlanmasin: ba'zi xulosalar 3 kunda bir
  const topildi: string[] = [];

  // tovarlar: manfiy qoldiq (hisob xato), kam qolgan, tannarxdan arzon
  const t = await tovarlar();
  const manfiy = t.filter((x) => x.qoldiq < 0);
  if (manfiy.length) {
    const ok = await xabar(
      userId,
      "qoldiq",
      "xavf",
      `🧮 Qoldiq noto'g'ri: ${manfiy.length} ta tovar manfiy qoldiqda — sotilgan, lekin kirim qilinmagan bo'lishi mumkin.\n` +
        manfiy.slice(0, 12).map((x) => `• ${x.nom}: ${x.qoldiq} ${x.birlik}`).join("\n"),
      `qoldiq:${sana}`,
    );
    if (ok) topildi.push("manfiy qoldiq");
  }
  const kam = t.filter((x) => x.qoldiq > 0 && x.qoldiq <= s.kamQoldiq && x.narx > 0).sort((a, b) => a.qoldiq - b.qoldiq);
  if (kam.length) {
    const ok = await xabar(
      userId,
      "tovar",
      "ogoh",
      `📦 Kam qolgan tovarlar (${s.kamQoldiq} ta yoki kamroq): ${kam.length} xil.\n` +
        kam.slice(0, 15).map((x) => `• ${x.nom}: ${x.qoldiq} ${x.birlik}`).join("\n") +
        (kam.length > 15 ? `\n… va yana ${kam.length - 15} xil` : ""),
      `kam:${uch}`,
    );
    if (ok) topildi.push("kam tovar");
  }
  const arzon = t.filter((x) => x.narx > 0 && x.tannarx > x.narx);
  if (arzon.length) {
    await xabar(
      userId,
      "narx",
      "ogoh",
      `🏷 Sotuv narxi tannarxdan past: ${arzon.length} ta tovar.\n` +
        arzon.slice(0, 12).map((x) => `• ${x.nom}: narx ${pul(x.narx)}, tannarx ${pul(x.tannarx)}`).join("\n"),
      `narx:${uch}`,
    );
  }

  // kassa: takror yozuvlar va odatdan juda katta summalar (oxirgi 30 kun)
  const hozir = Math.floor(Date.now() / 1000);
  const pullar = await kassa(hozir - 30 * 86400, hozir);
  const takror: string[] = [];
  const sorted = [...pullar].sort((a, b) => a.sana - b.sana);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a.tur === b.tur && a.summa === b.summa && a.summa > 0 && (a.kontragent || "") === (b.kontragent || "") && b.sana - a.sana <= 600) {
      takror.push(`• ${sanaQisqa(b.sana)} ${b.tur === "kirim" ? "+" : "−"}${pul(b.summa)} · ${b.kontragent || b.toifa || "—"} (2 marta, ${Math.round((b.sana - a.sana) / 60)} daq oraliqda)`);
    }
  }
  if (takror.length) {
    const ok = await xabar(userId, "kassa", "xavf", `💵 Kassada takrorlangan bo'lishi mumkin bo'lgan yozuvlar:\n${takror.slice(0, 10).join("\n")}`, `kassa-takror:${sana}`);
    if (ok) topildi.push("kassa takrori");
  }
  const summalar = pullar.map((p) => p.summa).filter((x) => x > 0).sort((a, b) => a - b);
  const median = summalar.length ? summalar[Math.floor(summalar.length / 2)] : 0;
  const bugunBoshi = hozir - 2 * 86400;
  for (const p of pullar.filter((x) => x.sana >= bugunBoshi && median > 0 && x.summa >= median * 15 && x.summa >= 5_000_000)) {
    await xabar(
      userId,
      "kassa",
      "ogoh",
      `💵 Odatdan katta ${p.tur}: ${pul(p.summa)} (${sanaQisqa(p.sana)}) · ${p.kontragent || p.toifa || "—"}${p.izoh ? ` · ${p.izoh}` : ""}. Odatiy summa ~${pul(median)} — to'g'ri yozilganini tekshiring.`,
      `kassa-katta:${p.id}`,
    );
  }

  // qarzlar: umumiy o'sish va uzoq vaqtdan beri to'lamaganlar
  const q = await qarzlar();
  const jami = q.reduce((x, r) => x + r.qarz, 0);
  if (s.oxirgiQarz && jami > s.oxirgiQarz * 1.1 && jami - s.oxirgiQarz >= 1_000_000) {
    await xabar(userId, "qarz", "ogoh", `📈 Xaridorlar qarzi ko'paydi: ${pul(s.oxirgiQarz)} → ${pul(jami)} (+${pul(jami - s.oxirgiQarz)}).`, `qarz-osish:${sana}`);
  }
  await prisma.miyaSozlama.update({ where: { userId }, data: { oxirgiQarz: Math.round(jami) } });

  const tarix = await kassa(hozir - 120 * 86400, hozir);
  const sotuvlar = await hujjatlar(hozir - 120 * 86400, hozir);
  const nom = (s: string) => s.trim().toLowerCase();
  const oxirgiTolov = new Map<string, number>();
  for (const p of tarix) if (p.tur === "kirim" && p.kontragent) oxirgiTolov.set(nom(p.kontragent), Math.max(oxirgiTolov.get(nom(p.kontragent)) ?? 0, p.sana));
  const oxirgiYuk = new Map<string, number>();
  for (const h of sotuvlar) if (h.tur === "sales" && h.kontragent) oxirgiYuk.set(nom(h.kontragent), Math.max(oxirgiYuk.get(nom(h.kontragent)) ?? 0, h.sana));
  const chegara = hozir - s.qarzKunlari * 86400;
  const eski = q
    .filter((r) => r.qarz >= 100_000 && (oxirgiTolov.get(nom(r.nom)) ?? 0) < chegara)
    .slice(0, 12)
    .map((r) => {
      const tol = oxirgiTolov.get(nom(r.nom));
      const yuk = oxirgiYuk.get(nom(r.nom));
      return (
        `• ${r.nom}${r.telefon ? ` (${r.telefon})` : ""} — qarz ${pul(r.qarz)}; ` +
        (tol ? `oxirgi to'lov ${Math.floor((hozir - tol) / 86400)} kun oldin` : "120 kun ichida to'lov yo'q") +
        (yuk ? `, oxirgi yuk ${sanaQisqa(yuk)}` : "")
      );
    });
  if (eski.length) {
    const ok = await xabar(userId, "qarz", "xavf", `⏰ ${s.qarzKunlari} kundan beri pul bermayotgan qarzdorlar:\n${eski.join("\n")}`, `eski-qarz:${uch}`);
    if (ok) topildi.push("eski qarzlar");
  }
  if (!topildi.length) {
    await xabar(userId, "kassa", "info", `✅ CloudShop tekshirildi: jiddiy muammo topilmadi. Qarzlar jami ${pul(jami)}.`, `moliya-ok:${sana}`);
  }
}

// ---------- Instagram ----------

async function igJson(userId: string, nom: string, args: Record<string, unknown> = {}) {
  const r = await callTool(userId, nom, args, configuredUrl());
  return JSON.parse(r.content.map((c) => c.text).join("\n"));
}

export async function instagramTekshir(userId: string) {
  const akk = await igAkkaunt(userId);
  if (!akk) return;
  const { sana } = toshkent();
  const a = await igJson(userId, "instagram_analytics");
  const k = await igJson(userId, "instagram_unanswered_comments", { posts: 8 }).catch(() => ({ comments: [] }));
  const d = await igJson(userId, "instagram_list_direct_messages", { only_unanswered: true, limit: 50 }).catch(() => ({ conversations: [] }));
  const oy = a.last_30_days && !a.last_30_days.error ? a.last_30_days : {};
  const javobsizK = (k.comments ?? []).length;
  const javobsizD = (d.conversations ?? []).length;
  await xabar(
    userId,
    "instagram",
    javobsizK + javobsizD > 0 ? "ogoh" : "info",
    `📊 @${a.username} kunlik: ${qisqa(a.followers ?? 0)} obunachi; 30 kunda ${qisqa(oy.views ?? 0)} ko'rish, qamrov ${qisqa(oy.reach ?? 0)}.\n` +
      `Javobsiz kommentlar: ${javobsizK}, javob kutayotgan Direct: ${javobsizD}.` +
      (javobsizK + javobsizD ? " Ofisda «javobsiz kommentlarni ko'rsat» deb so'rang." : ""),
    `ig:${sana}`,
  );
}

// ---------- Reels ----------

type Ssenariy = { slides: { title: string; subtitle: string; seconds: number }[]; caption: string; theme: string };

async function ssenariyYoz(userId: string, akkNomi: string, brend: string): Promise<Ssenariy> {
  const client = openai();
  if (!client) throw new Error("OPENAI_API_KEY yo'q — Reels ssenariysini yozib bo'lmaydi");
  const [rep, xotira, oxirgilar] = await Promise.all([
    igJson(userId, "instagram_reels_report", { limit: 10 }).catch(() => null),
    prisma.xotira.findUnique({ where: { userId } }),
    prisma.miyaXabar.findMany({ where: { userId, tur: "reels", daraja: "info" }, orderBy: { createdAt: "desc" }, take: 6 }),
  ]);
  const eng = rep?.items
    ? [...rep.items].sort((a: { views: number }, b: { views: number }) => b.views - a.views).slice(0, 4).map((r: { caption: string; views: number }) => `«${String(r.caption).slice(0, 80)}» — ${r.views} ko'rish`)
    : [];
  const r = await client.responses.create({
    model: openaiModel(),
    instructions:
      "Siz Instagram Reels ssenariychisisiz. O'zbek tilida (lotin) qisqa, sotuvga yo'naltirilgan matnli Reels yozasiz: 4-6 slayd, " +
      "har biri sarlavha (40 belgigacha, emoji yo'q) va qisqa izoh, jami 15-25 soniya. Birinchi slayd e'tiborni tortsin, oxirgisi chaqiriq bo'lsin. " +
      "caption: 2-4 jumla + 5-8 ta mos hashtag. Oldingi Reels mavzularini takrorlamang.",
    input: [
      `Akkaunt: @${akkNomi}. Brend: ${brend}.`,
      xotira ? `Egasi va biznes haqida:\n${xotira.profil.slice(0, 3000)}` : "",
      eng.length ? `Eng ko'p ko'rilgan Reels:\n${eng.join("\n")}` : "",
      oxirgilar.length ? `Oxirgi Miya Reels'lari (takrorlamang):\n${oxirgilar.map((x) => x.matn.slice(0, 160)).join("\n")}` : "",
      `Bugun: ${toshkent().sana}. Yangi Reels yozing.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    text: {
      format: {
        type: "json_schema",
        name: "reels",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["slides", "caption", "theme"],
          properties: {
            slides: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "subtitle", "seconds"],
                properties: { title: { type: "string" }, subtitle: { type: "string" }, seconds: { type: "number" } },
              },
            },
            caption: { type: "string" },
            theme: { type: "string", enum: ["sky", "ocean", "red", "sunset", "dark", "light"] },
          },
        },
      },
    },
  });
  const s = JSON.parse(r.output_text) as Ssenariy;
  s.slides = s.slides.slice(0, 8).map((x) => ({ title: x.title.slice(0, 60), subtitle: x.subtitle.slice(0, 120), seconds: Math.min(6, Math.max(2, x.seconds || 3)) }));
  if (s.slides.length < 2) throw new Error("Ssenariy juda qisqa chiqdi");
  return s;
}

// Joylash: tasdiq navbatisiz (Miya sozlamasida avtomatik joylash tanlangan), lekin tarixga yoziladi
async function joyla(userId: string, accountId: string, action: "publish_reel" | "publish_photo" | "publish_story", uploadId: string, caption: string) {
  const payload = { accountId, uploadId, caption, baseUrl: configuredUrl() };
  const res = await executeApprovedAction(action, payload);
  await prisma.approval.create({
    data: {
      userId,
      accountId,
      toolName: action,
      summary: `Miya: ${action === "publish_story" ? "story" : action === "publish_photo" ? "rasm" : "Reels"} — «${caption.slice(0, 80)}»`,
      payload: JSON.stringify(payload),
      status: "executed",
      result: JSON.stringify(res),
      decidedAt: new Date(),
    },
  });
  return res as { id?: string; igMediaId?: string };
}

export async function reelsYasaVaJoyla(userId: string, s: MiyaSozlama, kalit: string) {
  const akk = await igAkkaunt(userId);
  if (!akk) throw new Error("Instagram ulanmagan");
  const brend = s.reelsBrend || akk.name || akk.username;
  const ss = await ssenariyYoz(userId, akk.username, brend);
  const spec = { slides: ss.slides, theme: ss.theme as VideoSpec["theme"], brand: brend, ...(s.reelsFooter ? { footer: s.reelsFooter } : {}) };
  // Render'ning bepul serveri videoni ko'tarolmaydi — GitHub Actions yasaydi, tayyor bo'lgach
  // reelsVideoTayyor joylaydi
  if (githubdaYasash()) {
    await videoNavbat(userId, spec, { tur: "miya-reels", kalit, caption: ss.caption });
    const eski = await prisma.miyaXabar.findUnique({ where: { userId_kalit: { userId, kalit } } });
    await prisma.miyaXabar.update({
      where: { userId_kalit: { userId, kalit } },
      data: { matn: `${eski?.matn.replace(/…$/, "") ?? "🎬 Reels tayyorlanmoqda"} — «${ss.slides[0].title}», video GitHub'da yasalmoqda…` },
    });
    return;
  }
  const v = await igJson(userId, "instagram_make_video", spec);
  if (!v.upload_id) throw new Error("Video yasalmadi");
  await reelsVideoTayyor(userId, kalit, v.upload_id, ss.caption);
}

// Video tayyor: Reels qilib joylaydi va Miya xabarini yangilaydi
export async function reelsVideoTayyor(userId: string, kalit: string, uploadId: string, caption: string) {
  const akk = await igAkkaunt(userId);
  if (!akk) return reelsVideoXato(userId, kalit, "Instagram ulanmagan");
  try {
    const res = await joyla(userId, akk.id, "publish_reel", uploadId, caption);
    await prisma.miyaXabar.update({
      where: { userId_kalit: { userId, kalit } },
      data: {
        daraja: "info",
        telegram: false,
        matn: `🎬 Miya Reels joyladi (@${akk.username}).\nMatn: ${caption.slice(0, 300)}${res.id ? `\nID: ${res.id}` : ""}`,
      },
    });
  } catch (e) {
    await reelsVideoXato(userId, kalit, e instanceof Error ? e.message : "joylanmadi");
  }
}

export async function reelsVideoXato(userId: string, kalit: string, m: string) {
  const eski = await prisma.miyaXabar.findUnique({ where: { userId_kalit: { userId, kalit } } });
  const vaqt = kalit.split(":").slice(-2).join(":");
  const ikkinchi = eski?.matn.includes("2-urinish");
  await prisma.miyaXabar.update({
    where: { userId_kalit: { userId, kalit } },
    data: {
      daraja: "xavf",
      telegram: false,
      matn: ikkinchi
        ? `⚠️ ${vaqt} dagi Reels ikkinchi urinishda ham joylanmadi: ${m}. O'zingiz joylashingiz kerak.`
        : `⚠️ ${vaqt} dagi Reels joylanmadi: ${m}. 10 daqiqadan keyin yana bir bor urinib ko'raman.`,
    },
  });
}

export async function videoXabar(userId: string, matn: string, kalit: string, daraja: Daraja = "info") {
  await xabar(userId, "video", daraja, matn, kalit);
}

// shu server jarayonida hozir yasalayotgan Reels'lar (qayta ishga tushgandan keyin bo'sh)
const jarayonda = new Set<string>();

async function reelsVaqti(userId: string, s: MiyaSozlama): Promise<boolean> {
  // Instagram'i ulanmagan foydalanuvchida Reels yo'q (navbatni boshqalardan olmasin)
  if (!(await igAkkaunt(userId))) return false;
  const { sana, daqiqa } = toshkent();
  for (const v of s.reelsVaqtlari.split(",").map((x) => x.trim()).filter(Boolean)) {
    const m = v.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const slot = Number(m[1]) * 60 + Number(m[2]);
    if (daqiqa < slot || daqiqa > slot + 180) continue; // 3 soat ichida o'tkazib yuborilmasin
    const kalit = `reels:${sana}:${v}`;
    if (!s.autoReels) {
      await xabar(userId, "reels", "ogoh", `⏰ Reels joylash vaqti (${v}). Avtomatik Reels o'chirilgan — ofisda «Reels yasa» deb ayting yoki o'zingiz video yuklang.`, kalit);
      return false;
    }
    // band qilib olamiz: ikki tick bir vaqtda kelsa, faqat bittasi yasaydi.
    // Xato bilan tugagan urinish vaqt oynasi ichida bir marta qayta urinadi.
    let urinish = 1;
    if (!(await xabar(userId, "reels", "ogoh", `🎬 Reels tayyorlanmoqda (${v})…`, kalit))) {
      if (jarayonda.has(kalit)) continue; // shu jarayonda hali ishlayapti
      // video GitHub'da yasalayotgan bo'lsa — kutamiz (osilganini osilganIshlar() yopadi)
      if (await prisma.videoIsh.count({ where: { userId, holat: { in: ["kutmoqda", "ishlanmoqda"] }, meta: { contains: `"${kalit}"` } } })) continue;
      // «tayyorlanmoqda» qolib ketgan bo'lsa — server ish o'rtasida qayta ishga tushgan
      const eski = await prisma.miyaXabar.findUnique({ where: { userId_kalit: { userId, kalit } } });
      if (eski?.matn.startsWith("🎬 Reels tayyorlanmoqda") && eski.matn.includes("2-urinish")) {
        await prisma.miyaXabar.update({
          where: { id: eski.id },
          data: { daraja: "xavf", telegram: false, matn: `⚠️ ${v} dagi Reels ikkinchi urinishda ham joylanmadi: server ish o'rtasida to'xtadi. O'zingiz joylashingiz kerak.` },
        });
        continue;
      }
      const qayta = await prisma.miyaXabar.updateMany({
        where: {
          userId,
          kalit,
          OR: [
            { daraja: "xavf", matn: { contains: "joylanmadi" }, NOT: { matn: { contains: "ikkinchi urinishda" } } },
            { matn: { startsWith: "🎬 Reels tayyorlanmoqda" }, NOT: { matn: { contains: "2-urinish" } } },
          ],
        },
        data: { daraja: "ogoh", telegram: true, matn: `🎬 Reels tayyorlanmoqda (${v}, 2-urinish)…` },
      });
      if (!qayta.count) continue;
      urinish = 2;
    }
    jarayonda.add(kalit);
    try {
      await reelsYasaVaJoyla(userId, s, kalit);
    } catch (e) {
      const m = e instanceof Error ? e.message : "xato";
      await prisma.miyaXabar.update({
        where: { userId_kalit: { userId, kalit } },
        data: {
          daraja: "xavf",
          telegram: false,
          matn:
            urinish === 1
              ? `⚠️ ${v} dagi Reels joylanmadi: ${m}. 10 daqiqadan keyin yana bir bor urinib ko'raman.`
              : `⚠️ ${v} dagi Reels ikkinchi urinishda ham joylanmadi: ${m}. O'zingiz joylashingiz kerak.`,
        },
      });
    } finally {
      jarayonda.delete(kalit);
    }
    return true;
  }
  return false;
}

// ---------- belgilangan postlar ----------

export const REJA_TURLARI = ["reel", "photo", "story", "reel_story", "photo_story"] as const;

async function rejaPostlar() {
  const tayyor = await prisma.rejaPost.findMany({ where: { holat: "kutmoqda", vaqt: { lte: new Date() } }, orderBy: { vaqt: "asc" }, take: 5 });
  for (const p of tayyor) {
    const band = await prisma.rejaPost.updateMany({ where: { id: p.id, holat: "kutmoqda" }, data: { holat: "joylanmoqda" } });
    if (!band.count) continue;
    try {
      const akk = await igAkkaunt(p.userId);
      if (!akk) throw new Error("Instagram ulanmagan");
      // bitta fayldan story + post: avval story (post joylangach fayl o'chiriladi)
      if (p.tur === "story" || p.tur.endsWith("_story")) await joyla(p.userId, akk.id, "publish_story", p.uploadId, "");
      if (p.tur !== "story") await joyla(p.userId, akk.id, p.tur.startsWith("photo") ? "publish_photo" : "publish_reel", p.uploadId, p.caption);
      await prisma.rejaPost.update({ where: { id: p.id }, data: { holat: "joylandi" } });
      await xabar(p.userId, "post", "info", `📤 Rejadagi ${p.tur.replace("_", " + ")} joylandi (@${akk.username})${p.caption ? `: «${p.caption.slice(0, 80)}»` : ""}.`, `reja:${p.id}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : "xato";
      await prisma.rejaPost.update({ where: { id: p.id }, data: { holat: "xato", xato: m } });
      await xabar(p.userId, "post", "xavf", `⚠️ Rejadagi post joylanmadi: ${m}`, `reja:${p.id}`);
    }
  }
}

// ---------- tick ----------

async function band(userId: string, maydon: "oxirgiMoliya" | "oxirgiInstagram" | "oxirgiFikr", soat: number) {
  const chegara = new Date(Date.now() - soat * 3600_000);
  const r = await prisma.miyaSozlama.updateMany({
    where: { userId, OR: [{ [maydon]: null }, { [maydon]: { lt: chegara } }] },
    data: { [maydon]: new Date() },
  });
  return r.count > 0;
}

export async function tick() {
  await osilganIshlar();
  await rejaPostlar();

  // moliya ruxsati bor foydalanuvchilarga Miya avtomatik yoqiladi
  const adminlar = (process.env.MOLIYA_ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (adminlar.length) {
    const users = await prisma.user.findMany({ where: { email: { in: adminlar, mode: "insensitive" } }, select: { id: true } });
    for (const u of users) await sozlama(u.id);
  }

  const sozlamalar = await prisma.miyaSozlama.findMany({ include: { user: { select: { email: true } } } });
  let ogir = false; // bitta tick'da bittadan og'ir ish (video)
  for (const s of sozlamalar) {
    try {
      if (!ogir) ogir = await reelsVaqti(s.userId, s);
    } catch (e) {
      console.error("miya reels:", e);
    }
    try {
      if (moliyaRuxsat(s.user.email) && cloudshopSozlangan() && (await band(s.userId, "oxirgiMoliya", 6))) await moliyaTekshir(s.userId, s);
    } catch (e) {
      console.error("miya moliya:", e);
      await xabar(s.userId, "kassa", "ogoh", `⚠️ CloudShop tekshiruvi bajarilmadi: ${e instanceof Error ? e.message : "xato"}`, `moliya-xato:${toshkent().sana}`);
    }
    try {
      if (toshkent().daqiqa >= 9 * 60 && (await band(s.userId, "oxirgiInstagram", 20))) await instagramTekshir(s.userId);
    } catch (e) {
      console.error("miya instagram:", e);
    }
    // o'ylash: kunduzi har 6 soatda, bitta tick'da bitta foydalanuvchi (model chaqiruvi sekin)
    try {
      const { daqiqa } = toshkent();
      if (!ogir && openai() && daqiqa >= 8 * 60 && daqiqa < 22 * 60 && (await igAkkaunt(s.userId)) && (await band(s.userId, "oxirgiFikr", 6))) {
        ogir = true;
        await fikrla(s.userId);
      }
    } catch (e) {
      console.error("miya fikr:", e);
    }
  }

  // Telegram'ga: muhim xabarlar va joylangan postlar (faqat moliya egalariga tegishlilari)
  const egaIdlar = sozlamalar.filter((s) => moliyaRuxsat(s.user.email)).map((s) => s.userId);
  const yangi = await prisma.miyaXabar.findMany({
    where: { userId: { in: egaIdlar }, telegram: false, OR: [{ daraja: { in: ["ogoh", "xavf"] } }, { tur: { in: ["reels", "post", "fikr"] } }], NOT: { matn: { startsWith: "🎬 Reels tayyorlanmoqda" } } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  if (yangi.length) await prisma.miyaXabar.updateMany({ where: { id: { in: yangi.map((x) => x.id) } }, data: { telegram: true } });
  return [...new Set(yangi.map((x) => `🧠 Miya\n${x.matn}`))];
}

// Agentlar uchun: post/Reels/story'ni vaqtga qo'yish
export const MIYA_VOSITALAR = [
  {
    name: "miya_reja_post",
    description:
      "Yuklangan faylni (instagram_list_uploads dagi upload_id) belgilangan vaqtda Instagram'ga joylashni rejalashtiradi. " +
      "tur: reel, photo, story, reel_story (avval story, keyin Reels), photo_story. vaqt — Toshkent vaqti «YYYY-MM-DD HH:MM».",
    inputSchema: {
      type: "object",
      properties: {
        upload_id: { type: "string" },
        tur: { type: "string", enum: [...REJA_TURLARI] },
        caption: { type: "string", description: "Post matni (story uchun bo'sh)" },
        vaqt: { type: "string", description: "Toshkent vaqti, masalan 2026-10-20 18:30" },
      },
      required: ["upload_id", "tur", "vaqt"],
      additionalProperties: false,
    },
  },
];

export async function rejaQosh(userId: string, a: { upload_id: string; tur: string; caption?: string; vaqt: string }) {
  if (!(REJA_TURLARI as readonly string[]).includes(a.tur)) throw new Error("tur noto'g'ri");
  const vaqt = toshkentVaqt(a.vaqt);
  if (!vaqt) throw new Error("Vaqt noto'g'ri — «YYYY-MM-DD HH:MM» ko'rinishida bering");
  if (vaqt.getTime() < Date.now() - 5 * 60_000) throw new Error("Vaqt o'tib ketgan");
  const up = await prisma.mediaUpload.findFirst({ where: { id: a.upload_id, userId, data: { not: null } }, select: { id: true, mimeType: true } });
  if (!up) throw new Error("Fayl topilmadi yoki muddati o'tgan — qaytadan yuklang");
  const rasm = up.mimeType === "image/jpeg";
  if (rasm && a.tur.startsWith("reel")) throw new Error("Rasm uchun tur: photo yoki photo_story");
  if (!rasm && a.tur.startsWith("photo")) throw new Error("Video uchun tur: reel yoki reel_story");
  // fayl joylash vaqtigacha saqlansin
  await prisma.mediaUpload.update({ where: { id: up.id }, data: { expiresAt: new Date(vaqt.getTime() + KUN) } });
  return prisma.rejaPost.create({ data: { userId, tur: a.tur, uploadId: up.id, caption: (a.caption ?? "").slice(0, 2200), vaqt } });
}
