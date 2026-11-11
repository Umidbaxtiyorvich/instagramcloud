// Har bir odamchaning tashqi ko'rinishi uning id sidan aniqlanadi (har safar bir xil chiqadi).

const TERI = ["#f6d3b8", "#efc09b", "#d9a07a", "#b97d57", "#8a5a3c"];
const SOCH = ["#2a1c15", "#4b2e1e", "#7a4524", "#b8692f", "#e2b45c", "#1d1d26", "#cfcfd6", "#c2413b"];
const KOYLAK = ["#eceef4", "#3b4a6e", "#5a6b8f", "#2f3b55", "#d8dbe6", "#4a5d7a", "#8e97ad", "#f2f2f2"];
const SHIM = ["#2b2e3f", "#1f2233", "#38405a", "#3d3a36", "#24314d"];

export type Qiyofa = {
  teri: string;
  soch: string;
  koylak: string;
  shim: string;
  turmak: 0 | 1 | 2 | 3; // 0 qisqa, 1 tugun, 2 uzun, 3 kepka
  quloqchin: boolean;
};

export function qiyofa(kalit: string, rang?: string): Qiyofa {
  let h = 2166136261;
  for (const ch of kalit) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const ol = (n: number, k: number) => Math.floor(h / k) % n;
  return {
    teri: TERI[ol(TERI.length, 1)],
    soch: SOCH[ol(SOCH.length, 7)],
    koylak: rang && ol(3, 53) === 0 ? rang : KOYLAK[ol(KOYLAK.length, 131)],
    shim: SHIM[ol(SHIM.length, 977)],
    turmak: ol(4, 3001) as Qiyofa["turmak"],
    quloqchin: ol(4, 12007) === 0,
  };
}
