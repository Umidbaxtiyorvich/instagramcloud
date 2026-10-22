import { createHash } from "crypto";
import type { Qongiroq } from "@prisma/client";
import { prisma } from "./db";
import { randomToken } from "./crypto";
import { tasdiqHal } from "./actions";
import { uploadForPublish } from "./uploads";
import { openai } from "./ofis-openai";
import { sayt } from "./twilio";
import { gapniIshla, matnniIshla, qongiroqToken, sababToza, salomMatni, suhbatOl, tgChaqir, xatoGap } from "./miya-telefon";

// Miya'ning Telegram boti (BotFather'dan olingan MIYA_BOT_TOKEN). Telegram bot orqali oddiy qo'ng'iroq
// qilib bo'lmaydi, shuning uchun «qo'ng'iroq» — bot xabari + tugma: bosilsa, Telegram ichida qo'ng'iroq
// ekrani ochiladi. Botga ovozli yoki oddiy xabar yozilsa ham Miya javob beradi (ovozli xabar bilan).

export const botBor = () => Boolean(process.env.MIYA_BOT_TOKEN?.trim());

const token = () => process.env.MIYA_BOT_TOKEN?.trim() || "";
const API = () => process.env.TELEGRAM_API_URL || "https://api.telegram.org";

// webhook so'rovi rostdan Telegram'dan kelganini tekshirish uchun (setWebhook secret_token)
export const botSiri = () => createHash("sha256").update(`miya-bot:${token()}`).digest("hex").slice(0, 48);

async function tg<T = unknown>(metod: string, body: Record<string, unknown> | FormData): Promise<T> {
  const r = await fetch(`${API()}/bot${token()}/${metod}`, {
    method: "POST",
    ...(body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!j.ok) throw new Error(`Telegram ${metod}: ${j.description ?? `HTTP ${r.status}`}`);
  return j.result as T;
}

let nomi: string | null = null;
let sozlandi = false;

// webhook, buyruqlar ro'yxati — jarayonda bir marta
export async function botSozla() {
  if (!botBor() || sozlandi) return nomi;
  const men = await tg<{ username: string }>("getMe", {});
  nomi = men.username;
  await tg("setWebhook", { url: `${sayt()}/api/telegram/miya`, secret_token: botSiri(), allowed_updates: ["message", "callback_query"] });
  await tg("setMyCommands", {
    commands: [
      { command: "qongiroq", description: "Miya'ga qo'ng'iroq qilish" },
      { command: "tarix", description: "Qo'ng'iroqlar tarixi" },
    ],
  });
  sozlandi = true;
  return nomi;
}

export async function ulashHavolasi(userId: string) {
  const n = await botSozla();
  const kod = randomToken(12);
  await prisma.miyaSozlama.update({ where: { userId }, data: { telegramKod: kod, telegramKodVaqt: new Date() } });
  return `https://t.me/${n}?start=${kod}`;
}

const QONGIROQ = "📞 Miyaga qo'ng'iroq";
const TARIX = "🕘 Qo'ng'iroqlar tarixi";
const KLAVIATURA = { keyboard: [[{ text: QONGIROQ }], [{ text: TARIX }]], resize_keyboard: true, is_persistent: true };

const TZ = 5 * 3600_000;
const soatMatn = (d: Date) => new Date(d.getTime() + TZ).toISOString().slice(11, 16);
const sanaMatn = (d: Date) => new Date(d.getTime() + TZ).toISOString().slice(5, 16).replace("T", " ").replace(/^(\d\d)-(\d\d)/, "$2.$1");

async function havola(userId: string, q: Pick<Qongiroq, "id">) {
  return `${sayt()}/qongiroq?q=${q.id}&t=${await qongiroqToken(userId)}`;
}

async function tugmalar(userId: string, q: Pick<Qongiroq, "id">, matn = "📞 Javob berish") {
  const url = await havola(userId, q);
  // web_app — Telegram ichida ochiladi; ishlamasa — brauzerda
  return { inline_keyboard: [[{ text: matn, web_app: { url } }], [{ text: "🌐 Brauzerda ochish", url }]] };
}

async function chati(userId: string) {
  if (!botBor()) return null;
  const s = await prisma.miyaSozlama.findUnique({ where: { userId }, select: { telegramChat: true } });
  return s?.telegramChat ?? null;
}

// Ovozli xabar (OGG/Opus) — Telegram'da «ovozli xabar» bo'lib chiqadi
async function ovozYubor(chat: string, matn: string, qolgan: Record<string, unknown>) {
  const client = openai();
  if (!client) throw new Error("ovoz yo'q");
  const r = await client.audio.speech.create({
    model: process.env.TELEFON_TTS_MODEL?.trim() || "gpt-4o-mini-tts",
    voice: (process.env.TELEFON_OVOZ?.trim() || "ash") as "ash",
    input: matn.slice(0, 1500),
    instructions: "Yosh erkak kishi ovozida, o'zbek tilida, Toshkent talaffuzida, jonli va quvnoq gapiring. Samimiy, xotirjam va aniq.",
    response_format: "opus",
  });
  const f = new FormData();
  f.append("chat_id", chat);
  f.append("voice", new Blob([await r.arrayBuffer()], { type: "audio/ogg" }), "miya.ogg");
  for (const [k, v] of Object.entries(qolgan)) f.append(k, typeof v === "string" ? v : JSON.stringify(v));
  await tg("sendVoice", f);
}

// Miya egasini chaqiryapti
export async function botChaqir(userId: string, q: Qongiroq) {
  const chat = await chati(userId);
  if (!chat) return false;
  const markup = await tugmalar(userId, q);
  const matn = `📞 Miya sizga qo'ng'iroq qilyapti\n\n${q.sabab}`.slice(0, 1000);
  try {
    await ovozYubor(chat, suhbatOl(q)[0]?.matn ?? q.sabab, { caption: matn, reply_markup: markup });
  } catch {
    await tg("sendMessage", { chat_id: chat, text: matn, reply_markup: markup });
  }
  return true;
}

export async function botXabar(userId: string, text: string) {
  const chat = await chati(userId);
  if (chat) await tg("sendMessage", { chat_id: chat, text }).catch((e) => console.error("miya bot:", e));
}

// Miya yasagan Reels: videoni yuborib, joylash-joylamaslikni so'raydi
export async function botReelsTasdiq(userId: string, approvalId: string, uploadId: string, caption: string) {
  const chat = await chati(userId);
  if (!chat) return false;
  const reply_markup = { inline_keyboard: [[{ text: "✅ Joyla", callback_data: `rt:ha:${approvalId}` }, { text: "❌ Bekor", callback_data: `rt:yoq:${approvalId}` }]] };
  const izoh = `🎬 Yangi Reels tayyor. Instagram'ga joylaymi?\n\n${caption}`.slice(0, 1000);
  const { url } = await uploadForPublish(userId, uploadId);
  try {
    await tg("sendVideo", { chat_id: chat, video: url, caption: izoh, reply_markup });
  } catch {
    // Telegram videoni yuklab ololmasa — havola bilan
    await tg("sendMessage", { chat_id: chat, text: `${izoh}\n\n▶️ Video: ${url}`, reply_markup });
  }
  return true;
}

// Javob berilmadi — tarixda qoladi, «qayta qo'ng'iroq» bilan sababini so'rash mumkin
export async function botOtkazildi(q: Qongiroq) {
  const chat = await chati(q.userId);
  if (!chat) return;
  await tg("sendMessage", {
    chat_id: chat,
    text: `📵 Miya soat ${soatMatn(q.createdAt)} da qo'ng'iroq qilgandi — javob bermadingiz.\n\nSabab: ${sababToza(q.sabab)}`.slice(0, 1500),
    reply_markup: { inline_keyboard: [[{ text: "📞 Qayta qo'ng'iroq qilish", callback_data: `qayta:${q.id}` }]] },
  }).catch((e) => console.error("miya bot:", e));
}

const tg2 = (chat: string, text: string) => tg("sendMessage", { chat_id: chat, text, reply_markup: KLAVIATURA });

async function yangiQongiroq(userId: string, salom: string, sabab = "") {
  return prisma.qongiroq.create({
    data: { userId, yonalish: "kiruvchi", kanal: "web", kalit: randomToken(16), holat: "boshlandi", sabab, suhbat: JSON.stringify([{ kim: "miya", matn: salom }]) },
  });
}

async function tarix(chat: string, userId: string) {
  const qs = await prisma.qongiroq.findMany({
    where: { userId, yonalish: { not: "tasdiq" }, kanal: { not: "telegram" } },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  if (!qs.length) return tg("sendMessage", { chat_id: chat, text: "Hali qo'ng'iroq bo'lmagan.", reply_markup: KLAVIATURA });
  const belgi: Record<string, string> = { javobsiz: "📵", tugadi: "✅", gaplashmoqda: "🗣", boshlandi: "📞", xato: "⚠️" };
  const qator = qs.map((q) => {
    const kim = q.yonalish === "kiruvchi" ? "Siz → Miya" : "Miya → siz";
    const gap = q.yonalish === "chiquvchi" ? q.sabab : (suhbatOl(q).find((g) => g.kim === "men")?.matn ?? "");
    return `${belgi[q.holat] ?? "•"} ${sanaMatn(q.createdAt)} · ${kim}${q.holat === "javobsiz" ? " (javob berilmadi)" : ""}${gap ? `\n   ${gap.slice(0, 140)}` : ""}`;
  });
  const otkazilgan = qs.filter((q) => q.yonalish === "chiquvchi" && q.holat === "javobsiz").slice(0, 4);
  return tg("sendMessage", {
    chat_id: chat,
    text: `🕘 Oxirgi qo'ng'iroqlar:\n\n${qator.join("\n\n")}`.slice(0, 4000),
    ...(otkazilgan.length
      ? { reply_markup: { inline_keyboard: otkazilgan.map((q) => [{ text: `📞 Qayta qo'ng'iroq (${sanaMatn(q.createdAt)})`, callback_data: `qayta:${q.id}` }]) } }
      : {}),
  });
}

// Botdagi ovozli/matnli suhbat: 30 daqiqa ichidagi gaplar bitta suhbat
async function botSuhbat(userId: string) {
  const oxirgi = await prisma.qongiroq.findFirst({ where: { userId, kanal: "telegram" }, orderBy: { createdAt: "desc" } });
  const suhbat = oxirgi ? suhbatOl(oxirgi) : [];
  if (oxirgi && Date.now() - oxirgi.createdAt.getTime() < 3 * 3600_000 && suhbat.length < 30) {
    return oxirgi.tugat ? prisma.qongiroq.update({ where: { id: oxirgi.id }, data: { tugat: false } }) : oxirgi;
  }
  return prisma.qongiroq.create({ data: { userId, yonalish: "kiruvchi", kanal: "telegram", kalit: randomToken(16), holat: "gaplashmoqda" } });
}

async function javobYubor(chat: string, q: Qongiroq) {
  const s = suhbatOl(q);
  const javob = s[s.length - 1]?.matn ?? "";
  try {
    await ovozYubor(chat, javob, { caption: javob.slice(0, 1000) });
  } catch {
    await tg("sendMessage", { chat_id: chat, text: javob });
  }
}

type Update = {
  message?: { chat: { id: number }; text?: string; voice?: { file_id: string; duration: number }; audio?: { file_id: string } };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
};

export async function botYangilanish(u: Update) {
  const chatId = u.message?.chat.id ?? u.callback_query?.message?.chat.id;
  if (chatId == null) return;
  const chat = String(chatId);
  const text = u.message?.text?.trim() ?? "";

  // ulash: /start <kod>
  if (text.startsWith("/start")) {
    const kod = text.split(/\s+/)[1] ?? "";
    const s = kod ? await prisma.miyaSozlama.findUnique({ where: { telegramKod: kod } }) : null;
    if (s && s.telegramKodVaqt && Date.now() - s.telegramKodVaqt.getTime() < 30 * 60_000) {
      await prisma.miyaSozlama.updateMany({ where: { telegramChat: chat }, data: { telegramChat: null } });
      await prisma.miyaSozlama.update({ where: { userId: s.userId }, data: { telegramChat: chat, telegramKod: null } });
      return tg("sendMessage", {
        chat_id: chat,
        text:
          "✅ Ulandi! Endi muhim gap bo'lsa Miya shu yerga qo'ng'iroq qiladi — «📞 Javob berish» ni bosib gaplashasiz.\n\n" +
          "Siz ham pastdagi «📞 Miyaga qo'ng'iroq» tugmasini bosing yoki shu yerga ovozli xabar yuboring — Miya ovoz bilan javob beradi.",
        reply_markup: KLAVIATURA,
      });
    }
  }

  const s = await prisma.miyaSozlama.findUnique({ where: { telegramChat: chat } });
  if (!s) {
    if (u.callback_query) await tg("answerCallbackQuery", { callback_query_id: u.callback_query.id });
    return tg("sendMessage", {
      chat_id: chat,
      text: "Bu — Instagram Cloud «Miya» boti. Ulash uchun saytda: Ofis → Miya → 📞 Telefon → «Telegram'ga ulash».",
    });
  }
  const userId = s.userId;

  if (u.callback_query) {
    await tg("answerCallbackQuery", { callback_query_id: u.callback_query.id }).catch(() => null);
    const rt = u.callback_query.data?.match(/^rt:(ha|yoq):(.+)$/);
    if (rt) {
      try {
        const r = await tasdiqHal(userId, rt[2], rt[1] === "ha");
        return tg2(chat, r.status === "executed" ? "✅ Reels Instagram'ga joylandi." : "❌ Bekor qilindi — joylanmaydi.");
      } catch (e) {
        return tg2(chat, `⚠️ ${e instanceof Error ? e.message : "Xato"}`);
      }
    }
    const id = u.callback_query.data?.startsWith("qayta:") ? u.callback_query.data.slice(6) : "";
    const eski = id ? await prisma.qongiroq.findFirst({ where: { id, userId } }) : null;
    if (!eski) return;
    const vaqt = soatMatn(eski.createdAt);
    const haqiqiy = await tgChaqir(userId, `Salom! Soat ${vaqt} da qo'ng'iroq qilgandim: ${eski.sabab} Nima qilamiz?`, {
      yonalish: "kiruvchi",
      sabab: `Egasi soat ${vaqt} dagi javobsiz qo'ng'iroqqa qayta qo'ng'iroq qildi. O'sha qo'ng'iroq sababi: ${eski.sabab}`,
    });
    if (haqiqiy) return tg2(chat, "📞 Miya hozir sizga qo'ng'iroq qiladi — telefonni ko'taring.");
    const q = await yangiQongiroq(
      userId,
      `Salom! Soat ${vaqt} da qo'ng'iroq qilgandim: ${eski.sabab} Nima qilamiz?`,
      `Egasi soat ${vaqt} dagi javobsiz qo'ng'iroqqa qayta qo'ng'iroq qildi. O'sha qo'ng'iroq sababi: ${eski.sabab}`,
    );
    return tg("sendMessage", { chat_id: chat, text: `📞 Miya bilan qo'ng'iroq — ${vaqt} dagi gap bo'yicha`, reply_markup: await tugmalar(userId, q, "📞 Gaplashish") });
  }

  if (text === QONGIROQ || text.startsWith("/qongiroq") || text.startsWith("/start")) {
    const salom = await salomMatni(userId);
    // Miya akkaunti ulangan bo'lsa — haqiqiy Telegram qo'ng'irog'i (jiringlaydi)
    if (await tgChaqir(userId, salom, { yonalish: "kiruvchi" })) return tg2(chat, "📞 Miya hozir sizga qo'ng'iroq qiladi — telefonni ko'taring.");
    const q = await yangiQongiroq(userId, salom);
    return tg("sendMessage", { chat_id: chat, text: "📞 Miya kutyapti — bosing va gapiring:", reply_markup: await tugmalar(userId, q, "📞 Gaplashish") });
  }
  if (text === TARIX || text.startsWith("/tarix")) return tarix(chat, userId);

  // ovozli yoki oddiy xabar — Miya javob beradi
  const fayl = u.message?.voice?.file_id ?? u.message?.audio?.file_id;
  if (!fayl && !text) return;
  if (!openai()) return tg("sendMessage", { chat_id: chat, text: "⚠️ OPENAI_API_KEY yo'q — Miya javob bera olmaydi." });
  await tg("sendChatAction", { chat_id: chat, action: fayl ? "record_voice" : "typing" }).catch(() => null);
  const q = await botSuhbat(userId);
  let yangi: Qongiroq;
  try {
    if (fayl) {
      const f = await tg<{ file_path: string }>("getFile", { file_id: fayl });
      const r = await fetch(`${API()}/file/bot${token()}/${f.file_path}`);
      if (!r.ok) throw new Error("Ovozli xabarni yuklab bo'lmadi");
      yangi = await gapniIshla(q.id, new Uint8Array(await r.arrayBuffer()), "ovoz.ogg", "audio/ogg");
    } else {
      yangi = await matnniIshla(q.id, text);
    }
  } catch (e) {
    console.error("miya bot:", e);
    const s2 = [...suhbatOl(q), xatoGap(e)];
    yangi = await prisma.qongiroq.update({ where: { id: q.id }, data: { suhbat: JSON.stringify(s2) } });
  }
  await javobYubor(chat, yangi);
}
