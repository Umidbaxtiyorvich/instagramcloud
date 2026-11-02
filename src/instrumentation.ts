// Server ishga tushganda: «Ulanishlar»da saqlangan ChatGPT va Claude kalitlarini bazadan xotiraga oladi va har daqiqada yangilaydi
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { openaiKalitYukla } = await import("./lib/ofis-openai");
  const { claudeKalitYukla } = await import("./lib/ofis-claude");
  const { aqlYukla } = await import("./lib/ofis-aql");
  const { yesposUlanishYangila } = await import("./lib/mcp-ulanish");
  const yukla = () =>
    Promise.all([
      yesposUlanishYangila().catch((e) => console.error("YesPOS ulanishi yangilanmadi:", (e as Error).message)),
      aqlYukla().catch((e) => console.error("AI tanlovi bazadan o'qilmadi:", (e as Error).message)),
      openaiKalitYukla().catch((e) => console.error("OpenAI kaliti bazadan o'qilmadi:", (e as Error).message)),
      claudeKalitYukla().catch((e) => console.error("Claude kaliti bazadan o'qilmadi:", (e as Error).message)),
    ]);
  await yukla();
  setInterval(() => void yukla(), 60_000).unref();

  // Miya tekshiruvlari serverning o'zida: tashqi uyg'otuvchilarga (GitHub jadvali soatlab kechikadi,
  // Railway sinovi tugaydi) bog'liq emas. Birinchisi ishga tushgandan 2 daqiqa keyin.
  const { miyaTickYubor } = await import("./lib/miya-tick");
  const tickla = () => miyaTickYubor().catch((e) => console.error("miya tick (ichki):", (e as Error).message));
  setTimeout(() => void tickla(), 120_000).unref();
  setInterval(() => void tickla(), 10 * 60_000).unref();
}
