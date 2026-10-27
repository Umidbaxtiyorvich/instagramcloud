// Server ishga tushganda: «Ulanishlar»da saqlangan ChatGPT va Claude kalitlarini bazadan xotiraga oladi va har daqiqada yangilaydi
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { openaiKalitYukla } = await import("./lib/ofis-openai");
  const { claudeKalitYukla } = await import("./lib/ofis-claude");
  const yukla = () =>
    Promise.all([
      openaiKalitYukla().catch((e) => console.error("OpenAI kaliti bazadan o'qilmadi:", (e as Error).message)),
      claudeKalitYukla().catch((e) => console.error("Claude kaliti bazadan o'qilmadi:", (e as Error).message)),
    ]);
  await yukla();
  setInterval(() => void yukla(), 60_000).unref();
}
