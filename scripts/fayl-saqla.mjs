// Yonma-yon botlarning data papkasini bazada saqlaydi: Render'ning diski har deploy'da tozalanadi.
// Ishga tushishda bazadagi fayllar papkaga qaytariladi, keyin o'zgargan fayllar har 30 soniyada yoziladi.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const KATTA = 5 * 1024 * 1024; // bundan katta fayllar (eksport, kesh) saqlanmaydi
const prisma = new PrismaClient();
const korilgan = new Map(); // yol → mtime

function fayllar(dir) {
  let r = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) r = r.concat(fayllar(p));
    else if (e.isFile()) r.push(p);
  }
  return r;
}

// kalit: "<nom>/<papka ichidagi yo'l>"
export async function qaytar(nom, dir) {
  mkdirSync(dir, { recursive: true });
  const qatorlar = await prisma.botFayl.findMany({ where: { yol: { startsWith: `${nom}/` } } });
  for (const q of qatorlar) {
    const p = path.join(dir, q.yol.slice(nom.length + 1));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, q.data);
    korilgan.set(p, statSync(p).mtimeMs);
  }
  console.log(`fayl-saqla: ${nom} — ${qatorlar.length} ta fayl qaytarildi`);
}

export async function saqla(nom, dir) {
  for (const p of fayllar(dir)) {
    const s = statSync(p);
    if (s.size > KATTA || korilgan.get(p) === s.mtimeMs) continue;
    const yol = `${nom}/${path.relative(dir, p).split(path.sep).join("/")}`;
    const data = readFileSync(p);
    await prisma.botFayl.upsert({ where: { yol }, create: { yol, data }, update: { data } });
    korilgan.set(p, s.mtimeMs);
  }
}

export function kuzat(nom, dir, ms = 30_000) {
  const bir = () => saqla(nom, dir).catch((e) => console.error(`fayl-saqla: ${nom} —`, e.message));
  setInterval(bir, ms).unref();
  return bir;
}
