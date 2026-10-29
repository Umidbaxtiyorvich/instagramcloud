// GitHub Actions'da: saytdan ssenariyni oladi, videoni yasaydi va qaytaradi.
// Saytga kirish — GitHub OIDC tokeni (audience = sayt manzili), boshqa kalit yo'q.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ISH = process.env.ISH ?? "";
const SAYT = (process.env.SAYT ?? "").replace(/\/+$/, "");
if (!/^[a-z0-9]{20,40}$/i.test(ISH)) throw new Error("ISH noto'g'ri");
if (!/^https:\/\/[^\s/]+$/.test(SAYT)) throw new Error("SAYT noto'g'ri");

async function oidc() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const tok = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !tok) throw new Error("OIDC yo'q — workflow'da id-token: write kerak");
  const r = await fetch(`${url}&audience=${encodeURIComponent(SAYT)}`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`OIDC token olinmadi: HTTP ${r.status}`);
  return ((await r.json()) as { value: string }).value;
}

const manzil = `${SAYT}/api/video/ish/${ISH}`;

async function yuborBir(body: Uint8Array | null, xato?: string) {
  const r = await fetch(manzil, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await oidc()}`,
      ...(xato ? { "x-xato": encodeURIComponent(xato.slice(0, 900)) } : { "Content-Type": "video/mp4" }),
    },
    body: body ? new Blob([new Uint8Array(body)], { type: "video/mp4" }) : undefined,
    signal: AbortSignal.timeout(240_000),
  });
  const matn = r.ok ? "" : await r.text();
  // oldingi urinish aslida yetib borgan, faqat javobi yo'qolgan
  if (r.status === 400 && matn.includes("allaqachon tugagan")) return;
  if (!r.ok) throw Object.assign(new Error(`Sayt qabul qilmadi: HTTP ${r.status} ${matn}`), { qayta: r.status >= 500 });
}

// Render qayta ishga tushayotgan (deploy, xotira) paytda 502/503 beradi — bir-ikki daqiqa kutib qayta yuboramiz
async function yubor(body: Uint8Array | null, xato?: string) {
  const kutish = [15, 30, 60, 90];
  for (let i = 0; ; i++) {
    try {
      return await yuborBir(body, xato);
    } catch (e) {
      const qayta = (e as { qayta?: boolean }).qayta !== false; // tarmoq xatosi ham qayta urinadi
      if (!qayta || i >= kutish.length) throw e;
      console.error(`${e instanceof Error ? e.message : e} — ${kutish[i]} s dan keyin qayta yuboraman`);
      await new Promise((r) => setTimeout(r, kutish[i] * 1000));
    }
  }
}

// Render bepul serveri uxlab qolgan bo'lsa, birinchi so'rov uyg'otadi (≈1 daqiqa)
const ol = await fetch(manzil, { headers: { Authorization: `Bearer ${await oidc()}` }, signal: AbortSignal.timeout(180_000) });
if (!ol.ok) throw new Error(`Ish olinmadi: HTTP ${ol.status} ${await ol.text()}`);
const { spec } = (await ol.json()) as { spec: unknown };

try {
  const { renderVideo } = await import(pathToFileURL(resolve("video.ts")).href);
  const t0 = Date.now();
  const r = await renderVideo(spec);
  console.log(`video tayyor: ${r.seconds} s, ${Math.round(r.bytes.length / 1024)} KB, ${Date.now() - t0} ms`);
  await yubor(r.bytes);
  console.log("saytga yuborildi");
} catch (e) {
  const m = e instanceof Error ? e.message : String(e);
  console.error(m);
  await yubor(null, m).catch((x) => console.error("xatoni yuborib bo'lmadi:", x));
  process.exit(1);
}
