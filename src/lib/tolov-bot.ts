// Telegram to'lov boti (@claudeadminbot_bot, Railway) API'si — faqat o'qish.
// Bot guruhga tashlangan to'lov cheklarini (rasm/matn) o'qib, CloudShop'ga kirim qiladi.
// Bu yerdan cheklar tarixi va holati olinadi. Kalit: botdagi API_KEY (X-Api-Key sarlavhasi).

export function botSozlangan() {
  return Boolean(process.env.TOLOV_BOT_URL && process.env.TOLOV_BOT_API_KEY);
}

// Bitta to'lov = xabardagi bitta to'lov qatori. Bot daftar rasmidagi hamma qatorlarni o'qiydi,
// lekin faqat oxirgisi yangi to'lov — qolganlari "history" (oldin yozilgan) va hisobga kirmaydi.
export type TolovHolat =
  | "done" // CloudShop'ga kiritildi
  | "exists" // CloudShop'da oldindan bor edi
  | "new" // admin tasdig'ini kutmoqda
  | "old" // CloudShop'dagi oxirgi to'lovdan eski sana — tekshirish kerak
  | "future" // sana kelajakda — xato yozilgan bo'lishi mumkin
  | "oqilmoqda"; // bot hali o'qimagan

export const KUTMOQDA: ReadonlySet<TolovHolat> = new Set(["new", "old", "future", "oqilmoqda"]);

export type BotTolov = {
  id: string;
  xabarId: string;
  sana: number; // to'lov sanasi (unix, s); o'qilmagan bo'lsa — xabar vaqti
  sanaAniq: boolean;
  xabarSana: number; // xabar guruhga tashlangan vaqt
  guruh: string;
  yubordi: string;
  tolovchi: string;
  matn: string;
  holat: TolovHolat;
  summa: number;
  izoh: string;
  rasm: boolean;
  takror: number; // shu to'lov guruhga necha marta qayta tashlangan (bir marta sanaladi)
};

async function bot<T>(path: string): Promise<T> {
  const r = await fetch(process.env.TOLOV_BOT_URL!.replace(/\/$/, "") + path, {
    headers: { "X-Api-Key": process.env.TOLOV_BOT_API_KEY! },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (r.status === 401) throw new Error("Telegram bot API kaliti noto'g'ri (TOLOV_BOT_API_KEY)");
  if (!r.ok) throw new Error(`Telegram bot javob bermadi: HTTP ${r.status}`);
  return (await r.json()) as T;
}

type Xom = {
  id: string;
  date: string;
  chat_title?: string | null;
  full_name?: string | null;
  username?: string | null;
  text?: string;
  status: string;
  note?: string;
  has_photo?: boolean;
  ai?: { payer_name?: string; note?: string } | null;
  entries?: { ts?: number; date_ok?: boolean; amount?: number; state?: string }[];
};

const TOLOV_HOLATLARI = new Set(["done", "exists", "new", "old", "future"]);

export async function botTolovlar(): Promise<BotTolov[]> {
  const rows = await bot<Xom[]>("/items");
  const out: BotTolov[] = [];
  for (const m of rows) {
    const xabarSana = Math.floor(Date.parse(m.date) / 1000) || 0;
    const umumiy = {
      xabarId: m.id,
      xabarSana,
      guruh: m.chat_title ?? "",
      yubordi: m.full_name ?? (m.username ? `@${m.username}` : ""),
      tolovchi: m.ai?.payer_name ?? "",
      matn: (m.text ?? "").slice(0, 200),
      izoh: (m.note || m.ai?.note || "").slice(0, 200),
      rasm: Boolean(m.has_photo),
    };
    const entries = m.entries ?? [];
    // bot hali o'qimagan xabar — summasiz, "o'qilmoqda"
    if (m.status === "pending" && !m.ai && !entries.length) {
      out.push({ ...umumiy, id: m.id, sana: xabarSana, sanaAniq: false, holat: "oqilmoqda", summa: 0, takror: 0 });
      continue;
    }
    entries.forEach((e, k) => {
      // "history" — daftardagi eski yozuvlar, "skipped" — admin o'tkazib yuborgan yoki to'lov emas
      if (!TOLOV_HOLATLARI.has(String(e.state))) return;
      // xabar butunlay o'tkazilgan ("to'lov emas") bo'lsa, faqat CloudShop'ga tushganlari to'lov
      if (m.status === "skipped" && e.state !== "done" && e.state !== "exists") return;
      const summa = Math.round(Number(e.amount) || 0);
      if (summa <= 0) return;
      out.push({
        ...umumiy,
        id: `${m.id}:${k}`,
        sana: Number(e.ts) || xabarSana,
        sanaAniq: e.date_ok !== false,
        holat: e.state as TolovHolat,
        summa,
        takror: 0,
      });
    });
  }
  out.sort((a, b) => b.sana - a.sana || a.xabarSana - b.xabarSana);
  // Bir chek guruhga ikki marta tashlansa, ikkalasi ham "CloudShop'da bor" bo'lib chiqadi —
  // bir xil to'lovchi, summa va kun bo'lsa bitta to'lov deb sanaymiz
  const kun = (ts: number) => Math.floor((ts + 5 * 3600) / 86400);
  const birinchi = new Map<string, BotTolov>();
  const natija: BotTolov[] = [];
  for (const r of out) {
    const kalit = `${(r.tolovchi || r.yubordi).trim().toLowerCase()}|${r.summa}|${kun(r.sana)}`;
    const avval = r.summa && r.sanaAniq ? birinchi.get(kalit) : undefined;
    if (avval && avval.xabarId !== r.xabarId && (r.holat === "done" || r.holat === "exists")) {
      avval.takror++;
      continue;
    }
    if (r.summa && r.sanaAniq && !birinchi.has(kalit)) birinchi.set(kalit, r);
    natija.push(r);
  }
  return natija.sort((a, b) => b.sana - a.sana || b.xabarSana - a.xabarSana);
}

export async function botQarzlar() {
  return bot<{ count: number; total: number; top: { id: string; name: string; phones: string; debt: number }[] }>(
    "/report/debts",
  );
}
