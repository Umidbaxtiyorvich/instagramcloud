"use client";

// three.js obyektlari (kamera, bo'g'inlar, materiallar) har kadrda useFrame ichida o'zgartiriladi —
// bu React Three Fiber'ning odatiy usuli, shuning uchun immutability qoidasi bu faylda o'chirilgan.
/* eslint-disable react-hooks/immutability */

import { useRef, type ReactNode } from "react";
import { useFrame, type ThreeElements, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Qiyofa } from "./qiyofa";

// To'liq 3D chibi odam: tos, gavda, bosh, soch, qo'l (yelka + tirsak) va oyoq (son + tizza)
// alohida bo'g'inlar sifatida yig'ilgan, har kadrda pozasi hisoblanadi.
// Modelning old tomoni lokal +z, oyoq tagi y = 0.

const SON_Y = 0.64; // tik turgandagi tos balandligi
const OTIR_Y = 0.48; // o'tirganda tos balandligi (kreslo o'rindig'i)

export type Poza = {
  otir: number; // 0 tik, 1 o'tirgan
  yur: number; // 0..1 yurish kuchi
  yoz: boolean; // klaviaturada yozmoqda
  qolKoter: boolean; // qo'l ko'tarib turibdi (tasdiq kutmoqda)
};

type Bogin = {
  tos: THREE.Group | null;
  gavda: THREE.Group | null;
  bosh: THREE.Group | null;
  yelkaL: THREE.Group | null;
  yelkaR: THREE.Group | null;
  tirsakL: THREE.Group | null;
  tirsakR: THREE.Group | null;
  sonL: THREE.Group | null;
  sonR: THREE.Group | null;
  tizzaL: THREE.Group | null;
  tizzaR: THREE.Group | null;
};

function Mat({ rang, g = 0.65 }: { rang: string; g?: number }) {
  return <meshStandardMaterial color={rang} roughness={g} metalness={0} />;
}

function Qism({ children, ...p }: { children: ReactNode } & ThreeElements["mesh"]) {
  return (
    <mesh castShadow receiveShadow {...p}>
      {children}
    </mesh>
  );
}

function Soch({ q, kepka }: { q: Qiyofa; kepka: string }) {
  return (
    <group>
      {/* boshning usti va orqasini qoplaydigan soch */}
      <Qism position={[0, 0.06, -0.05]} scale={[1.06, 1, 1.04]}>
        <sphereGeometry args={[0.31, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
        <Mat rang={q.soch} g={0.85} />
      </Qism>
      <Qism position={[0, -0.02, -0.08]}>
        <sphereGeometry args={[0.3, 24, 16]} />
        <Mat rang={q.soch} g={0.85} />
      </Qism>
      {q.turmak === 1 && (
        <Qism position={[0, 0.3, -0.16]}>
          <sphereGeometry args={[0.12, 16, 12]} />
          <Mat rang={q.soch} g={0.85} />
        </Qism>
      )}
      {q.turmak === 2 && (
        <Qism position={[0, -0.26, -0.14]} scale={[1, 1, 0.55]}>
          <capsuleGeometry args={[0.24, 0.3, 6, 16]} />
          <Mat rang={q.soch} g={0.85} />
        </Qism>
      )}
      {q.turmak === 3 && (
        <group>
          <Qism position={[0, 0.07, -0.01]} scale={[1.08, 1, 1.08]}>
            <sphereGeometry args={[0.31, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            <Mat rang={kepka} g={0.6} />
          </Qism>
          <Qism position={[0, 0.07, 0.3]} rotation={[0.15, 0, 0]}>
            <boxGeometry args={[0.36, 0.03, 0.22]} />
            <Mat rang={kepka} g={0.6} />
          </Qism>
        </group>
      )}
      {q.quloqchin && (
        <group>
          <Qism rotation={[0, 0, 0]} position={[0, 0.02, 0]}>
            <torusGeometry args={[0.33, 0.03, 8, 24, Math.PI]} />
            <Mat rang="#1b1c26" g={0.4} />
          </Qism>
          {[-1, 1].map((t) => (
            <Qism key={t} position={[0.33 * t, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.09, 0.09, 0.07, 16]} />
              <Mat rang="#1b1c26" g={0.4} />
            </Qism>
          ))}
        </group>
      )}
    </group>
  );
}

function Qol({ q, tomon, b }: { q: Qiyofa; tomon: 1 | -1; b: React.MutableRefObject<Bogin> }) {
  return (
    <group
      position={[0.27 * tomon, 0.5, 0]}
      ref={(g) => {
        b.current[tomon === 1 ? "yelkaR" : "yelkaL"] = g;
      }}
    >
      <Qism position={[0, -0.11, 0]}>
        <capsuleGeometry args={[0.068, 0.15, 6, 12]} />
        <Mat rang={q.koylak} />
      </Qism>
      <group
        position={[0, -0.24, 0]}
        ref={(g) => {
          b.current[tomon === 1 ? "tirsakR" : "tirsakL"] = g;
        }}
      >
        <Qism position={[0, -0.09, 0]}>
          <capsuleGeometry args={[0.06, 0.12, 6, 12]} />
          <Mat rang={q.koylak} />
        </Qism>
        <Qism position={[0, -0.21, 0]}>
          <sphereGeometry args={[0.07, 14, 10]} />
          <Mat rang={q.teri} />
        </Qism>
      </group>
    </group>
  );
}

function Oyoq({ q, tomon, b }: { q: Qiyofa; tomon: 1 | -1; b: React.MutableRefObject<Bogin> }) {
  return (
    <group
      position={[0.11 * tomon, 0, 0]}
      ref={(g) => {
        b.current[tomon === 1 ? "sonR" : "sonL"] = g;
      }}
    >
      <Qism position={[0, -0.15, 0]}>
        <capsuleGeometry args={[0.09, 0.18, 6, 12]} />
        <Mat rang={q.shim} />
      </Qism>
      <group
        position={[0, -0.29, 0]}
        ref={(g) => {
          b.current[tomon === 1 ? "tizzaR" : "tizzaL"] = g;
        }}
      >
        <Qism position={[0, -0.14, 0]}>
          <capsuleGeometry args={[0.08, 0.2, 6, 12]} />
          <Mat rang={q.shim} />
        </Qism>
        <Qism position={[0, -0.3, 0.05]}>
          <boxGeometry args={[0.15, 0.08, 0.27]} />
          <Mat rang="#15161f" g={0.4} />
        </Qism>
      </group>
    </group>
  );
}

const lerp = THREE.MathUtils.lerp;

// Bo'g'inlarga pozani qo'llash
export function pozaQollash(b: Bogin, p: Poza, t: number) {
  const { otir, yur } = p;
  const qadam = Math.sin(t * 8) * yur;
  if (b.tos) b.tos.position.y = lerp(SON_Y, OTIR_Y, otir) + Math.abs(Math.cos(t * 8)) * 0.03 * yur;

  // oyoqlar
  const sonOtir = -Math.PI / 2;
  const tizzaOtir = Math.PI / 2;
  if (b.sonL) b.sonL.rotation.x = lerp(qadam * 0.55, sonOtir, otir);
  if (b.sonR) b.sonR.rotation.x = lerp(-qadam * 0.55, sonOtir, otir);
  if (b.tizzaL) b.tizzaL.rotation.x = lerp(Math.max(0, -qadam) * 0.7, tizzaOtir, otir);
  if (b.tizzaR) b.tizzaR.rotation.x = lerp(Math.max(0, qadam) * 0.7, tizzaOtir, otir);

  // qo'llar
  let yL = -qadam * 0.5;
  let yR = qadam * 0.5;
  let tL = -0.15;
  let tR = -0.15;
  let zR = 0;
  if (otir > 0) {
    let oL = -0.55;
    let oR = -0.55;
    let eL = -1.0;
    let eR = -1.0;
    if (p.yoz) {
      oL = -0.9 + Math.sin(t * 17) * 0.05;
      oR = -0.9 + Math.sin(t * 17 + 2) * 0.05;
      eL = -0.72 + Math.sin(t * 21) * 0.14;
      eR = -0.72 + Math.sin(t * 21 + Math.PI) * 0.14;
    }
    yL = lerp(yL, oL, otir);
    yR = lerp(yR, oR, otir);
    tL = lerp(tL, eL, otir);
    tR = lerp(tR, eR, otir);
  }
  if (p.qolKoter) {
    yR = -2.9;
    tR = -0.25;
    zR = 0.25 + Math.sin(t * 6) * 0.25;
  }
  if (b.yelkaL) b.yelkaL.rotation.set(yL, 0, -0.08);
  if (b.yelkaR) b.yelkaR.rotation.set(yR, 0, 0.08 + zR);
  if (b.tirsakL) b.tirsakL.rotation.x = tL;
  if (b.tirsakR) b.tirsakR.rotation.x = tR;

  // gavda va bosh
  if (b.gavda) b.gavda.rotation.x = p.yoz ? 0.08 + Math.sin(t * 2) * 0.015 : 0.02 * yur;
  if (b.bosh) {
    if (p.yoz) {
      b.bosh.rotation.set(0.12 + Math.sin(t * 3) * 0.04, Math.sin(t * 0.7) * 0.06, 0);
    } else if (otir > 0.5) {
      // bo'sh paytda atrofga qarab qo'yadi
      const qara = Math.sin(t * 0.35);
      b.bosh.rotation.set(-0.05, Math.abs(qara) > 0.7 ? Math.sign(qara) * 0.5 * (Math.abs(qara) - 0.7) / 0.3 : 0, 0);
    } else {
      b.bosh.rotation.set(0, 0, Math.sin(t * 8) * 0.03 * yur);
    }
  }
}

export function OdamTana({
  q,
  kepka,
  bogin,
  onClick,
}: {
  q: Qiyofa;
  kepka: string;
  bogin: React.MutableRefObject<Bogin>;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const b = bogin;
  return (
    <group
      onClick={onClick}
      onPointerOver={onClick ? () => (document.body.style.cursor = "pointer") : undefined}
      onPointerOut={onClick ? () => (document.body.style.cursor = "") : undefined}
    >
      <group
        position={[0, SON_Y, 0]}
        ref={(g) => {
          b.current.tos = g;
        }}
      >
        <Oyoq q={q} tomon={-1} b={b} />
        <Oyoq q={q} tomon={1} b={b} />
        <group
          ref={(g) => {
            b.current.gavda = g;
          }}
        >
          {/* tos va gavda */}
          <Qism position={[0, 0.02, 0]} scale={[1, 0.6, 0.85]}>
            <sphereGeometry args={[0.2, 20, 14]} />
            <Mat rang={q.shim} />
          </Qism>
          <Qism position={[0, 0.3, 0]} scale={[1.1, 1, 0.82]}>
            <capsuleGeometry args={[0.2, 0.24, 8, 20]} />
            <Mat rang={q.koylak} />
          </Qism>
          <Qism position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.07, 0.08, 0.1, 12]} />
            <Mat rang={q.teri} />
          </Qism>
          <Qol q={q} tomon={-1} b={b} />
          <Qol q={q} tomon={1} b={b} />
          <group
            position={[0, 0.64, 0]}
            ref={(g) => {
              b.current.bosh = g;
            }}
          >
            <group position={[0, 0.28, 0]}>
              <Qism>
                <sphereGeometry args={[0.3, 32, 24]} />
                <Mat rang={q.teri} g={0.55} />
              </Qism>
              {/* ko'zlar, quloqlar */}
              {[-1, 1].map((t) => (
                <group key={t}>
                  <mesh position={[0.1 * t, 0.0, 0.275]}>
                    <sphereGeometry args={[0.035, 10, 8]} />
                    <meshStandardMaterial color="#141418" roughness={0.3} />
                  </mesh>
                  <Qism position={[0.29 * t, -0.01, 0]} scale={[0.5, 1, 0.8]}>
                    <sphereGeometry args={[0.07, 10, 8]} />
                    <Mat rang={q.teri} />
                  </Qism>
                </group>
              ))}
              <mesh position={[0, -0.1, 0.27]} rotation={[0, 0, Math.PI]}>
                <torusGeometry args={[0.05, 0.012, 6, 12, Math.PI]} />
                <meshStandardMaterial color="#7a3b33" />
              </mesh>
              <Soch q={q} kepka={kepka} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

export function useBogin() {
  return useRef<Bogin>({
    tos: null,
    gavda: null,
    bosh: null,
    yelkaL: null,
    yelkaR: null,
    tirsakL: null,
    tirsakR: null,
    sonL: null,
    sonR: null,
    tizzaL: null,
    tizzaR: null,
  });
}

// Yo'lak bo'ylab (to'rtburchak halqa) yurib yuradigan xodim
export function Yuruvchi({ q, kepka, yarim, muddat, kechik }: { q: Qiyofa; kepka: string; yarim: number; muddat: number; kechik: number }) {
  const ildiz = useRef<THREE.Group>(null);
  const b = useBogin();
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + kechik;
    const u = ((t / muddat) % 1) * 4;
    const tomon = Math.floor(u);
    const f = u - tomon;
    const a = yarim;
    const burchak: [number, number][] = [
      [-a, -a],
      [a, -a],
      [a, a],
      [-a, a],
    ];
    const [x1, z1] = burchak[tomon];
    const [x2, z2] = burchak[(tomon + 1) % 4];
    if (ildiz.current) {
      ildiz.current.position.set(lerp(x1, x2, f), 0, lerp(z1, z2, f));
      ildiz.current.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    }
    pozaQollash(b.current, { otir: 0, yur: 1, yoz: false, qolKoter: false }, t);
  });
  return (
    <group ref={ildiz}>
      <OdamTana q={q} kepka={kepka} bogin={b} />
    </group>
  );
}
