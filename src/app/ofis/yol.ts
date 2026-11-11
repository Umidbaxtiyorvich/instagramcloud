import type { JamoaId } from "@/lib/ofis";

// Ofis xaritasi va agentning Miya'ga borib-kelish yo'li. three.js'siz — sahifa ham ishlatadi.

export const XONA = 8;
export const ORALIQ = 2;
export const QADAM = XONA + ORALIQ;

const JOYLAR: Record<JamoaId, [number, number]> = {
  tadqiqot: [0, 0],
  ijtimoiy: [1, 0],
  dasturlash: [2, 0],
  savdo: [0, 1],
  kreativ: [2, 1],
  moliya: [0, 2],
  mijozlar: [1, 2],
  tahlil: [2, 2],
};

// stol joylari (xona markaziga nisbatan): [x, z] — odam shu nuqtada o'tiradi, stol undan -z da
export const ORINLAR: [number, number][] = [
  [-1.9, -1.4],
  [1.6, -1.4],
  [-1.9, 1.0],
  [1.6, 1.0],
  [-1.9, 3.3],
  [1.6, 3.3],
];

export function xonaMarkazi(id: JamoaId): [number, number] {
  const [c, r] = JOYLAR[id];
  return [(c - 1) * QADAM, (r - 1) * QADAM];
}

// Xonalarning faqat old (+z) va o'ng (+x) tomoni ochiq; xonalar orasidagi yo'laklar x=±5, z=±5.
// Agent ochiq tomondan chiqadi, yo'lak bo'ylab markaziy maydonga yetadi va Miya oldida to'xtaydi.
const YOLAK = XONA / 2 + ORALIQ / 2; // 5
const CHIQISH = XONA / 2 + 0.35;
const MIYA_R = 3.7;

export type Nuqta = [number, number];

// Dunyo koordinatalarida: o'rindiqdan Miya oldigacha
export function miyagaYol(jamoa: JamoaId, orin: number): Nuqta[] {
  const [cx, cz] = xonaMarkazi(jamoa);
  const [ox, oz] = ORINLAR[orin] ?? ORINLAR[0];
  const s: Nuqta = [cx + ox, cz + oz];
  const n: Nuqta[] = [s];
  if (cx < 0) {
    // chap ustun: o'ngga chiqib x=-5 yo'lagidan markazga
    n.push([cx + CHIQISH, s[1]], [cx + YOLAK, s[1]], [cx + YOLAK, Math.max(-4, Math.min(4, s[1]))]);
  } else if (cx === 0 && cz < 0) {
    // tepa o'rta: old tomon markazga qaragan
    n.push([s[0], cz + CHIQISH], [s[0], cz + YOLAK]);
  } else if (cx === 0) {
    // past o'rta: o'ngga chiqib x=5 yo'lagidan
    n.push([cx + CHIQISH, s[1]], [cx + YOLAK, s[1]], [cx + YOLAK, 4]);
  } else if (cz <= 0) {
    // o'ng ustun (tepa, o'rta): old tomondan z yo'lagiga, keyin chapga
    n.push([s[0], cz + CHIQISH], [s[0], cz + YOLAK], [4, cz + YOLAK]);
  } else {
    // o'ng past: ikkala ochiq tomon ham tashqariga — aylanib x=5 yo'lagidan
    n.push([s[0], cz + CHIQISH], [s[0], cz + YOLAK], [YOLAK, cz + YOLAK], [YOLAK, 4]);
  }
  const [lx, lz] = n[n.length - 1];
  const d = Math.hypot(lx, lz) || 1;
  n.push([(lx / d) * MIYA_R, (lz / d) * MIYA_R]);
  return n;
}

export function yolUzunligi(n: Nuqta[]) {
  let s = 0;
  for (let i = 1; i < n.length; i++) s += Math.hypot(n[i][0] - n[i - 1][0], n[i][1] - n[i - 1][1]);
  return s;
}

// Yo'l bo'ylab masofa bo'yicha nuqta va yo'nalish
export function yolNuqtasi(n: Nuqta[], masofa: number): { x: number; z: number; dx: number; dz: number } {
  let qoldi = Math.max(0, masofa);
  for (let i = 1; i < n.length; i++) {
    const [ax, az] = n[i - 1];
    const [bx, bz] = n[i];
    const l = Math.hypot(bx - ax, bz - az);
    if (qoldi <= l || i === n.length - 1) {
      const k = l ? Math.min(1, qoldi / l) : 1;
      return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, dx: bx - ax, dz: bz - az };
    }
    qoldi -= l;
  }
  const [x, z] = n[n.length - 1];
  return { x, z, dx: 0, dz: 1 };
}

// Chaqiruv bosqichlari (soniya): turish → Miya'ga borish → xatni olish → qaytish → o'tirish
export const TEZLIK = 3.4; // m/s — o'yinchoq ofis, odamdan tezroq
export const TURISH = 0.5;
export const OLISH = 1.4;
export const OTIRISH = 0.6;

export function chaqiruvMuddati(jamoa: JamoaId, orin: number) {
  const yol = yolUzunligi(miyagaYol(jamoa, orin)) / TEZLIK;
  return TURISH + yol + OLISH + yol + OTIRISH;
}
