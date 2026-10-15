"use client";

import { useId } from "react";

// Kichik "chibi" odamchalar: katta bosh, soch, ko'ylak. Kamera burchagi qat'iy
// (izometrik), shuning uchun 3/4 ko'rinishda chizilgan SVG to'liq 3D ko'rinadi.

const TERI = ["#f6d3b8", "#efc09b", "#d9a07a", "#b97d57", "#8a5a3c"];
const SOCH = ["#2a1c15", "#4b2e1e", "#7a4524", "#b8692f", "#e2b45c", "#1d1d26", "#cfcfd6", "#c2413b"];
const KOYLAK = ["#eceef4", "#3b4a6e", "#5a6b8f", "#2f3b55", "#d8dbe6", "#4a5d7a", "#8e97ad"];
const SHIM = ["#2b2e3f", "#1f2233", "#38405a", "#3d3a36"];

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

const xavfsiz = (id: string) => id.replace(/[^a-zA-Z0-9]/g, "");

// Soch: boshning orqa va ustini qoplaydi (personaj bizdan teskari, o'ng-yuqoriga qaragan).
function Soch({ q, cx, cy, kepkaRang, nur }: { q: Qiyofa; cx: number; cy: number; kepkaRang: string; nur: string }) {
  const tepa = `M${cx - 16} ${cy + 3} A17 17 0 1 1 ${cx + 15} ${cy - 7} Q${cx + 11} ${cy + 7} ${cx + 4} ${cy + 11} Q${cx - 7} ${cy + 15} ${cx - 15} ${cy + 9} Z`;
  return (
    <g>
      {q.turmak === 2 && (
        <path
          d={`M${cx - 16} ${cy} Q${cx - 20} ${cy + 20} ${cx - 10} ${cy + 24} L${cx + 7} ${cy + 22} Q${cx + 11} ${cy + 14} ${cx + 9} ${cy + 9} Z`}
          fill={q.soch}
        />
      )}
      <path d={tepa} fill={q.soch} />
      <path d={tepa} fill={`url(#${nur})`} opacity={0.5} />
      {q.turmak === 1 && <circle cx={cx - 5} cy={cy - 17} r={6.5} fill={q.soch} />}
      {q.turmak === 3 && (
        <g>
          <path d={`M${cx - 16} ${cy - 2} A16.5 16.5 0 0 1 ${cx + 16} ${cy - 5} Q${cx} ${cy - 1} ${cx - 16} ${cy - 2} Z`} fill={kepkaRang} />
          <ellipse cx={cx + 16} cy={cy - 8} rx={9} ry={3} transform={`rotate(-22 ${cx + 16} ${cy - 8})`} fill={kepkaRang} />
        </g>
      )}
      {q.quloqchin && (
        <g>
          <path d={`M${cx - 13} ${cy - 2} A15 15 0 0 1 ${cx + 14} ${cy - 4}`} stroke="#1b1c26" strokeWidth={3.5} fill="none" />
          <ellipse cx={cx + 14} cy={cy + 2} rx={4} ry={5.5} fill="#1b1c26" />
        </g>
      )}
    </g>
  );
}

// Kresloda o'tirib, monitorga qarab ishlayotgan odam (orqadan 3/4 ko'rinish).
export function OtirganOdam({
  q,
  ishda,
  kepkaRang,
}: {
  q: Qiyofa;
  ishda: boolean;
  kepkaRang: string;
}) {
  const uid = xavfsiz(useId());
  const soya = `${uid}s`;
  const nur = `${uid}n`;
  const tana = "M27 60 Q27 47 40 45 L53 45 Q65 47 65 60 L63 90 L30 90 Z";
  return (
    <svg width={92} height={124} viewBox="0 0 92 124" className={`o_odam ${ishda ? "o_odamIshda" : ""}`}>
      <defs>
        <linearGradient id={soya} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity={0.32} />
          <stop offset="0.55" stopColor="#000" stopOpacity={0.04} />
          <stop offset="1" stopColor="#fff" stopOpacity={0.18} />
        </linearGradient>
        <radialGradient id={nur} cx="0.7" cy="0.25" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity={0.45} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.25} />
        </radialGradient>
      </defs>

      {/* soya va kreslo oyog'i */}
      <ellipse cx={46} cy={117} rx={24} ry={5.5} fill="rgba(0,0,0,0.35)" />
      <g stroke="#15161f" strokeWidth={3} strokeLinecap="round">
        <line x1={46} y1={110} x2={28} y2={115} />
        <line x1={46} y1={110} x2={64} y2={115} />
        <line x1={46} y1={110} x2={37} y2={119} />
        <line x1={46} y1={110} x2={56} y2={119} />
      </g>
      <rect x={44} y={94} width={4} height={16} fill="#2a2b38" />

      {/* oyoq (stol tagiga cho'zilgan) */}
      <path d="M52 90 L67 84 L69 104" stroke={q.shim} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <ellipse cx={71} cy={106} rx={6.5} ry={3.2} fill="#16171f" />

      {/* o'rindiq */}
      <ellipse cx={46} cy={93} rx={22} ry={7} fill="#262836" />

      {/* gavda */}
      <rect x={42} y={38} width={9} height={9} rx={3} fill={q.teri} />
      <path d={tana} fill={q.koylak} />
      <path d={tana} fill={`url(#${soya})`} />

      {/* qo'llar klaviaturada */}
      <g className="o_qol">
        <path d="M61 52 Q70 60 76 53" stroke={q.koylak} strokeWidth={8} strokeLinecap="round" fill="none" />
        <path d="M61 52 Q70 60 76 53" stroke="rgba(255,255,255,0.15)" strokeWidth={8} strokeLinecap="round" fill="none" />
        <circle cx={77.5} cy={52} r={3.6} fill={q.teri} />
      </g>
      <g className="o_qol o_qol2">
        <path d="M31 53 Q36 63 47 59" stroke={q.koylak} strokeWidth={7.5} strokeLinecap="round" fill="none" />
        <path d="M31 53 Q36 63 47 59" stroke="rgba(0,0,0,0.2)" strokeWidth={7.5} strokeLinecap="round" fill="none" />
      </g>

      {/* kreslo suyanchig'i (gavdaning pastini to'sib turadi) */}
      <rect x={24} y={62} width={44} height={30} rx={9} fill="#1f2130" />
      <rect x={24} y={62} width={44} height={30} rx={9} fill={`url(#${soya})`} />
      <rect x={28} y={65} width={36} height={3} rx={1.5} fill="rgba(255,255,255,0.08)" />

      {/* bosh */}
      <g className="o_bosh">
        <circle cx={47} cy={29} r={16.5} fill={q.teri} />
        <circle cx={47} cy={29} r={16.5} fill={`url(#${nur})`} />
        <ellipse cx={62} cy={31} rx={3} ry={4.2} fill={q.teri} />
        <ellipse cx={62} cy={31} rx={3} ry={4.2} fill="rgba(0,0,0,0.12)" />
        <Soch q={q} cx={46} cy={27} kepkaRang={kepkaRang} nur={nur} />
      </g>
    </svg>
  );
}

// Yo'lakda yurib ketayotgan odam (yon ko'rinish, o'ngga qaragan).
export function YuruvchiOdam({ q, kepkaRang }: { q: Qiyofa; kepkaRang: string }) {
  const uid = xavfsiz(useId());
  const soya = `${uid}s`;
  const nur = `${uid}n`;
  return (
    <svg width={64} height={112} viewBox="0 0 64 112" className="o_yuruvchi">
      <defs>
        <linearGradient id={soya} x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity={0.3} />
          <stop offset="1" stopColor="#fff" stopOpacity={0.15} />
        </linearGradient>
        <radialGradient id={nur} cx="0.7" cy="0.25" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity={0.45} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.25} />
        </radialGradient>
      </defs>
      <ellipse cx={32} cy={107} rx={15} ry={4} fill="rgba(0,0,0,0.35)" />
      <g className="o_tanaYur">
        {/* orqa oyoq va qo'l */}
        <g className="o_oyoqA">
          <rect x={27} y={70} width={9} height={30} rx={4.5} fill={q.shim} filter="brightness(0.8)" />
          <ellipse cx={34} cy={101} rx={7} ry={3.2} fill="#121219" />
        </g>
        <g className="o_qolYurB">
          <path d="M31 46 L31 68" stroke={q.koylak} strokeWidth={7} strokeLinecap="round" />
          <path d="M31 46 L31 68" stroke="rgba(0,0,0,0.3)" strokeWidth={7} strokeLinecap="round" />
          <circle cx={31} cy={70} r={3.4} fill={q.teri} />
        </g>
        {/* gavda */}
        <rect x={21} y={42} width={22} height={33} rx={9} fill={q.koylak} />
        <rect x={21} y={42} width={22} height={33} rx={9} fill={`url(#${soya})`} />
        {/* old oyoq va qo'l */}
        <g className="o_oyoqB">
          <rect x={27} y={70} width={9} height={30} rx={4.5} fill={q.shim} />
          <ellipse cx={34} cy={101} rx={7} ry={3.2} fill="#16171f" />
        </g>
        <g className="o_qolYurA">
          <path d="M32 47 L32 68" stroke={q.koylak} strokeWidth={7} strokeLinecap="round" />
          <path d="M32 47 L32 68" stroke="rgba(255,255,255,0.12)" strokeWidth={7} strokeLinecap="round" />
          <circle cx={32} cy={70} r={3.4} fill={q.teri} />
        </g>
        {/* bosh */}
        <rect x={28} y={36} width={8} height={8} rx={3} fill={q.teri} />
        <circle cx={33} cy={24} r={15} fill={q.teri} />
        <circle cx={33} cy={24} r={15} fill={`url(#${nur})`} />
        <circle cx={41.5} cy={25} r={1.7} fill="#1d1d26" />
        <path d="M40 31 Q42 32 44 31" stroke="#8a4a3a" strokeWidth={1.2} fill="none" strokeLinecap="round" />
        <ellipse cx={30} cy={26} rx={2.6} ry={3.6} fill={q.teri} filter="brightness(0.9)" />
        <path
          d={`M18 26 A15.5 15.5 0 0 1 47 18 Q40 14 36 16 Q34 22 28 21 Q24 28 22 34 Q17 31 18 26 Z`}
          fill={q.soch}
        />
        {q.turmak === 1 && <circle cx={20} cy={14} r={6} fill={q.soch} />}
        {q.turmak === 2 && <path d="M18 24 Q14 40 22 44 L27 36 Q22 30 23 24 Z" fill={q.soch} />}
        {q.turmak === 3 && (
          <g>
            <path d="M18 20 A15 15 0 0 1 47 17 L18 20 Z" fill={kepkaRang} />
            <path d="M44 17 L54 19 Q50 22 44 21 Z" fill={kepkaRang} />
          </g>
        )}
      </g>
    </svg>
  );
}
