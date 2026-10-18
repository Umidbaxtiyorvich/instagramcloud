import { createHash } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import OpenAI, { toFile } from "openai";
import type { Qongiroq } from "@prisma/client";
import { prisma } from "./db";
import { randomToken } from "./crypto";
import { openai, openaiModel, openaiVazifa } from "./ofis-openai";
import { IG_VOSITALAR, igAkkaunt, igVosita } from "./ofis-instagram";
import { MOLIYA_VOSITALAR, moliyaHolati, moliyaRuxsat, moliyaVosita, type Davr } from "./ofis-moliya";
import { qaror } from "./miya-fikr";
import { tasdiqHal } from "./actions";
import { botChaqir, botOtkazildi } from "./miya-bot";
import { tgQongiroq, tgTayyor } from "./miya-tg";
import { qongiroqBoshla, raqamTozala, sayt, tw, twilioSozlangan, yozuvniOchir, yozuvniOl } from "./twilio";

// Miya telefonda: muhim gap bo'lsa egasiga qo'ng'iroq qiladi, egasi ham Miya raqamiga qo'ng'iroq qilib
// buyruq beradi. Har bir gap: Twilio yozib oladi → OpenAI matnga o'giradi → Miya o'ylaydi (vositalar bilan)
// → javobni OpenAI ovozga aylantiradi → Twilio o'qiydi.

export type Gap = { kim: "miya" | "men"; matn: string };

const TZ = 5 * 3600_000;
const soat = () => {
  const t = new Date(Date.now() + TZ);
  return { daqiqa: t.getUTCHours() * 60 + t.getUTCMinutes(), matn: t.toISOString().slice(0, 16).replace("T", " ") };
};

export const suhbatOl = (q: Pick<Qongiroq, "suhbat">) => JSON.parse(q.suhbat) as Gap[];

export function xesh(userId: string, qiymat: string) {
  return createHash("sha256").update(`${process.env.AUTH_SECRET || "dev"}:${userId}:${qiymat}`).digest("hex");
}

// Bot havolasidagi kirish kaliti: Telegram ichida saytga kirmasdan qo'ng'iroq ekrani ochilsin
function qongiroqSiri() {
  return new TextEncoder().encode(`${process.env.AUTH_SECRET || "dev-auth-secret-change-me-please"}:qongiroq`);
}

export async function qongiroqToken(userId: string) {
  return new SignJWT({ sub: userId, purpose: "qongiroq" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(qongiroqSiri());
}

export async function tokenEgasi(t: string) {
  try {
    const { payload } = await jwtVerify(t, qongiroqSiri());
    return payload.purpose === "qongiroq" && payload.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

// ---------- havolalar ----------

export const twimlUrl = (q: Pick<Qongiroq, "id" | "kalit">, b: string, n?: number) =>
  `${sayt()}/api/telefon/twiml?q=${q.id}&k=${q.kalit}&b=${b}${n != null ? `&n=${n}` : ""}`;
const holatUrl = () => `${sayt()}/api/telefon/holat`;
const ovozUrl = (q: Pick<Qongiroq, "id" | "kalit">, n: number | string) => `${sayt()}/api/telefon/ovoz?q=${q.id}&k=${q.kalit}&${typeof n === "number" ? `n=${n}` : `s=${n}`}`;

export const STATIK = {
  xayr: "Eshitmadim. Kerak bo'lsam, o'zingiz qo'ng'iroq qiling. Xayr!",
  kut: "Bir soniya, qarab chiqaman.",
  kechikdi: "Kechirasiz, javob kechikyapti. Natijani ofisga yozib qo'yaman. Xayr!",
  pin: "Salom, bu Miya. PIN kodingizni terib, panjara belgisini bosing.",
  pinXato: "PIN noto'g'ri. Xayr.",
  takrorla: "Eshitolmadim, qaytadan ayting.",
} as const;
export type Statik = keyof typeof STATIK;

// OpenAI bo'lsa — tabiiy o'zbekcha ovoz, bo'lmasa Twilio'ning o'z ovozi
export function gapir(q: Pick<Qongiroq, "id" | "kalit">, n: number | Statik, matn: string) {
  return openai() ? tw.play(ovozUrl(q, n)) : tw.say(matn);
}
export const gapirStatik = (q: Pick<Qongiroq, "id" | "kalit">, s: Statik) => gapir(q, s, STATIK[s]);

// ---------- ovoz ↔ matn ----------

const ovozlar = new Map<string, Uint8Array>();

export async function ovozYasa(kalit: string, matn: string) {
  const bor = ovozlar.get(kalit);
  if (bor) return bor;
  const client = openai();
  if (!client) throw new Error("OPENAI_API_KEY yo'q");
  const r = await client.audio.speech.create({
    model: process.env.TELEFON_TTS_MODEL?.trim() || "gpt-4o-mini-tts",
    voice: (process.env.TELEFON_OVOZ?.trim() || "onyx") as "onyx",
    input: matn.slice(0, 1500),
    instructions: "Erkak kishi ovozida, o'zbek tilida, Toshkent talaffuzida gapiring. Samimiy, xotirjam va aniq — telefonda hamkasbga gapirgandek. Tez gapirmang.",
    response_format: "mp3",
  });
  const b = new Uint8Array(await r.arrayBuffer());
  if (ovozlar.size > 60) ovozlar.delete(ovozlar.keys().next().value!);
  ovozlar.set(kalit, b);
  return b;
}

// Ovozni matnga o'giradi. OpenAI so'rovni rad etsa (400 — til yoki model qabul qilinmasa),
// tilsiz, keyin whisper-1 bilan qayta urinadi
async function matngaOgir(ovoz: Uint8Array, nom = "javob.mp3", tur = "audio/mpeg") {
  const client = openai();
  if (!client) throw new Error("OPENAI_API_KEY yo'q");
  const asosiy = process.env.TELEFON_STT_MODEL?.trim() || "gpt-4o-transcribe";
  let xato: unknown;
  for (const [model, til] of [[asosiy, "uz"], [asosiy, undefined], ["whisper-1", "uz"], ["whisper-1", undefined]] as const) {
    try {
      const r = await client.audio.transcriptions.create({
        file: await toFile(ovoz, nom, { type: tur }),
        model,
        // prompt berilmaydi: ovoz noaniq bo'lsa, model prompt so'zlarini «eshitib» qo'yadi
        ...(til ? { language: til } : {}),
      });
      return r.text.trim();
    } catch (e) {
      xato = e;
      console.error(`telefon STT (${model}${til ? `/${til}` : ""}):`, e instanceof Error ? e.message : e);
      if (!(e instanceof OpenAI.BadRequestError)) break;
    }
  }
  throw xato;
}

// ---------- suhbat ----------

async function gapQosh(id: string, gaplar: Gap[], qolgan: Partial<Pick<Qongiroq, "kutish" | "tugat" | "holat" | "fikrId">> = {}) {
  const q = await prisma.qongiroq.findUniqueOrThrow({ where: { id } });
  const s = [...suhbatOl(q), ...gaplar];
  return prisma.qongiroq.update({ where: { id }, data: { suhbat: JSON.stringify(s), ...qolgan } });
}

// Miya'ning so'nggi gapini ovozga oldindan aylantiradi — Twilio so'raganda kutib qolmasin
async function oldindanOvoz(q: Qongiroq) {
  const s = suhbatOl(q);
  const n = s.length - 1;
  if (openai() && n >= 0 && s[n].kim === "miya") await ovozYasa(`${q.id}:${n}`, s[n].matn).catch(() => null);
}

const TELEFON_TIZIM = `Siz «Miya»siz — egasining biznesini (Instagram, CloudShop do'koni) kuzatib boradigan yordamchi. Hozir egasi bilan TELEFONDA gaplashyapsiz.
- Javob og'zaki: 1-3 qisqa jumla (60 so'zgacha), o'zbek tilida (lotin). Markdown, emoji, ro'yxat, havola yo'q. Raqamlarni yaxlitlab ayting.
- Savolga avval vositalar bilan haqiqiy ma'lumotni oling, o'ylab topmang.
- Instagram'ga yozadigan ishlar (javob, Direct, qoida, joylash) darhol bajarilmaydi — tasdiq navbatiga tushadi. Shunda egasiga aniq nima
  qilinishini (matnini ham) qisqa aytib, «bajaraymi?» deb so'rang. Egasi aniq «ha» desa — tasdiq_qaror(ha=true) chaqiring.
  «Navbatdagi tasdiqlar» ro'yxatidagi ishlarni ham shunday hal qiling.
- Miya takliflari bo'yicha egasi rozi bo'lsa yoki rad etsa — taklif_qaror chaqiring (rad etsa, sababini izohga yozing).
- Tushunmasangiz, qisqa qayta so'rang. Egasi «bo'ldi», «rahmat», «xayr» desa yoki gap tugasa — xayrlashing va tugat=true.
- Yozilmagan ishni «qildim» demang.`;

const TELEFON_VOSITALAR = [
  {
    name: "tasdiq_qaror",
    description: "Navbatdagi tasdiqni hal qiladi: ha=true — bajaradi (Instagram'ga yozadi), ha=false — rad etadi. Faqat egasi aniq aytganda.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, ha: { type: "boolean" } },
      required: ["id", "ha"],
      additionalProperties: false,
    },
  },
  {
    name: "taklif_qaror",
    description: "Miya taklifiga egasining javobi: ha=true — bajaradi, ha=false — rad etadi (izoh — sababi).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, ha: { type: "boolean" }, izoh: { type: "string" } },
      required: ["id", "ha"],
      additionalProperties: false,
    },
  },
];

const JAVOB_SXEMA = {
  type: "object",
  additionalProperties: false,
  required: ["javob", "tugat"],
  properties: { javob: { type: "string" }, tugat: { type: "boolean" } },
};

async function javobBer(q: Qongiroq): Promise<{ javob: string; tugat: boolean }> {
  const client = openai();
  if (!client) throw new Error("OPENAI_API_KEY yo'q");
  const userId = q.userId;
  const [user, akk, xotira, fikrlar, tasdiqlar, xabarlar, qongiroqlar] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    igAkkaunt(userId),
    prisma.xotira.findUnique({ where: { userId } }),
    prisma.miyaFikr.findMany({ where: { userId, holat: "kutmoqda" }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.approval.findMany({ where: { userId, status: "pending" }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.miyaXabar.findMany({ where: { userId, daraja: { in: ["ogoh", "xavf"] } }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.qongiroq.findMany({
      where: { userId, yonalish: "chiquvchi", id: { not: q.id }, createdAt: { gte: new Date(Date.now() - 48 * 3600_000) } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);
  const mh = moliyaHolati();
  const moliyaBor = moliyaRuxsat(user?.email) && (mh.cloudshop || mh.bot);
  const kontekst = [
    `Hozir Toshkentda: ${soat().matn}.`,
    q.yonalish === "chiquvchi" ? `Siz egasiga o'zingiz qo'ng'iroq qildingiz. Sabab: ${q.sabab}` : "Egasi o'zi sizga qo'ng'iroq qildi.",
    xotira ? `Egasi haqida:\n${xotira.profil.slice(0, 1500)}` : "",
    akk ? `Instagram: @${akk.username}, ${akk.followersCount} obunachi.` : "Instagram ulanmagan.",
    fikrlar.length ? `Javob kutayotgan Miya takliflari:\n${fikrlar.map((f) => `- id=${f.id} | ${f.sarlavha} — ${f.fikr.slice(0, 200)}`).join("\n")}` : "",
    tasdiqlar.length ? `Navbatdagi tasdiqlar:\n${tasdiqlar.map((t) => `- id=${t.id} | ${t.summary}`).join("\n")}` : "Navbatda tasdiq yo'q.",
    xabarlar.length ? `Miya oxirgi topgan muammolar:\n${xabarlar.map((x) => `- ${x.matn.split("\n").slice(0, 3).join(" ").slice(0, 300)}`).join("\n")}` : "",
    qongiroqlar.length
      ? `So'nggi 2 kunda siz egasiga qilgan qo'ng'iroqlar («nega qo'ng'iroq qilding?» deb so'rasa — shundan ayting):\n${qongiroqlar
          .map((c) => `- ${new Date(c.createdAt.getTime() + TZ).toISOString().slice(5, 16).replace("T", " ")} (${c.holat === "javobsiz" ? "javob bermadi" : c.holat}): ${c.sabab}`)
          .join("\n")}`
      : "",
    `Suhbat:\n${suhbatOl(q).map((g) => `${g.kim === "miya" ? "Miya" : "Egasi"}: ${g.matn}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const bajar = async (nom: string, k: Record<string, unknown>) => {
    if (nom === "tasdiq_qaror") {
      const r = await tasdiqHal(userId, String(k.id ?? ""), k.ha === true);
      return r.status === "executed" ? `Bajarildi: ${JSON.stringify(r.result).slice(0, 400)}` : "Rad etildi";
    }
    if (nom === "taklif_qaror") {
      const f = await qaror(userId, String(k.id ?? ""), k.ha === true, k.izoh ? String(k.izoh) : undefined);
      return `Taklif: ${f.holat}${f.natija ? ` — ${f.natija}` : ""}`;
    }
    if (nom.startsWith("moliya_")) {
      if (!moliyaBor) throw new Error("Moliya ma'lumotiga ruxsat yo'q");
      return moliyaVosita(nom, { davr: k.davr as Davr | undefined, qidiruv: k.qidiruv as string | undefined });
    }
    if (nom.startsWith("instagram_") || nom === "list_instagram_accounts") return igVosita(userId, nom, k);
    throw new Error(`Noma'lum vosita: ${nom}`);
  };

  const j = (await openaiVazifa({
    client,
    tizim: TELEFON_TIZIM,
    kontekst,
    vositalar: [...TELEFON_VOSITALAR, ...(akk ? IG_VOSITALAR : []), ...(moliyaBor ? MOLIYA_VOSITALAR : [])],
    mcp: null,
    sxema: JAVOB_SXEMA,
    bajar,
    amallar: [],
    model: process.env.TELEFON_MODEL?.trim() || undefined,
  })) as { javob?: string; tugat?: boolean };
  return { javob: String(j.javob || "Tushunmadim, qaytadan ayting.").slice(0, 1200), tugat: j.tugat === true };
}

// Egasining gapini (ovoz) matnga o'giradi, Miya javob beradi; ikkalasi suhbatga yoziladi
export async function gapniIshla(id: string, ovoz: Uint8Array, nom?: string, tur?: string) {
  const matn = await matngaOgir(ovoz, nom, tur);
  if (!matn) return gapQosh(id, [{ kim: "miya", matn: STATIK.takrorla }]);
  return matnniIshla(id, matn);
}

export async function matnniIshla(id: string, matn: string) {
  const q = await gapQosh(id, [{ kim: "men", matn }]);
  const j = await javobBer(q);
  return gapQosh(id, [{ kim: "miya", matn: j.javob }], { tugat: j.tugat });
}

export const xatoGap = (e: unknown): Gap => ({
  kim: "miya",
  matn: `Kechirasiz, xatolik bo'ldi: ${e instanceof Error ? e.message.slice(0, 120) : "noma'lum"}. Yana bir bor ayting.`,
});

// Twilio yozib olgan gapni eshitib, javob tayyorlaydi (javob qaytgandan keyin, fonda ishlaydi)
export async function tingla(id: string, yozuvUrl: string, yozuvSid: string) {
  try {
    const mp3 = await yozuvniOl(yozuvUrl);
    await yozuvniOchir(yozuvSid);
    await oldindanOvoz(await gapniIshla(id, mp3));
  } catch (e) {
    console.error("telefon:", e);
    await oldindanOvoz(await gapQosh(id, [xatoGap(e)]));
  } finally {
    await prisma.qongiroq.update({ where: { id }, data: { kutish: false } });
  }
}

// Tugma bilan javob (1 — ha, 2 — yo'q) — taklif bo'yicha
export async function tugmaJavob(q: Qongiroq, raqam: string) {
  if (!q.fikrId) throw new Error("Bu qo'ng'iroqda javob kutayotgan taklif yo'q");
  let matn: string;
  try {
    if (raqam === "1") {
      const f = await qaror(q.userId, q.fikrId, true);
      matn = f.holat === "bajarildi" ? "Bajardim. Yana biror gap bormi?" : "Bo'lmadi.";
    } else {
      await qaror(q.userId, q.fikrId, false, "telefonda rad etdi");
      matn = "Xo'p, qilmayman. Yana biror gap bormi?";
    }
  } catch (e) {
    matn = `Bo'lmadi: ${e instanceof Error ? e.message : "xato"}. Yana biror gap bormi?`;
  }
  const yangi = await gapQosh(q.id, [{ kim: "men", matn: raqam === "1" ? "(1 — ha)" : "(2 — yo'q)" }, { kim: "miya", matn }], { fikrId: null });
  await oldindanOvoz(yangi);
  return yangi;
}

// ---------- qo'ng'iroq qilish ----------

// Telefon (Twilio) sozlanmagan bo'lsa — bepul yo'l: Telegram'ga «Miya qo'ng'iroq qilyapti» havolasi,
// egasi bosib, telefon brauzerida ovoz bilan gaplashadi
export const webMi = () => !twilioSozlangan();

export async function salomMatni(userId: string) {
  const [muhim, kutayotgan] = await Promise.all([
    prisma.miyaXabar.count({ where: { userId, oqildi: false, daraja: { in: ["ogoh", "xavf"] } } }),
    prisma.miyaFikr.count({ where: { userId, holat: "kutmoqda" } }),
  ]);
  return (
    "Salom! Miya eshitadi." +
    (muhim ? ` ${muhim} ta o'qilmagan ogohlantirish bor.` : "") +
    (kutayotgan ? ` ${kutayotgan} ta taklifim javobingizni kutyapti.` : "") +
    " Nima qilay?"
  );
}

async function webQongiroq(userId: string, sabab: string, fikrId?: string) {
  if (!openai()) throw new Error("OPENAI_API_KEY yo'q — Miya ovoz bilan gaplasha olmaydi");
  const ochilish = `Assalomu alaykum, men Miya. ${sabab} ${fikrId ? "Rozi bo'lsangiz «ha» deng yoki pastdagi tugmani bosing." : "Biror buyruq berasizmi?"}`;
  const q = await prisma.qongiroq.create({
    data: {
      userId,
      yonalish: "chiquvchi",
      kanal: "web",
      kalit: randomToken(16),
      sabab: sabab.slice(0, 2000),
      fikrId: fikrId ?? null,
      suhbat: JSON.stringify([{ kim: "miya", matn: ochilish }]),
    },
  });
  // Miya boti ulangan bo'lsa — darhol o'sha yerga; aks holda xabar eski Telegram botiga tick bilan boradi.
  // O'zi qo'ng'iroqqa sabab bo'lmasin — qongiroq: true
  const botda = await botChaqir(userId, q).catch((e) => (console.error("miya bot:", e), false));
  await prisma.miyaXabar.create({
    data: {
      userId,
      tur: "qongiroq",
      daraja: "xavf",
      qongiroq: true,
      telegram: botda,
      kalit: `qongiroq:${q.id}`,
      matn: `📞 Miya sizga qo'ng'iroq qilyapti: ${sabab.slice(0, 300)}\nJavob berish: ${sayt()}/qongiroq?q=${q.id}`,
    },
  });
  await prisma.miyaSozlama.update({ where: { userId }, data: { oxirgiQongiroq: new Date() } });
  await oldindanOvoz(q);
  return q;
}

// Haqiqiy Telegram qo'ng'irog'i: Miya akkauntidan egasining Telegram'iga (jiringlaydi).
// yonalish: chiquvchi — Miya o'zi chaqiryapti; kiruvchi — egasi botdan «menga qo'ng'iroq qil» dedi
export async function tgChaqir(userId: string, matn: string, o: { sabab?: string; yonalish?: "chiquvchi" | "kiruvchi"; fikrId?: string } = {}) {
  const chat = await tgTayyor(userId);
  if (!chat) return null;
  const q = await prisma.qongiroq.create({
    data: {
      userId,
      yonalish: o.yonalish ?? "chiquvchi",
      kanal: "tgcall",
      kalit: randomToken(16),
      sabab: (o.sabab ?? "").slice(0, 2000),
      fikrId: o.fikrId ?? null,
      suhbat: JSON.stringify([{ kim: "miya", matn }]),
    },
  });
  try {
    await tgQongiroq(chat, q.id, matn);
  } catch (e) {
    console.error("miya-tg:", e);
    await prisma.qongiroq.update({ where: { id: q.id }, data: { holat: "xato", tugadi: new Date(), sabab: `${q.sabab}\n⚠️ ${e instanceof Error ? e.message : "xato"}`.trim() } });
    return null;
  }
  if (q.yonalish === "chiquvchi") await prisma.miyaSozlama.update({ where: { userId }, data: { oxirgiQongiroq: new Date() } });
  return q;
}

export async function miyaQongiroq(userId: string, sabab: string, o: { fikrId?: string; yonalish?: "chiquvchi" | "tasdiq"; telefon?: string } = {}) {
  if (webMi()) {
    if (o.yonalish === "tasdiq") throw new Error("Telefon sozlanmagan (Twilio)");
    // avval haqiqiy Telegram qo'ng'irog'i; bo'lmasa — botga havola
    const tg = await tgChaqir(
      userId,
      `Assalomu alaykum, men Miya. ${sabab} ${o.fikrId ? "Rozi bo'lsangiz, «ha» deng." : "Biror buyruq berasizmi?"}`,
      { sabab, fikrId: o.fikrId },
    );
    if (tg) return tg;
    return webQongiroq(userId, sabab, o.fikrId);
  }
  const s = await prisma.miyaSozlama.findUnique({ where: { userId } });
  const telefon = o.telefon ?? (s?.telefonTasdiq ? s.telefon : null);
  if (!telefon) throw new Error("Telefon raqami tasdiqlanmagan");
  const yonalish = o.yonalish ?? "chiquvchi";
  const ochilish =
    yonalish === "tasdiq"
      ? sabab
      : `Assalomu alaykum, men Miya. ${sabab} ${
          o.fikrId ? "Rozi bo'lsangiz «ha» deng yoki 1 ni bosing, kerak bo'lmasa 2 ni bosing." : openai() ? "Biror buyruq berasizmi?" : ""
        }`.trim();
  const q = await prisma.qongiroq.create({
    data: { userId, yonalish, kalit: randomToken(16), sabab: sabab.slice(0, 2000), fikrId: o.fikrId ?? null, suhbat: JSON.stringify([{ kim: "miya", matn: ochilish }]) },
  });
  await oldindanOvoz(q);
  try {
    const sid = await qongiroqBoshla(telefon, twimlUrl(q, yonalish === "tasdiq" ? "tasdiq" : "boshla"), holatUrl());
    await prisma.qongiroq.update({ where: { id: q.id }, data: { sid } });
    if (yonalish === "chiquvchi") await prisma.miyaSozlama.update({ where: { userId }, data: { oxirgiQongiroq: new Date() } });
  } catch (e) {
    await prisma.qongiroq.update({ where: { id: q.id }, data: { holat: "xato", tugadi: new Date(), sabab: `${q.sabab}\n⚠️ ${e instanceof Error ? e.message : "xato"}` } });
    throw e;
  }
  return q;
}

export async function kodYubor(userId: string, raqam: string) {
  const telefon = raqamTozala(raqam);
  if (!telefon) throw new Error("Raqam noto'g'ri — masalan +998901234567");
  const s = await prisma.miyaSozlama.findUnique({ where: { userId } });
  if (s?.telefonKodVaqt && Date.now() - s.telefonKodVaqt.getTime() < 60_000) throw new Error("Bir daqiqadan keyin qayta urinib ko'ring");
  const kod = String(Math.floor(1000 + Math.random() * 9000));
  await prisma.miyaSozlama.update({
    where: { userId },
    data: { telefon, telefonTasdiq: false, telefonKod: xesh(userId, kod), telefonKodVaqt: new Date(), telefonUrinish: 0 },
  });
  const r = kod.split("").join(", ");
  await miyaQongiroq(userId, `Salom, bu Miya. Tasdiqlash kodingiz: ${r}. Yana bir bor: ${r}. Xayr!`, { yonalish: "tasdiq", telefon });
  return telefon;
}

export async function kodTekshir(userId: string, kod: string) {
  const s = await prisma.miyaSozlama.findUnique({ where: { userId } });
  if (!s?.telefonKod || !s.telefonKodVaqt || Date.now() - s.telefonKodVaqt.getTime() > 10 * 60_000) throw new Error("Kod eskirgan — qayta qo'ng'iroq so'rang");
  if (s.telefonUrinish >= 5) throw new Error("Urinishlar ko'p bo'ldi — qayta qo'ng'iroq so'rang");
  if (xesh(userId, kod.trim()) !== s.telefonKod) {
    await prisma.miyaSozlama.update({ where: { userId }, data: { telefonUrinish: { increment: 1 } } });
    throw new Error("Kod noto'g'ri");
  }
  // bitta raqam — bitta egasi: kiruvchi qo'ng'iroq kimniki ekanini raqamdan bilamiz
  await prisma.miyaSozlama.updateMany({ where: { telefon: s.telefon, userId: { not: userId } }, data: { telefon: null, telefonTasdiq: false, telefonPin: null } });
  await prisma.miyaSozlama.update({ where: { userId }, data: { telefonTasdiq: true, telefonKod: null, telefonUrinish: 0 } });
}

// Bir nechta yozma xabarni telefonda aytiladigan 2-4 jumlaga aylantiradi
async function ogzaki(matnlar: string[], taklif: string | null) {
  const xom = [...matnlar, ...(taklif ? [`Taklif: ${taklif}`] : [])].join("\n\n");
  const client = openai();
  if (client) {
    try {
      const r = await client.responses.create({
        model: openaiModel(),
        instructions:
          "Quyidagi yozma ogohlantirishlarni telefonda aytish uchun 2-4 qisqa og'zaki jumlaga aylantiring (o'zbek tili, lotin). " +
          "Emoji, ro'yxat, havola yo'q; eng muhim raqam va nomlarni qoldiring. Salomlashmang. Taklif bo'lsa, oxirida uni bir jumlada ayting.",
        input: xom.slice(0, 6000),
      });
      if (r.output_text.trim()) return r.output_text.trim().slice(0, 900);
    } catch (e) {
      console.error("telefon ogzaki:", e instanceof Error ? e.message : e);
    }
  }
  return matnlar
    .map((m) => m.split("\n")[0])
    .join(" ")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

// Miya tick'idan: tasdiqlangan raqamli egalarga muhim yangi gap bo'lsa — qo'ng'iroq (kunduzi, 30 daqiqada ko'pi bilan bir marta)
export async function qongiroqlar() {
  // javob berilmagan havolali qo'ng'iroqlar — botda «javob bermadingiz» bo'lib qoladi
  const otkazilgan = await prisma.qongiroq.findMany({ where: { kanal: { in: ["web", "tgcall"] }, holat: "boshlandi", createdAt: { lt: new Date(Date.now() - 30 * 60_000) } } });
  for (const q of otkazilgan) {
    const r = await prisma.qongiroq.updateMany({ where: { id: q.id, holat: "boshlandi" }, data: { holat: "javobsiz", tugadi: new Date() } });
    if (r.count && q.yonalish === "chiquvchi") await botOtkazildi(q);
  }
  const web = webMi();
  if (web && !openai()) return;
  const { daqiqa } = soat();
  if (daqiqa < 8 * 60 || daqiqa >= 22 * 60) return;
  const egalar = await prisma.miyaSozlama.findMany({
    where: { qongiroqRejim: { not: "off" }, ...(web ? {} : { telefonTasdiq: true, telefon: { not: null } }) },
  });
  for (const s of egalar) {
    try {
      if (s.oxirgiQongiroq && Date.now() - s.oxirgiQongiroq.getTime() < 30 * 60_000) continue;
      const faol = await prisma.qongiroq.count({ where: { userId: s.userId, yonalish: { not: "tasdiq" }, tugadi: null, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } } });
      if (faol) continue;
      const muhim = s.qongiroqRejim === "muhim";
      const xabarlar = await prisma.miyaXabar.findMany({
        where: {
          userId: s.userId,
          qongiroq: false,
          createdAt: { gte: new Date(Date.now() - 3 * 3600_000) },
          OR: [{ daraja: "xavf" }, ...(muhim ? [{ tur: "fikr", daraja: "ogoh" }] : [])],
          NOT: { matn: { startsWith: "🎬 Reels tayyorlanmoqda" } },
        },
        orderBy: { createdAt: "asc" },
        take: 5,
      });
      if (!xabarlar.length) continue;
      await prisma.miyaXabar.updateMany({ where: { id: { in: xabarlar.map((x) => x.id) } }, data: { qongiroq: true } });
      const fikr = muhim
        ? await prisma.miyaFikr.findFirst({
            where: { userId: s.userId, holat: "kutmoqda", amal: { not: "eslatma" }, createdAt: { gte: new Date(Date.now() - 3 * 3600_000) } },
            orderBy: { createdAt: "desc" },
          })
        : null;
      const sabab = await ogzaki(
        xabarlar.filter((x) => !fikr || !x.kalit.endsWith(fikr.id)).map((x) => x.matn),
        fikr ? `${fikr.sarlavha}. ${fikr.fikr}` : null,
      );
      await miyaQongiroq(s.userId, sabab, { fikrId: fikr?.id });
    } catch (e) {
      console.error("telefon qo'ng'iroq:", e);
    }
  }
}
