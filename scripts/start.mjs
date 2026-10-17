// Saytni ishga tushiradi; TG_API_ID bo'lsa yonida Miya'ning Telegram qo'ng'iroq dasturini (miya-tg) ham.
// miya-tg tushib qolsa — qayta ishga tushadi; sayt unga bog'liq emas.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const python = ".tgv/bin/python";
const tg = process.env.TG_API_ID && process.env.TG_API_HASH;

function miyaTg(urinish = 0) {
  const p = spawn(python, ["-u", "miya-tg/miya_tg.py"], { stdio: "inherit", env: process.env });
  const boshlandi = Date.now();
  p.on("exit", (kod) => {
    // tez-tez yiqilsa — kutish uzayadi (5 daqiqagacha)
    const keyingi = Date.now() - boshlandi > 120_000 ? 0 : urinish + 1;
    const kut = Math.min(300_000, 5_000 * 2 ** keyingi);
    console.error(`miya-tg: to'xtadi (${kod}), ${Math.round(kut / 1000)} soniyadan keyin qayta`);
    setTimeout(() => miyaTg(keyingi), kut);
  });
}

if (tg && existsSync(python)) miyaTg();
else if (tg) console.error("miya-tg: .tgv o'rnatilmagan — build loglarida «miya-tg» ni ko'ring");

const next = spawn("npx", ["next", "start"], { stdio: "inherit", env: process.env });
next.on("exit", (kod) => process.exit(kod ?? 1));
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => next.kill(s));
