// AI Ofis "Moliya" jamoasi: CloudShop (kassa, tovarlar, hujjatlar, qarzlar)
// va Telegram to'lov boti cheklari. Hammasi faqat o'qish.
import { cloudshopSozlangan, hujjatlar, kassa, qarzlar, tovarlar } from "./cloudshop";
import { KUTMOQDA, botQarzlar, botSozlangan, botTolovlar, type TolovHolat } from "./tolov-bot";

const KUN = 86400;
const TZ = 5 * 3600;

export const pul = (n: number) => `${Math.round(n).toLocaleString("en-US").replace(/,/g, " ")} so'm`;
const sana = (ts: number) => new Date((ts + TZ) * 1000).toISOString().slice(0, 10).split("-").reverse().join(".");

// Toshkent bo'yicha kun boshi
export function kunBoshi(ts = Date.now() / 1000) {
  return Math.floor((ts + TZ) / KUN) * KUN - TZ;
}

export type Davr = "bugun" | "kecha" | "hafta" | "oy";
export function davrOraligi(d: Davr): [number, number] {
  const bugun = kunBoshi();
  const hozir = Math.floor(Date.now() / 1000);
  if (d === "kecha") return [bugun - KUN, bugun - 1];
  if (d === "hafta") return [bugun - 6 * KUN, hozir];
  if (d === "oy") return [bugun - 29 * KUN, hozir];
  return [bugun, hozir];
}

export function moliyaHolati() {
  return { cloudshop: cloudshopSozlangan(), bot: botSozlangan() };
}

export async function kassaXulosa(dan: number, gacha: number) {
  const rows = await kassa(dan, gacha);
  const kirim = rows.filter((r) => r.tur === "kirim").reduce((s, r) => s + r.summa, 0);
  const chiqim = rows.filter((r) => r.tur === "chiqim").reduce((s, r) => s + r.summa, 0);
  return { rows, kirim, chiqim, sof: kirim - chiqim };
}

export async function hujjatXulosa(dan: number, gacha: number) {
  const rows = await hujjatlar(dan, gacha);
  const sotuv = rows.filter((r) => r.tur === "sales").reduce((s, r) => s + r.summa, 0);
  const qabul = rows.filter((r) => r.tur === "purchases").reduce((s, r) => s + r.summa, 0);
  return { rows, sotuv, qabul };
}

export async function tovarXulosa() {
  const rows = await tovarlar();
  return {
    rows,
    jamiQiymat: rows.reduce((s, r) => s + Math.max(0, r.qiymat), 0),
    tugagan: rows.filter((r) => r.qoldiq <= 0).length,
  };
}

export async function qarzXulosa() {
  const rows = cloudshopSozlangan()
    ? await qarzlar()
    : (await botQarzlar()).top.map((r) => ({ id: r.id, nom: r.name, telefon: r.phones, qarz: r.debt, sotuv: 0, tolangan: 0 }));
  return { rows, jami: rows.reduce((s, r) => s + r.qarz, 0) };
}

// Davr to'lov sanasi bo'yicha (daftardagi sana), xabar tashlangan vaqt bo'yicha emas
export async function tolovXulosa(dan: number, gacha: number) {
  const rows = (await botTolovlar()).filter((r) => r.sana >= dan && r.sana <= gacha);
  const kiritildi = rows.filter((r) => r.holat === "done" || r.holat === "exists");
  return {
    rows,
    jami: rows.reduce((s, r) => s + r.summa, 0),
    kiritildi: kiritildi.reduce((s, r) => s + r.summa, 0),
    kutmoqda: rows.filter((r) => KUTMOQDA.has(r.holat)).length,
  };
}

export const TOLOV_HOLAT_NOMI: Record<TolovHolat, string> = {
  done: "✅ CloudShop'ga kiritildi",
  exists: "☑️ CloudShop'da oldindan bor",
  new: "🆕 tasdiq kutmoqda",
  old: "⚠️ eski sana — tekshirish kerak",
  future: "🔮 sana kelajakda — tekshirish kerak",
  oqilmoqda: "⏳ bot hali o'qimadi",
};

// ---------- agentlar uchun matnli hisobotlar ----------
export async function moliyaVosita(nom: string, args: { davr?: Davr; qidiruv?: string }) {
  const [dan, gacha] = davrOraligi(args.davr ?? "bugun");
  const davrNomi = { bugun: "bugun", kecha: "kecha", hafta: "oxirgi 7 kun", oy: "oxirgi 30 kun" }[args.davr ?? "bugun"];
  if (nom === "moliya_kassa") {
    const d = await kassaXulosa(dan, gacha);
    return (
      `💵 Kassa (${davrNomi}): kirim ${pul(d.kirim)}, chiqim ${pul(d.chiqim)}, sof ${pul(d.sof)}. ${d.rows.length} ta harakat.\n` +
      d.rows
        .slice(0, 25)
        .map((r) => `${sana(r.sana)} ${r.tur === "kirim" ? "➕" : "➖"} ${pul(r.summa)} · ${r.toifa || "—"} · ${r.kontragent || "—"}${r.izoh ? ` · ${r.izoh}` : ""}`)
        .join("\n")
    );
  }
  if (nom === "moliya_hujjatlar") {
    const d = await hujjatXulosa(dan, gacha);
    return (
      `📦 Hujjatlar (${davrNomi}): sotuv ${pul(d.sotuv)}, tovar qabul ${pul(d.qabul)}. ${d.rows.length} ta hujjat.\n` +
      d.rows.slice(0, 25).map((r) => `${sana(r.sana)} ${r.turNomi} №${r.raqam} · ${r.kontragent || "—"} · ${pul(r.summa)}`).join("\n")
    );
  }
  if (nom === "moliya_tovarlar") {
    const d = await tovarXulosa();
    const q = (args.qidiruv ?? "").toLowerCase();
    const rows = q ? d.rows.filter((r) => r.nom.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)) : d.rows;
    return (
      `📦 Tovarlar: ${d.rows.length} xil, ombordagi qiymat ${pul(d.jamiQiymat)}, tugagan: ${d.tugagan} xil.\n` +
      rows.slice(0, 30).map((r) => `• ${r.nom}: ${r.qoldiq} ${r.birlik} · narx ${pul(r.narx)} · qiymat ${pul(r.qiymat)}`).join("\n")
    );
  }
  if (nom === "moliya_qarzlar") {
    const d = await qarzXulosa();
    return (
      `💰 Xaridorlar qarzi: ${d.rows.length} ta qarzdor, jami ${pul(d.jami)}.\n` +
      d.rows.slice(0, 20).map((r, i) => `${i + 1}. ${r.nom}${r.telefon ? ` (${r.telefon})` : ""} — ${pul(r.qarz)}`).join("\n")
    );
  }
  if (nom === "moliya_tolovlar") {
    const d = await tolovXulosa(dan, gacha);
    return (
      `📲 Telegram bot orqali kelgan to'lovlar (${davrNomi}, to'lov sanasi bo'yicha): ${d.rows.length} ta, jami ${pul(d.jami)}, ` +
      `shundan CloudShop'ga kiritilgan ${pul(d.kiritildi)}, tekshiruv kutmoqda: ${d.kutmoqda}.\n` +
      d.rows
        .slice(0, 25)
        .map(
          (r) =>
            `${sana(r.sana)}${r.sanaAniq ? "" : " (sana o'qilmagan)"} · ${r.summa ? pul(r.summa) : "—"} · ${r.tolovchi || r.yubordi || "—"} · ${TOLOV_HOLAT_NOMI[r.holat]}`,
        )
        .join("\n")
    );
  }
  throw new Error(`Noma'lum vosita: ${nom}`);
}

const DAVR_SCHEMA = {
  type: "string",
  enum: ["bugun", "kecha", "hafta", "oy"],
  description: "Davr: bugun, kecha, oxirgi 7 kun (hafta) yoki 30 kun (oy)",
};

// Claude uchun vositalar (faqat o'qish)
export const MOLIYA_VOSITALAR = [
  {
    name: "moliya_kassa",
    description: "CloudShop kassasi: pul kirimi va chiqimi tarixi (sana, summa, toifa, kontragent, izoh) va jami.",
    inputSchema: { type: "object", properties: { davr: DAVR_SCHEMA }, additionalProperties: false },
  },
  {
    name: "moliya_hujjatlar",
    description: "CloudShop hujjatlari: sotuvlar (yuk berildi), tovar qabul qilish, qaytarishlar tarixi.",
    inputSchema: { type: "object", properties: { davr: DAVR_SCHEMA }, additionalProperties: false },
  },
  {
    name: "moliya_tovarlar",
    description: "CloudShop tovarlari: qoldiq, narx, ombordagi qiymat. qidiruv bilan nom/SKU bo'yicha filtrlash mumkin.",
    inputSchema: { type: "object", properties: { qidiruv: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "moliya_qarzlar",
    description: "Xaridorlar qarzi (eng ko'p qarzdorlar birinchi).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "moliya_tolovlar",
    description: "Telegram to'lov botiga (@claudeadminbot_bot) guruhdan kelgan to'lov cheklari va holati.",
    inputSchema: { type: "object", properties: { davr: DAVR_SCHEMA }, additionalProperties: false },
  },
];

export const MOLIYA_NOMLARI: Record<string, string> = {
  moliya_kassa: "Kassa (kirim-chiqim) o'qildi",
  moliya_hujjatlar: "Sotuv/qabul hujjatlari o'qildi",
  moliya_tovarlar: "Tovarlar qoldig'i o'qildi",
  moliya_qarzlar: "Qarzlar o'qildi",
  moliya_tolovlar: "Telegram bot cheklari o'qildi",
};

// Claude'siz: kalit so'zlardan moliya vazifasini aniqlash
export async function lokalMoliya(matn: string) {
  const t = matn.toLowerCase().replace(/[‘’ʻʼ`]/g, "'");
  const davr: Davr = /kecha/.test(t) ? "kecha" : /hafta|7 kun/.test(t) ? "hafta" : /oy|30 kun/.test(t) ? "oy" : "bugun";
  let vosita: string | null = null;
  // "bot" faqat so'z boshida: "hisobot" ichidagi "bot" cheklarga olib ketmasin
  if (/telegram|(^|[^a-z'])bot|chek|transfer/.test(t)) vosita = "moliya_tolovlar";
  else if (/qarz/.test(t)) vosita = "moliya_qarzlar";
  else if (/tovar|qoldiq|ombor|sklad/.test(t)) vosita = "moliya_tovarlar";
  else if (/sotuv|yuk|qabul|hujjat|nakladnoy/.test(t)) vosita = "moliya_hujjatlar";
  else if (/kirim|chiqim|kassa|pul|xarajat|daromad|tushum/.test(t)) vosita = "moliya_kassa";
  if (!vosita) return null;
  const h = moliyaHolati();
  const kerak = vosita === "moliya_tolovlar" ? h.bot : vosita === "moliya_qarzlar" ? h.cloudshop || h.bot : h.cloudshop;
  if (!kerak) {
    return {
      vosita,
      natija:
        vosita === "moliya_tolovlar"
          ? "Telegram bot hali ulanmagan. Server sozlamalariga TOLOV_BOT_URL (botning Railway manzili) va TOLOV_BOT_API_KEY (botdagi API_KEY) ni qo'shing."
          : "CloudShop hali ulanmagan. Server sozlamalariga CS_EMAIL, CS_PASSWORD va CLOUDSHOP_APP_KEY ni qo'shing (bot bilan bir xil qiymatlar).",
    };
  }
  const qidiruv = vosita === "moliya_tovarlar" ? (t.match(/[«"]([^»"]+)[»"]/)?.[1] ?? "") : undefined;
  return { vosita, natija: await moliyaVosita(vosita, { davr, qidiruv }) };
}

// Do'kon moliyasi maxfiy: faqat MOLIYA_ADMIN_EMAILS ro'yxatidagi foydalanuvchilar ko'radi.
export function moliyaRuxsat(email: string | null | undefined) {
  const list = (process.env.MOLIYA_ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email && list.includes(email.toLowerCase()));
}
