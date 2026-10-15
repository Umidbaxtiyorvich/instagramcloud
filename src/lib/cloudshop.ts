// CloudShop (api.cloudshop.ru) — faqat O'QISH uchun mijoz.
// Telegram to'lov boti (@claudeadminbot_bot) ham shu bazaga yozadi; AI Ofis bu yerdan
// kassa (kirim/chiqim), tovarlar qoldig'i, sotuv/qabul hujjatlari va qarzlarni ko'rsatadi.
// Ofisdan CloudShop'ga hech narsa yozilmaydi.

const API = process.env.CLOUDSHOP_API || "https://api.cloudshop.ru";
const TZ_SECONDS = 5 * 3600; // Toshkent

export class CloudShopXato extends Error {}

type Javob = { status?: boolean; error?: unknown; data?: unknown };

export function cloudshopSozlangan() {
  return Boolean(process.env.CS_EMAIL && process.env.CS_PASSWORD && process.env.CLOUDSHOP_APP_KEY);
}

const holat: { access?: string; refresh?: string; company?: string } = {
  company: process.env.CS_COMPANY_ID || undefined,
};

async function xom(method: string, path: string, body?: unknown): Promise<[number, Javob]> {
  const r = await fetch(API + path, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "CloudShop-Key": process.env.CLOUDSHOP_APP_KEY || "",
      "Cloudshop-Timezone": String(TZ_SECONDS),
      ...(holat.access ? { Authorization: `Bearer ${holat.access}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  const data = (await r.json().catch(() => ({ status: false, error: `HTTP ${r.status}` }))) as Javob;
  return [r.status, data];
}

async function kirish() {
  const [st, d] = await xom("POST", "/auth/login", { email: process.env.CS_EMAIL, password: process.env.CS_PASSWORD });
  const t = d.data as { access_token?: string; refresh_token?: string } | undefined;
  if (st !== 200 || !d.status || !t?.access_token) throw new CloudShopXato(`CloudShop'ga kirib bo'lmadi: ${String(d.error ?? st)}`);
  holat.access = t.access_token;
  holat.refresh = t.refresh_token;
  if (!holat.company) {
    const [, prof] = await xom("GET", "/profile");
    const p = (Array.isArray(prof.data) ? prof.data[0] : prof.data) as { positions?: Record<string, unknown>; _client?: string };
    holat.company = Object.keys(p?.positions ?? {})[0] ?? p?._client;
    if (!holat.company) throw new CloudShopXato("CloudShop: kompaniya topilmadi");
  }
}

async function yangilash() {
  if (holat.refresh) {
    const [st, d] = await xom("POST", "/auth/refresh", { refresh_token: holat.refresh });
    const t = d.data as { access_token?: string; refresh_token?: string } | undefined;
    if (st === 200 && d.status && t?.access_token) {
      holat.access = t.access_token;
      holat.refresh = t.refresh_token ?? holat.refresh;
      return;
    }
  }
  await kirish();
}

async function chaqir(method: string, path: string, body?: unknown) {
  if (!holat.access) await kirish();
  const p = () => path.replace(":client", holat.company!);
  let [st, d] = await xom(method, p(), body);
  // token eskirsa CloudShop ba'zan {status:false} qaytaradi — bir marta yangilab qayta urinamiz
  if (st >= 400 || d.status === false) {
    await yangilash();
    [st, d] = await xom(method, p(), body);
  }
  if (st >= 400 || d.status === false) throw new CloudShopXato(`CloudShop ${method} ${path}: ${String(d.error ?? st)}`);
  return d;
}

async function hammasi(kind: "money" | "docs", body: Record<string, unknown>, maks = 5000) {
  const rows: Record<string, unknown>[] = [];
  for (let off = 0; off < maks; off += 100) {
    const d = await chaqir("POST", `/search/${kind}/:client/${off}/100`, body);
    const page = (d.data as Record<string, unknown>[]) ?? [];
    rows.push(...page);
    if (page.length < 100) break;
  }
  return rows;
}

// ---------- kesh (CloudShop'ni har bosishda qiynamaslik uchun) ----------
const kesh = new Map<string, { at: number; v: unknown }>();
async function keshla<T>(kalit: string, soniya: number, f: () => Promise<T>): Promise<T> {
  const k = kesh.get(kalit);
  if (k && Date.now() - k.at < soniya * 1000) return k.v as T;
  const v = await f();
  kesh.set(kalit, { at: Date.now(), v });
  return v;
}

// ---------- ma'lumot turlari ----------
export type PulHarakati = {
  id: string;
  sana: number; // unix soniya
  tur: "kirim" | "chiqim";
  summa: number;
  raqam: string;
  toifa: string;
  hisob: string;
  kontragent: string;
  izoh: string;
};

export type Hujjat = {
  id: string;
  sana: number;
  tur: string; // sales, return_sales, purchases, ...
  turNomi: string;
  summa: number;
  raqam: string;
  kontragent: string;
  izoh: string;
  tovarSoni: number;
};

export type Tovar = {
  id: string;
  nom: string;
  birlik: string;
  narx: number;
  tannarx: number;
  qoldiq: number;
  qiymat: number; // qoldiq × tannarx
  sku: string;
};

export type Qarzdor = { id: string; nom: string; telefon: string; qarz: number; sotuv: number; tolangan: number };

const HUJJAT_NOMI: Record<string, string> = {
  sales: "Sotuv (yuk berildi)",
  return_sales: "Qaytarildi",
  purchases: "Tovar qabul qilindi",
  return_purchases: "Ta'minotchiga qaytarildi",
  moves: "Ko'chirish",
  inventory: "Inventarizatsiya",
  writeoff: "Hisobdan chiqarish",
};

const nomi = (x: unknown) =>
  typeof x === "string" ? x : x && typeof x === "object" && "name" in x ? String((x as { name: unknown }).name ?? "") : "";
const son = (x: unknown) => Math.round(Number(x) || 0);

async function malumotnoma() {
  return keshla("refs", 600, async () => {
    const [acc, src] = await Promise.all([chaqir("GET", "/data/:client/accounts"), chaqir("GET", "/data/:client/sources")]);
    const hisoblar = new Map<string, string>();
    for (const a of (acc.data as { _id: string; name: string }[]) ?? []) hisoblar.set(a._id, a.name);
    const toifalar = new Map<string, string>();
    for (const s of (src.data as { id: number; type: string; title: string }[]) ?? []) toifalar.set(`${s.type}:${s.id}`, s.title);
    return { hisoblar, toifalar };
  });
}

export async function kassa(dan: number, gacha: number): Promise<PulHarakati[]> {
  return keshla(`kassa:${dan}:${gacha}`, 60, async () => {
    const [rows, r] = await Promise.all([hammasi("money", { start: dan, end: gacha }), malumotnoma()]);
    return rows
      .filter((m) => !m.deleted && m.status !== false && Number(m.sum))
      .map((m) => {
        const tur = m.type === "credit" ? ("chiqim" as const) : ("kirim" as const);
        return {
          id: String(m._id ?? m.uuid ?? ""),
          sana: son(m.date),
          tur,
          summa: son(m.sum),
          raqam: String(m.number ?? ""),
          toifa: r.toifalar.get(`${m.type}:${m.source}`) ?? "",
          hisob: r.hisoblar.get(String(m.store)) ?? "",
          kontragent: nomi(m.contragent),
          izoh: String(m.comment ?? "").slice(0, 200),
        };
      })
      .sort((a, b) => b.sana - a.sana);
  });
}

export async function hujjatlar(dan: number, gacha: number): Promise<Hujjat[]> {
  return keshla(`docs:${dan}:${gacha}`, 60, async () => {
    const rows = await hammasi("docs", { start: dan, end: gacha });
    return rows
      .filter((d) => !d.deleted && d.status !== false)
      .map((d) => ({
        id: String(d._id ?? ""),
        sana: son(d.date),
        tur: String(d.type ?? ""),
        turNomi: HUJJAT_NOMI[String(d.type)] ?? String(d.type ?? ""),
        summa: son(d.sum),
        raqam: String(d.number ?? ""),
        kontragent: nomi(d.contractor ?? d.contragent),
        izoh: String(d.comment ?? "").slice(0, 200),
        tovarSoni: Array.isArray(d.items) ? d.items.length : Array.isArray(d.goods) ? d.goods.length : 0,
      }))
      .sort((a, b) => b.sana - a.sana);
  });
}

export async function tovarlar(): Promise<Tovar[]> {
  return keshla("tovarlar", 120, async () => {
    const rows: Record<string, unknown>[] = [];
    for (let off = 0; off < 20000; off += 500) {
      const d = await chaqir("GET", `/data/:client/catalog/?limit=500&offset=${off}`);
      const page = (d.data as Record<string, unknown>[]) ?? [];
      rows.push(...page);
      if (page.length < 500) break;
    }
    return rows
      .filter((p) => !p.deleted && p.type !== "group")
      .map((p) => {
        const stock = p.stock;
        const qoldiq =
          typeof stock === "number"
            ? stock
            : stock && typeof stock === "object"
              ? Object.values(stock as Record<string, unknown>).reduce<number>((s, v) => s + (Number(v) || 0), 0)
              : 0;
        const tannarx = son(p.cost) || son(p.purchase);
        return {
          id: String(p._id),
          nom: String(p.name ?? ""),
          birlik: String(p.unit ?? ""),
          narx: son(p.price),
          tannarx,
          qoldiq: Math.round(qoldiq * 1000) / 1000,
          qiymat: Math.round(qoldiq * tannarx),
          sku: String(p.sku ?? ""),
        };
      })
      .sort((a, b) => b.qiymat - a.qiymat);
  });
}

const jami = (x: unknown) =>
  typeof x === "number" ? x : x && typeof x === "object" ? Number((x as { sum?: unknown; total?: unknown }).sum ?? (x as { total?: unknown }).total) || 0 : 0;

export async function qarzlar(): Promise<Qarzdor[]> {
  return keshla("qarzlar", 120, async () => {
    const d = await chaqir("GET", "/data/:client/clients/extended/");
    return ((d.data as Record<string, unknown>[]) ?? [])
      .filter((c) => !c.deleted)
      .map((c) => {
        const sotuv = jami(c.sales) - jami(c.return_sales);
        const tolangan = jami(c.debit) - jami(c.credit);
        return {
          id: String(c._id),
          nom: String(c.name ?? ""),
          telefon: Array.isArray(c.phones) ? c.phones.join(", ") : "",
          qarz: Math.round(sotuv - tolangan),
          sotuv: Math.round(sotuv),
          tolangan: Math.round(tolangan),
        };
      })
      .filter((c) => c.qarz > 0)
      .sort((a, b) => b.qarz - a.qarz);
  });
}
