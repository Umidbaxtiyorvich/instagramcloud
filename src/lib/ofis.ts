// AI Ofis: jamoalar, agentlar va vazifani to'g'ri jamoaga yo'naltirish.
// Bu fayl ham brauzerda, ham serverda ishlatiladi.

export type JamoaId =
  | "kreativ"
  | "ijtimoiy"
  | "tadqiqot"
  | "dasturlash"
  | "savdo"
  | "moliya"
  | "mijozlar"
  | "tahlil";

export type Jamoa = {
  id: JamoaId;
  nom: string;
  belgi: string;
  rang: string;
  tavsif: string;
  vositalar: string[];
  konikmalar: string[];
  kalitlar: string[];
};

export type AgentHolat = "bosh" | "ishlamoqda" | "tasdiq";

export type Agent = {
  id: string;
  ism: string;
  rol: string;
  jamoa: JamoaId;
  avatar: string;
  konikmalar: string[];
  holat: AgentHolat;
  yangi?: boolean;
};

export type VazifaHolat = "jarayonda" | "tasdiq" | "bajarildi";

export type Vazifa = {
  id: string;
  matn: string;
  jamoa: JamoaId;
  agentId: string;
  holat: VazifaHolat;
  qadamlar: string[];
  bosqich: number;
  natija: string;
  tasdiqKerak: boolean;
  manba: "claude" | "chatgpt" | "lokal";
  vaqt: number;
  tugadi?: number;
  amallar?: string[];
  tasdiqlar?: { id: string; summary: string }[];
};

export type Xabar = {
  id: string;
  kimdan: "men" | "agent";
  agentId: string;
  matn: string;
  vaqt: number;
};

export type Taqsimot = {
  jamoa: JamoaId;
  agentId: string | null;
  yangiAgent: { ism: string; rol: string; avatar: string; konikmalar: string[] } | null;
  qadamlar: string[];
  javob: string;
  natija: string;
  tasdiqKerak: boolean;
  manba: "claude" | "chatgpt" | "lokal";
  // Instagram Cloud bilan bajarilgan amallar va tasdiq navbatidagi harakatlar
  instagram?: { amallar: string[]; tasdiqlar: { id: string; summary: string }[] };
};

export const JAMOALAR: Jamoa[] = [
  {
    id: "kreativ",
    nom: "Kreativ",
    belgi: "🎬",
    rang: "#8b6cff",
    tavsif: "Video montaj, dizayn, sarlavhalar",
    vositalar: ["CapCut", "Canva", "Google Drive", "Telegram"],
    konikmalar: ["qo'pol-montaj", "subtitr-yozish", "reels-o'lcham", "muqova-yasash", "hook-yozish", "brend-tekshiruv"],
    kalitlar: ["video", "montaj", "reels", "rolik", "kesib", "kes", "subtitr", "dizayn", "logo", "muqova", "rasm", "banner", "poster", "capcut", "canva", "klip", "hook", "sarlavha"],
  },
  {
    id: "ijtimoiy",
    nom: "Ijtimoiy tarmoq",
    belgi: "📱",
    rang: "#ff4d8d",
    tavsif: "Instagram, Telegram, postlar jadvali",
    vositalar: ["Instagram", "Telegram", "Kontent kalendari"],
    konikmalar: ["post-rejalash", "story-yozish", "komment-javob", "hashtag-tanlash", "direct-javob"],
    kalitlar: ["instagram", "insta", "post", "story", "storis", "telegram", "kanal", "smm", "obunachi", "komment", "direct", "joyla", "hashtag", "kontent", "tiktok", "youtube"],
  },
  {
    id: "tadqiqot",
    nom: "Tadqiqot",
    belgi: "🔎",
    rang: "#4d8dff",
    tavsif: "Bozor, raqobatchilar, trendlar",
    vositalar: ["Veb-qidiruv", "GitHub", "Google Trends"],
    konikmalar: ["raqobatchi-tahlili", "trend-izlash", "manba-yig'ish", "xulosa-yozish"],
    kalitlar: ["tadqiq", "izla", "qidir", "raqobat", "trend", "bozor", "o'rgan", "solishtir", "manba", "github", "ma'lumot top", "yangilik"],
  },
  {
    id: "dasturlash",
    nom: "Dasturlash",
    belgi: "💻",
    rang: "#2ecf8f",
    tavsif: "Sayt, bot, avtomatlashtirish",
    vositalar: ["GitHub", "Vercel", "Supabase"],
    konikmalar: ["sayt-yasash", "bot-yozish", "xato-tuzatish", "test-yozish", "integratsiya"],
    kalitlar: ["sayt", "telegram bot", "boti", "bot yasa", "bot", "kod", "dastur", "xato", "bug", "api", "server", "landing", "ilova", "app", "avtomat", "integratsiya", "deploy"],
  },
  {
    id: "savdo",
    nom: "Savdo",
    belgi: "🤝",
    rang: "#ffb45a",
    tavsif: "Mijoz topish, takliflar, kelishuvlar",
    vositalar: ["CRM", "Gmail", "Telefon"],
    konikmalar: ["lid-topish", "taklif-yozish", "follow-up", "narx-hisoblash"],
    kalitlar: ["sotuv", "savdo", "mijoz top", "lid", "taklif", "kelishuv", "shartnoma", "narx", "chegirma", "hamkor", "brend bilan", "reklama beruvchi"],
  },
  {
    id: "moliya",
    nom: "Moliya",
    belgi: "💰",
    rang: "#2cc6c6",
    tavsif: "Kirim-chiqim, tovarlar, qarzlar, Telegram to'lovlar",
    vositalar: ["CloudShop", "Telegram bot @claudeadminbot_bot", "Excel"],
    konikmalar: ["kirim-chiqim", "tovar-qoldig'i", "qarzlar", "to'lov-cheklari", "xarajat-hisobi", "hisob-faktura"],
    kalitlar: ["pul", "xarajat", "daromad", "foyda", "byudjet", "hisob-kitob", "hisobla", "faktura", "invoys", "to'lov", "soliq", "maosh", "moliya", "kirim", "chiqim", "kassa", "tovar", "qoldiq", "ombor", "qarz", "chek", "transfer"],
  },
  {
    id: "mijozlar",
    nom: "Mijozlar xizmati",
    belgi: "💬",
    rang: "#ff6b5a",
    tavsif: "Savollarga javob, shikoyatlar",
    vositalar: ["Instagram Direct", "Telegram", "FAQ bazasi"],
    konikmalar: ["savolga-javob", "shikoyat-hal", "faq-yangilash", "buyurtma-holati"],
    kalitlar: ["savol", "shikoyat", "javob ber", "qo'llab", "support", "buyurtma", "yetkazib", "qaytar", "faq", "murojaat"],
  },
  {
    id: "tahlil",
    nom: "Tahlil",
    belgi: "📊",
    rang: "#ff9a3d",
    tavsif: "Statistika, hisobotlar, KPI",
    vositalar: ["Instagram statistika", "Google Sheets", "Looker"],
    konikmalar: ["haftalik-hisobot", "reels-tahlili", "kpi-kuzatuv", "grafik-chizish"],
    kalitlar: ["statistika", "tahlil", "hisobot", "analitika", "ko'rish", "qamrov", "kpi", "grafik", "natija", "o'sish", "ko'rsatkich"],
  },
];

export const jamoaById = (id: string) => JAMOALAR.find((j) => j.id === id) ?? JAMOALAR[0];

export const BOSHLANGICH_AGENTLAR: Agent[] = [
  { id: "a1", ism: "Montajchi", rol: "Video montajchi", jamoa: "kreativ", avatar: "🧑‍🎤", konikmalar: ["qo'pol-montaj", "reels-o'lcham"], holat: "bosh" },
  { id: "a2", ism: "Dizayner", rol: "Grafik dizayner", jamoa: "kreativ", avatar: "👩‍🎨", konikmalar: ["muqova-yasash", "brend-tekshiruv"], holat: "bosh" },
  { id: "a3", ism: "Kopirayter", rol: "Subtitr va sarlavhalar", jamoa: "kreativ", avatar: "✍️", konikmalar: ["subtitr-yozish", "hook-yozish"], holat: "bosh" },
  { id: "a4", ism: "SMM menejer", rol: "Postlar jadvali", jamoa: "ijtimoiy", avatar: "👩‍💼", konikmalar: ["post-rejalash", "hashtag-tanlash"], holat: "bosh" },
  { id: "a5", ism: "Kommentchi", rol: "Kommentlarga javob", jamoa: "ijtimoiy", avatar: "🙋", konikmalar: ["komment-javob", "direct-javob"], holat: "bosh" },
  { id: "a6", ism: "Tadqiqotchi", rol: "Bozor va trendlar", jamoa: "tadqiqot", avatar: "🕵️", konikmalar: ["trend-izlash", "xulosa-yozish"], holat: "bosh" },
  { id: "a7", ism: "Dasturchi", rol: "Sayt va botlar", jamoa: "dasturlash", avatar: "👨‍💻", konikmalar: ["sayt-yasash", "bot-yozish"], holat: "bosh" },
  { id: "a8", ism: "Sotuvchi", rol: "Lid va takliflar", jamoa: "savdo", avatar: "🧑‍💼", konikmalar: ["lid-topish", "taklif-yozish"], holat: "bosh" },
  { id: "a9", ism: "Hisobchi", rol: "Xarajat va daromad", jamoa: "moliya", avatar: "🧮", konikmalar: ["kirim-chiqim", "to'lov-cheklari"], holat: "bosh" },
  { id: "a10", ism: "Operator", rol: "Mijoz savollari", jamoa: "mijozlar", avatar: "🎧", konikmalar: ["savolga-javob", "shikoyat-hal"], holat: "bosh" },
  { id: "a11", ism: "Analitik", rol: "Statistika va hisobot", jamoa: "tahlil", avatar: "📈", konikmalar: ["haftalik-hisobot", "reels-tahlili"], holat: "bosh" },
];

function normal(s: string) {
  return s.toLowerCase().replace(/[‘’ʻʼ`]/g, "'");
}

// Kalit so'zlar bo'yicha eng mos jamoani topadi (Claude ulanmagan bo'lsa).
export function jamoaTop(matn: string): JamoaId | null {
  const t = normal(matn);
  let eng: JamoaId | null = null;
  let ball = 0;
  for (const j of JAMOALAR) {
    const b = j.kalitlar.reduce((s, k) => (t.includes(k) ? s + 10 + k.length : s), 0);
    if (b > ball) {
      ball = b;
      eng = j.id;
    }
  }
  return eng;
}

const YANGI_ROLLAR: Record<JamoaId, { ism: string; rol: string; avatar: string; konikmalar: string[] }> = {
  kreativ: { ism: "Kreativ yordamchi", rol: "Vizual kontent", avatar: "🎨", konikmalar: ["qo'pol-montaj", "muqova-yasash"] },
  ijtimoiy: { ism: "Kontent rejachi", rol: "Kontent kalendari", avatar: "🗓️", konikmalar: ["post-rejalash", "story-yozish"] },
  tadqiqot: { ism: "Izlovchi", rol: "Chuqur tadqiqot", avatar: "🧭", konikmalar: ["manba-yig'ish", "raqobatchi-tahlili"] },
  dasturlash: { ism: "Avtomatchi", rol: "Avtomatlashtirish", avatar: "🤖", konikmalar: ["integratsiya", "test-yozish"] },
  savdo: { ism: "Follow-up agent", rol: "Mijoz bilan aloqa", avatar: "📞", konikmalar: ["follow-up", "narx-hisoblash"] },
  moliya: { ism: "Byudjetchi", rol: "Byudjet rejasi", avatar: "📒", konikmalar: ["byudjet", "soliq-eslatma"] },
  mijozlar: { ism: "FAQ agent", rol: "Tez-tez savollar", avatar: "📚", konikmalar: ["faq-yangilash", "buyurtma-holati"] },
  tahlil: { ism: "KPI kuzatuvchi", rol: "Ko'rsatkichlar", avatar: "🎯", konikmalar: ["kpi-kuzatuv", "grafik-chizish"] },
};

// Claude'siz ishlaydigan oddiy yo'naltirgich. `xona` — foydalanuvchi turgan jamoa (kalit so'z topilmasa ishlatiladi).
export function lokalTaqsimot(matn: string, agentlar: Pick<Agent, "id" | "jamoa" | "konikmalar" | "ism">[], xona?: JamoaId): Taqsimot {
  const j = jamoaTop(matn) ?? xona ?? "tadqiqot";
  const jm = jamoaById(j);
  const t = normal(matn);
  const jamoaAgentlari = agentlar.filter((a) => a.jamoa === j);
  const mos = jamoaAgentlari.find((a) =>
    a.konikmalar.some((k) => k.split("-").some((q) => q.length > 3 && t.includes(q.slice(0, 5)))),
  );
  const avvalYaratilgan = jamoaAgentlari.find((a) => a.ism === YANGI_ROLLAR[j].ism);
  const yangi = !mos && !avvalYaratilgan && jamoaAgentlari.length < 4 ? YANGI_ROLLAR[j] : null;
  const agent = mos ?? avvalYaratilgan ?? (yangi ? null : jamoaAgentlari[0] ?? null);
  const ism = agent?.ism ?? yangi?.ism ?? "Agent";
  return {
    jamoa: j,
    agentId: agent?.id ?? null,
    yangiAgent: agent ? null : yangi ?? YANGI_ROLLAR[j],
    qadamlar: ["Vazifani tushunish", `${jm.vositalar[0]} bilan ishlash`, "Natijani tayyorlash", "Sizga ko'rsatish"],
    javob: `Tushundim! ${jm.nom} jamoasidan ${ism} bu vazifani oldi. Tayyor bo'lgach, tasdiqlash uchun sizga ko'rsataman.`,
    natija: "",
    tasdiqKerak: /joyla|yubor|e'lon|post|sotib|to'la/.test(t),
    manba: "lokal",
  };
}
