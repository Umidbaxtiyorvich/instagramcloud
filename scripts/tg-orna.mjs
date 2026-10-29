// Build oxirida yonidagi dasturlar uchun Python muhitlarini o'rnatadi:
// TG_API_ID bo'lsa — miya-tg (.tgv), YESPOS_ENV yoki YP_BOT_TOKEN bo'lsa — YesPOS boti (.ypv).
// Hech qachon build'ni yiqitmaydi — o'rnatilmasa, sayt baribir ishlaydi.
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

function orna(nom, venv, talablar) {
  try {
    run("python3 --version");
    try {
      run(`python3 -m venv ${venv}`);
    } catch {
      // ensurepip yo'q bo'lsa — pip'siz venv va get-pip
      run(`python3 -m venv --without-pip ${venv}`);
      run(`curl -sSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py && ${venv}/bin/python /tmp/get-pip.py -q`);
    }
    run(`${venv}/bin/python -m pip install -q --no-cache-dir -r ${talablar}`);
    console.log(`${nom}: o'rnatildi`);
  } catch (e) {
    console.error(`${nom}: o'rnatilmadi —`, e instanceof Error ? e.message : e);
  }
}

if (process.env.TG_API_ID) orna("miya-tg", ".tgv", "miya-tg/requirements.txt");
if (process.env.YESPOS_ENV || process.env.YP_BOT_TOKEN) orna("yespos-bot", ".ypv", "yespos-bot/requirements.txt");
