import { telegramYuborildi, tick } from "./miya";
import { qongiroqlar } from "./miya-telefon";
import { botXabar } from "./miya-bot";

// Miya'ning tick'i (YesPOS, CloudShop, Instagram tekshiruvlari, hisobot) — server o'zi har 10 daqiqada
// (instrumentation.ts), /api/miya/tick esa tashqi chaqiruvlar uchun. Bir vaqtda bittasi: qulf globalThis'da,
// chunki instrumentation va route'lar alohida modul nusxasida bo'lishi mumkin.
const g = globalThis as { __miyaTick?: boolean };

export async function miyaTickYubor(yuborish: "bot" | "qaytar" = "bot") {
  if (g.__miyaTick) return { band: true as const };
  g.__miyaTick = true;
  try {
    // muhim gap bo'lsa — egasiga qo'ng'iroq (havolali qo'ng'iroq xabari shu tick'da Telegram'ga ketadi)
    await qongiroqlar().catch((e) => console.error("miya telefon:", e));
    const xabarlar = await tick();
    if (yuborish === "qaytar") {
      await telegramYuborildi(xabarlar.map((x) => x.id));
      return { xabarlar: [...new Set(xabarlar.map((x) => x.matn))] };
    }
    const yetdi: string[] = [];
    for (const x of xabarlar) if (await botXabar(x.userId, x.matn)) yetdi.push(x.id);
    await telegramYuborildi(yetdi);
    return { yuborildi: yetdi.length, kutmoqda: xabarlar.length - yetdi.length };
  } finally {
    g.__miyaTick = false;
  }
}
