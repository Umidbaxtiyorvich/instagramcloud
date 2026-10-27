// Saytni ishga tushiradi; yonida:
// - TG_API_ID bo'lsa — Miya'ning Telegram qo'ng'iroq dasturi (miya-tg);
// - YP_BOT_TOKEN bo'lsa — YesPOS boti va uning web sayti (/yespos), ma'lumotlari bazada saqlanadi.
// Yonidagi dastur tushib qolsa — qayta ishga tushadi; sayt ularga bog'liq emas.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { kuzat, qaytar } from "./fayl-saqla.mjs";

const YESPOS_PORT = "8791";

function yonida(nom, python, args, env, urinish = 0) {
  const p = spawn(python, ["-u", ...args], { stdio: "inherit", env });
  const boshlandi = Date.now();
  p.on("exit", (kod) => {
    // tez-tez yiqilsa — kutish uzayadi (5 daqiqagacha)
    const keyingi = Date.now() - boshlandi > 120_000 ? 0 : urinish + 1;
    const kut = Math.min(300_000, 5_000 * 2 ** keyingi);
    console.error(`${nom}: to'xtadi (${kod}), ${Math.round(kut / 1000)} soniyadan keyin qayta`);
    setTimeout(() => yonida(nom, python, args, env, keyingi), kut);
  });
}

if (process.env.TG_API_ID && process.env.TG_API_HASH) {
  if (existsSync(".tgv/bin/python")) yonida("miya-tg", ".tgv/bin/python", ["miya-tg/miya_tg.py"], process.env);
  else console.error("miya-tg: .tgv o'rnatilmagan — build loglarida «miya-tg» ni ko'ring");
}

// .env matni (Railway → Variables → Raw Editor'dan bir martada nusxalanadi) → { KALIT: qiymat }
function envMatn(matn = "") {
  const r = {};
  for (const q of matn.split(/\r?\n/)) {
    const m = q.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || m[1].startsWith("RAILWAY_") || m[1] === "PORT") continue;
    r[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return r;
}

// YesPOS boti: sozlamalari YESPOS_ENV da (.env matni) yoki YP_ prefiksli (YP_BOT_TOKEN → BOT_TOKEN)
let ypSaqla = null;
if (process.env.YESPOS_ENV || process.env.YP_BOT_TOKEN) {
  if (existsSync(".ypv/bin/python")) {
    const env = { RENDER: process.env.RENDER, PATH: process.env.PATH, TZ: "Asia/Tashkent", PYTHONUNBUFFERED: "1" };
    Object.assign(env, envMatn(process.env.YESPOS_ENV));
    for (const [k, v] of Object.entries(process.env)) if (k.startsWith("YP_")) env[k.slice(3)] = v;
    const sayt = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
    Object.assign(env, { PORT: YESPOS_PORT, WEB_PREFIX: "/yespos", PUBLIC_URL: `${sayt}/yespos` });
    try {
      await qaytar("yespos", "yespos-bot/data");
      ypSaqla = kuzat("yespos", "yespos-bot/data");
      yonida("yespos-bot", ".ypv/bin/python", ["yespos-bot/bot.py"], env);
    } catch (e) {
      console.error("yespos-bot: ma'lumotlar bazadan olinmadi, bot ishga tushmadi —", e.message);
    }
  } else console.error("yespos-bot: .ypv o'rnatilmagan — build loglarida «yespos-bot» ni ko'ring");
}

const next = spawn("npx", ["next", "start"], { stdio: "inherit", env: process.env });
next.on("exit", async (kod) => {
  await ypSaqla?.(); // to'xtashdan oldin oxirgi o'zgarishlar bazaga
  process.exit(kod ?? 1);
});
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => next.kill(s));
