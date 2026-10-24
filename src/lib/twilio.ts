import { createHmac, timingSafeEqual } from "crypto";
import { configuredUrl } from "./url";

// Twilio — Miya'ning telefon raqami. SDK'siz: REST so'rovlari va TwiML (XML) javoblar.

export function twilioSozlangan() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_NUMBER);
}

export const miyaRaqami = () => process.env.TWILIO_NUMBER?.trim() || "";

function hisob() {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  if (!sid || !token || !miyaRaqami()) throw new Error("Twilio sozlanmagan: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_NUMBER kerak");
  return { sid, auth: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` };
}

async function api(method: "GET" | "POST" | "DELETE", yol: string, form?: Record<string, string>) {
  const { sid, auth } = hisob();
  const r = await fetch(`${process.env.TWILIO_API_URL || "https://api.twilio.com"}/2010-04-01/Accounts/${sid}${yol}`, {
    method,
    headers: { Authorization: auth, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  });
  if (method === "DELETE") return null;
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`Twilio: ${String(j.message ?? `HTTP ${r.status}`)}`);
  return j;
}

export function sayt() {
  const u = configuredUrl();
  if (!u) throw new Error("Sayt manzili noma'lum: APP_URL ni sozlang");
  return u;
}

// Twilio'ning X-Twilio-Signature imzosi: HMAC-SHA1(auth token, to'liq URL + saralangan POST maydonlari)
export function imzoTogri(req: Request, maydonlar: Record<string, string>) {
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  const imzo = req.headers.get("x-twilio-signature") || "";
  if (!token || !imzo) return false;
  const u = new URL(req.url);
  const url = `${configuredUrl() || u.origin}${u.pathname}${u.search}`;
  const matn = url + Object.keys(maydonlar).sort().map((k) => k + maydonlar[k]).join("");
  const kerak = createHmac("sha1", token).update(matn).digest("base64");
  return kerak.length === imzo.length && timingSafeEqual(Buffer.from(kerak), Buffer.from(imzo));
}

export async function maydonlar(req: Request) {
  const f = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export async function qongiroqBoshla(kimga: string, url: string, holatUrl: string) {
  const j = await api("POST", "/Calls.json", {
    To: kimga,
    From: miyaRaqami(),
    Url: url,
    StatusCallback: holatUrl,
    StatusCallbackEvent: "completed",
    Timeout: "30",
  });
  return String(j?.sid ?? "");
}

// Gapirilgan javob yozuvi (mp3). Yozuv tayyor bo'lishi bir lahza kechikishi mumkin.
export async function yozuvniOl(recordingUrl: string) {
  const { auth } = hisob();
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${recordingUrl}.mp3`, { headers: { Authorization: auth } });
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
    if (r.status !== 404) throw new Error(`Yozuv olinmadi: HTTP ${r.status}`);
    await new Promise((ok) => setTimeout(ok, 700));
  }
  throw new Error("Yozuv topilmadi");
}

// Ovoz yozuvi Twilio'da qolmasin — matnga o'girilgach o'chiriladi
export async function yozuvniOchir(recordingSid: string) {
  if (/^RE[0-9a-f]{32}$/.test(recordingSid)) await api("DELETE", `/Recordings/${recordingSid}.json`).catch(() => null);
}

// Miya raqamiga kelgan qo'ng'iroqlar shu saytga yo'nalsin (Twilio konsolida qo'lda qilish shart emas)
let sozlandi = false;
export async function raqamniSozla() {
  if (sozlandi) return;
  const raqam = miyaRaqami();
  const j = await api("GET", `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(raqam)}`);
  const r = (j?.incoming_phone_numbers as { sid: string; voice_url: string }[] | undefined)?.[0];
  if (!r) throw new Error(`${raqam} raqami bu Twilio hisobida topilmadi`);
  const kerak = `${sayt()}/api/telefon/kiruvchi`;
  if (r.voice_url !== kerak) await api("POST", `/IncomingPhoneNumbers/${r.sid}.json`, { VoiceUrl: kerak, VoiceMethod: "POST" });
  sozlandi = true;
}

// ---------- TwiML ----------

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// OpenAI bo'lmasa, o'zbekcha (lotin) matnni turkcha ovoz o'qiydi — talaffuzi eng yaqini
export const tw = {
  play: (url: string) => `<Play>${xml(url)}</Play>`,
  say: (matn: string) => `<Say language="tr-TR">${xml(matn)}</Say>`,
  pause: (s: number) => `<Pause length="${s}"/>`,
  redirect: (url: string) => `<Redirect method="POST">${xml(url)}</Redirect>`,
  record: (action: string) =>
    `<Record action="${xml(action)}" method="POST" maxLength="40" timeout="3" playBeep="true" trim="trim-silence"/>`,
  pin: (action: string, ichida: string) => `<Gather input="dtmf" finishOnKey="#" timeout="8" action="${xml(action)}" method="POST">${ichida}</Gather>`,
  hangup: () => "<Hangup/>",
};

export function twiml(...qismlar: string[]) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${qismlar.join("")}</Response>`, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

// O'zbekiston raqami: 901234567, 998901234567, +998 90 123-45-67 → +998901234567
export function raqamTozala(s: string) {
  const r = s.replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(r)) return r;
  if (/^998\d{9}$/.test(r)) return `+${r}`;
  if (/^\d{9}$/.test(r)) return `+998${r}`;
  return null;
}
