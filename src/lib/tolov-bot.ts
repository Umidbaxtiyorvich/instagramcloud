// Telegram to'lov boti (@claudeadminbot_bot, Railway) API'si — faqat o'qish.
// Bot guruhga tashlangan to'lov cheklarini (rasm/matn) o'qib, CloudShop'ga kirim qiladi.
// Bu yerdan cheklar tarixi va holati olinadi. Kalit: botdagi API_KEY (X-Api-Key sarlavhasi).

export function botSozlangan() {
  return Boolean(process.env.TOLOV_BOT_URL && process.env.TOLOV_BOT_API_KEY);
}

export type BotTolov = {
  id: string;
  sana: string; // ISO
  guruh: string;
  yubordi: string;
  tolovchi: string;
  matn: string;
  holat: string; // pending | done | ...
  summa: number;
  qatorlar: { sana: number; summa: number; holat: string }[];
  izoh: string;
  rasm: boolean;
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
  ai?: { payer_name?: string; note?: string; entries?: { ts?: number; amount?: number; state?: string }[] };
  entries?: { ts?: number; amount?: number; state?: string }[];
};

export async function botTolovlar(): Promise<BotTolov[]> {
  const rows = await bot<Xom[]>("/items");
  return rows
    .map((m) => {
      const qatorlar = (m.entries ?? m.ai?.entries ?? []).map((e) => ({
        sana: Number(e.ts) || 0,
        summa: Math.round(Number(e.amount) || 0),
        holat: String(e.state ?? ""),
      }));
      return {
        id: m.id,
        sana: m.date,
        guruh: m.chat_title ?? "",
        yubordi: m.full_name ?? (m.username ? `@${m.username}` : ""),
        tolovchi: m.ai?.payer_name ?? "",
        matn: (m.text ?? "").slice(0, 200),
        holat: m.status,
        summa: qatorlar.reduce((s, q) => s + q.summa, 0),
        qatorlar,
        izoh: (m.note || m.ai?.note || "").slice(0, 200),
        rasm: Boolean(m.has_photo),
      };
    })
    .sort((a, b) => (a.sana < b.sana ? 1 : -1));
}

export async function botQarzlar() {
  return bot<{ count: number; total: number; top: { id: string; name: string; phones: string; debt: number }[] }>(
    "/report/debts",
  );
}
