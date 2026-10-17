// Build oxirida: TG_API_ID bo'lsa, miya-tg uchun Python muhitini (.tgv) o'rnatadi.
// Hech qachon build'ni yiqitmaydi — o'rnatilmasa, sayt baribir ishlaydi.
import { execSync } from "node:child_process";

if (!process.env.TG_API_ID) process.exit(0);
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
try {
  run("python3 --version");
  try {
    run("python3 -m venv .tgv");
  } catch {
    // ensurepip yo'q bo'lsa — pip'siz venv va get-pip
    run("python3 -m venv --without-pip .tgv");
    run("curl -sSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py && .tgv/bin/python /tmp/get-pip.py -q");
  }
  run(".tgv/bin/python -m pip install -q --no-cache-dir -r miya-tg/requirements.txt");
  console.log("miya-tg: o'rnatildi");
} catch (e) {
  console.error("miya-tg: o'rnatilmadi —", e instanceof Error ? e.message : e);
}
