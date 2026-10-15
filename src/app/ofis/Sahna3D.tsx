"use client";

// three.js obyektlari (kamera, bo'g'inlar, materiallar) har kadrda useFrame ichida o'zgartiriladi —
// bu React Three Fiber'ning odatiy usuli, shuning uchun immutability qoidasi bu faylda o'chirilgan.
/* eslint-disable react-hooks/immutability */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Line, OrbitControls, OrthographicCamera } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { JAMOALAR, type Agent, type Jamoa, type JamoaId } from "@/lib/ofis";
import { OdamTana, Yuruvchi, pozaQollash, useBogin } from "./Odam3D";
import { qiyofa } from "./qiyofa";

// ---------- o'lchamlar (metr) ----------
const XONA = 8;
const ORALIQ = 2;
const QADAM = XONA + ORALIQ;
const DEVOR_H = 1.7;
export const MAKS_AGENT = 6;

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
const ORINLAR: [number, number][] = [
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

const YURUVCHILAR = [
  { yarim: 5, muddat: 34, kechik: 0, rang: "#4d8dff" },
  { yarim: 5, muddat: 34, kechik: 17, rang: "#ff4d8d" },
  { yarim: 15.2, muddat: 70, kechik: 9, rang: "#2ecf8f" },
  { yarim: 15.2, muddat: 70, kechik: 44, rang: "#ffb45a" },
];

type Props = {
  agentlar: Agent[];
  jamoa: JamoaId | null;
  band: boolean;
  eslatmaSoni: number;
  yangiAgentlar: Set<string>;
  surish: number; // panellar uchun ekran markazini px ga surish
  onXona: (id: JamoaId) => void;
  onAgent: (a: Agent) => void;
  onMiya: () => void;
  onBosh: () => void;
};

// ---------- yorliqlar: 3D nuqtani har kadrda ekranga proyeksiya qilib, oddiy DOM elementni suramiz ----------
type Yozuv = { obj: THREE.Object3D | null; el: HTMLElement | null };
type Yorliqlar = Map<string, Yozuv>;
const YorliqCtx = createContext<Yorliqlar>(new Map());

function yozuv(m: Yorliqlar, id: string) {
  let e = m.get(id);
  if (!e) {
    e = { obj: null, el: null };
    m.set(id, e);
  }
  return e;
}

function Langar({ id, position }: { id: string; position: [number, number, number] }) {
  const m = useContext(YorliqCtx);
  return (
    <group
      position={position}
      ref={(g) => {
        yozuv(m, id).obj = g;
      }}
    />
  );
}

function Proyeksiya() {
  const m = useContext(YorliqCtx);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    // uzoqdan qaralganda agent nomlari bir-birini bosib qolmasin
    const yaqin = (camera as THREE.OrthographicCamera).zoom > 22;
    for (const [id, e] of m) {
      if (!e.el) continue;
      if (!e.obj) {
        e.el.style.visibility = "hidden";
        continue;
      }
      v.setFromMatrixPosition(e.obj.matrixWorld).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      e.el.style.visibility = v.z > 1 || (!yaqin && id.startsWith("agent:")) ? "hidden" : "visible";
      e.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  });
  return null;
}

// ---------- monitor ekrani uchun "kod" teksturasi ----------
function useKodTekstura() {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 256;
    const x = c.getContext("2d")!;
    x.fillStyle = "#0e1020";
    x.fillRect(0, 0, 128, 256);
    const ranglar = ["#7dffc3", "#ffffff", "#ffd36b", "#8fb3ff", "#ff8fb1"];
    for (let i = 0; i < 32; i++) {
      let px = 8 + (i % 5 === 0 ? 0 : 10 + (i % 3) * 8);
      const bo = 2 + (i % 4);
      for (let k = 0; k < bo; k++) {
        const w = 8 + ((i * 7 + k * 13) % 26);
        x.fillStyle = ranglar[(i + k) % ranglar.length];
        x.fillRect(px, 6 + i * 8, w, 4);
        px += w + 5;
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 0.5);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

function bosilmadi(e: ThreeEvent<MouseEvent>) {
  // kamerani aylantirish uchun sudralganda bosish hisoblanmasin
  return e.delta > 5;
}

// ---------- jihozlar ----------
function Stol({ yonik, kod }: { yonik: boolean; kod: THREE.Texture }) {
  return (
    <group>
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.05, 0.8]} />
        <meshStandardMaterial color="#f1ede6" roughness={0.6} />
      </mesh>
      {[
        [-0.74, -0.34],
        [0.74, -0.34],
        [-0.74, 0.34],
        [0.74, 0.34],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.36, z]} castShadow>
          <boxGeometry args={[0.04, 0.72, 0.04]} />
          <meshStandardMaterial color="#1a1b24" />
        </mesh>
      ))}
      {/* klaviatura */}
      <mesh position={[0, 0.775, 0.18]} castShadow>
        <boxGeometry args={[0.5, 0.02, 0.16]} />
        <meshStandardMaterial color="#2a2c3a" />
      </mesh>
      {/* monitor */}
      <mesh position={[0, 0.85, -0.22]} castShadow>
        <boxGeometry args={[0.06, 0.18, 0.06]} />
        <meshStandardMaterial color="#1a1b24" />
      </mesh>
      <mesh position={[0, 1.15, -0.25]} castShadow>
        <boxGeometry args={[0.78, 0.46, 0.04]} />
        <meshStandardMaterial color="#1a1b24" roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.15, -0.228]}>
        <planeGeometry args={[0.72, 0.4]} />
        {yonik ? (
          <meshStandardMaterial map={kod} emissiveMap={kod} emissive="#ffffff" emissiveIntensity={1.6} toneMapped={false} />
        ) : (
          <meshStandardMaterial color="#232638" roughness={0.3} />
        )}
      </mesh>
    </group>
  );
}

function Kreslo() {
  return (
    <group>
      <mesh position={[0, 0.44, 0]} castShadow>
        <boxGeometry args={[0.52, 0.08, 0.5]} />
        <meshStandardMaterial color="#20222e" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.82, -0.27]} castShadow>
        <boxGeometry args={[0.5, 0.62, 0.08]} />
        <meshStandardMaterial color="#20222e" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.24, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.36, 8]} />
        <meshStandardMaterial color="#3a3c4a" metalness={0.6} roughness={0.3} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[0, 0.05, 0]} rotation={[0, (i * Math.PI * 2) / 5, 0]}>
          <boxGeometry args={[0.05, 0.04, 0.6]} />
          <meshStandardMaterial color="#15161f" />
        </mesh>
      ))}
    </group>
  );
}

function Gul({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.15, 0.4, 16]} />
        <meshStandardMaterial color="#f2efe9" />
      </mesh>
      {[
        [0, 0.6, 0, 0.3],
        [0.15, 0.75, 0.05, 0.22],
        [-0.12, 0.8, -0.05, 0.2],
        [0.02, 0.95, 0.08, 0.18],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <icosahedronGeometry args={[r, 1]} />
          <meshStandardMaterial color={i % 2 ? "#4fae5a" : "#3c9a4b"} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// ---------- agent: kresloda o'tiradi; yangi bo'lsa xonaga kirib keladi ----------
function Agent3D({
  a,
  rang,
  kod,
  kirish,
  onClick,
}: {
  a: Agent;
  rang: string;
  kod: THREE.Texture;
  kirish: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const q = useMemo(() => qiyofa(a.id + a.ism, rang), [a.id, a.ism, rang]);
  const b = useBogin();
  const tana = useRef<THREE.Group>(null);
  const holat = useRef({ bosh: kirish ? -1 : 0, urug: (a.id.charCodeAt(0) % 17) * 1.3 });

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + holat.current.urug;
    const h = holat.current;
    let otir = 1;
    let yur = 0;
    if (h.bosh === -1) h.bosh = clock.getElapsedTime();
    if (kirish) {
      // 0..2.6s yurib keladi, keyin 0.5s da o'tiradi
      const o = clock.getElapsedTime() - h.bosh;
      const yol = Math.min(1, o / 2.6);
      if (tana.current) {
        // xonaning old tomonidan (+z) kresloga qarab yuradi, keyin stolga (-z) o'giriladi
        tana.current.position.set(0.9 * (1 - yol), 0, 3.2 * (1 - yol));
        tana.current.rotation.y = yol < 1 ? Math.atan2(-0.9, -3.2) : Math.PI;
      }
      yur = yol < 1 ? 1 : 0;
      otir = yol < 1 ? 0 : Math.min(1, (o - 2.6) / 0.5);
    }
    pozaQollash(
      b.current,
      { otir, yur, yoz: a.holat === "ishlamoqda" && otir > 0.9, qolKoter: a.holat === "tasdiq" && otir > 0.9 },
      t,
    );
  });

  return (
    <group>
      <group rotation={[0, Math.PI, 0]}>
        <Kreslo />
      </group>
      <group position={[0, 0, -0.78]}>
        <Stol yonik={a.holat === "ishlamoqda"} kod={kod} />
      </group>
      <group ref={tana} rotation={[0, Math.PI, 0]}>
        <OdamTana q={q} kepka={rang} bogin={b} onClick={onClick} />
        <Langar id={`agent:${a.id}`} position={[0, 2.05, 0]} />
      </group>
    </group>
  );
}

// ---------- xona ----------
function Xona({
  j,
  agentlar,
  tanlangan,
  kod,
  yangi,
  onXona,
  onAgent,
}: {
  j: Jamoa;
  agentlar: Agent[];
  tanlangan: boolean;
  kod: THREE.Texture;
  yangi: Set<string>;
  onXona: (id: JamoaId) => void;
  onAgent: (a: Agent) => void;
}) {
  const [cx, cz] = xonaMarkazi(j.id);
  const polRang = useMemo(() => new THREE.Color(j.rang).lerp(new THREE.Color("#20213a"), 0.3), [j.rang]);
  const devorRang = useMemo(() => new THREE.Color(j.rang).lerp(new THREE.Color("#ffffff"), 0.08), [j.rang]);
  const yarim = XONA / 2;
  return (
    <group position={[cx, 0, cz]}>
      {/* pol */}
      <mesh
        position={[0, -0.08, 0]}
        receiveShadow
        onClick={(e) => {
          if (bosilmadi(e)) return;
          e.stopPropagation();
          onXona(j.id);
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <boxGeometry args={[XONA, 0.16, XONA]} />
        <meshStandardMaterial
          color={polRang}
          roughness={0.85}
          emissive={j.rang}
          emissiveIntensity={tanlangan ? 0.22 : 0.05}
        />
      </mesh>
      <gridHelper args={[XONA, 8, "#ffffff", "#ffffff"]} position={[0, 0.005, 0]}>
        <lineBasicMaterial attach="material" color="#ffffff" transparent opacity={0.08} />
      </gridHelper>
      {/* orqa va chap devor */}
      <mesh position={[0, DEVOR_H / 2, -yarim + 0.06]} castShadow receiveShadow>
        <boxGeometry args={[XONA, DEVOR_H, 0.12]} />
        <meshStandardMaterial color={devorRang} roughness={0.7} />
      </mesh>
      <mesh position={[-yarim + 0.06, DEVOR_H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.12, DEVOR_H, XONA]} />
        <meshStandardMaterial color={devorRang} roughness={0.7} />
      </mesh>
      {/* derazalar */}
      {[-2.2, 0.2].map((x) => (
        <mesh key={x} position={[x, 1.05, -yarim + 0.13]}>
          <boxGeometry args={[1.4, 0.7, 0.02]} />
          <meshStandardMaterial color="#bfe0ff" emissive="#7fb6ff" emissiveIntensity={0.35} roughness={0.1} />
        </mesh>
      ))}
      <mesh position={[-yarim + 0.13, 1.05, 0.8]}>
        <boxGeometry args={[0.02, 0.7, 1.6]} />
        <meshStandardMaterial color="#bfe0ff" emissive="#7fb6ff" emissiveIntensity={0.35} roughness={0.1} />
      </mesh>
      {/* javon */}
      <mesh position={[2.6, 1.2, -yarim + 0.25]} castShadow>
        <boxGeometry args={[1.6, 0.06, 0.3]} />
        <meshStandardMaterial color="#f1ede6" />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[2.05 + i * 0.22, 1.38, -yarim + 0.25]} castShadow>
          <boxGeometry args={[0.12, 0.3, 0.2]} />
          <meshStandardMaterial color={["#e55", "#5ae", "#fc5", "#7c7"][i]} />
        </mesh>
      ))}
      <Gul position={[3.3, 0, 3.3]} />
      <Gul position={[-3.4, 0, 3.4]} />

      {ORINLAR.map(([x, z], i) => {
        const a = agentlar[i];
        if (!a && i >= Math.max(2, agentlar.length)) return null;
        return (
          <group key={a?.id ?? `bo'sh${i}`} position={[x, 0, z]}>
            {a ? (
              <Agent3D
                a={a}
                rang={j.rang}
                kod={kod}
                kirish={yangi.has(a.id)}
                onClick={(e) => {
                  if (bosilmadi(e)) return;
                  e.stopPropagation();
                  onAgent(a);
                }}
              />
            ) : (
              <>
                <group rotation={[0, Math.PI, 0]}>
                  <Kreslo />
                </group>
                <group position={[0, 0, -0.78]}>
                  <Stol yonik={false} kod={kod} />
                </group>
              </>
            )}
          </group>
        );
      })}

      <Langar id={`xona:${j.id}`} position={[-yarim + 0.6, DEVOR_H + 0.3, -yarim + 0.6]} />
    </group>
  );
}

// ---------- markazdagi "miya" ----------
function Miya({ band, onMiya }: { band: boolean; onMiya: () => void }) {
  const shar = useRef<THREE.Mesh>(null);
  const halqalar = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (shar.current) {
      shar.current.position.y = 3 + Math.sin(t * (band ? 6 : 1.5)) * 0.15;
      const m = shar.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = band ? 3 + Math.sin(t * 10) : 2.2;
    }
    if (halqalar.current) halqalar.current.rotation.y = t * 0.2;
  });
  return (
    <group>
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <cylinderGeometry args={[3.2, 3.4, 0.1, 64]} />
        <meshStandardMaterial color="#141733" roughness={0.4} metalness={0.3} />
      </mesh>
      <group ref={halqalar}>
        {[1.4, 2.1, 2.9].map((r) => (
          <mesh key={r} position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[r, 0.03, 8, 96]} />
            <meshStandardMaterial color="#8fd0ff" emissive="#6cc4ff" emissiveIntensity={2.5} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 1.5, 0]}>
        <cylinderGeometry args={[0.45, 0.7, 3, 32, 1, true]} />
        <meshBasicMaterial color="#7cc4ff" transparent opacity={0.18} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh
        ref={shar}
        position={[0, 3, 0]}
        onClick={(e) => {
          if (bosilmadi(e)) return;
          e.stopPropagation();
          onMiya();
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <sphereGeometry args={[0.85, 48, 32]} />
        <meshStandardMaterial
          color={band ? "#c7b2ff" : "#9fd8ff"}
          emissive={band ? "#9a7bff" : "#4a9dff"}
          emissiveIntensity={2.2}
          toneMapped={false}
        />
      </mesh>
      <pointLight position={[0, 3, 0]} color="#6cb8ff" intensity={25} distance={14} />
      <Langar id="miya" position={[0, 4.1, 0]} />
    </group>
  );
}

function Aloqalar({ agentlar }: { agentlar: Agent[] }) {
  const chiziqlar = useRef<(THREE.Object3D | null)[]>([]);
  useFrame((_, dt) => {
    for (const c of chiziqlar.current) {
      const m = (c as unknown as { material?: { dashOffset: number } } | null)?.material;
      if (m) m.dashOffset -= dt * 1.5;
    }
  });
  return (
    <>
      {JAMOALAR.map((j, i) => {
        const [x, z] = xonaMarkazi(j.id);
        const faol = agentlar.some((a) => a.jamoa === j.id && a.holat === "ishlamoqda");
        return (
          <Line
            key={j.id}
            ref={(r) => {
              chiziqlar.current[i] = r as unknown as THREE.Object3D;
            }}
            points={[
              [0, 0.15, 0],
              [x * 0.62, 0.15, z * 0.62],
            ]}
            color={j.rang}
            lineWidth={faol ? 3 : 1.5}
            dashed
            dashSize={0.35}
            gapSize={0.35}
            transparent
            opacity={faol ? 1 : 0.45}
          />
        );
      })}
    </>
  );
}

// ---------- kamera: tanlangan xonaga silliq uchib boradi ----------
function Kamera({ jamoa, surish }: { jamoa: JamoaId | null; surish: number }) {
  const boshqaruv = useRef<OrbitControlsImpl>(null);
  const { size, camera } = useThree();
  // telefonda butun ofis sig'masligi mumkin — kichraytirib yubormaslik uchun pastki chegara
  const sigdir = Math.min(size.width / 36, (size.height - 110) / 24);
  const asosiy = size.width < 720 ? Math.max(sigdir, size.width / 22) : sigdir;
  const maqsad = useRef({ nuqta: new THREE.Vector3(), zoom: asosiy, faol: true });

  useEffect(() => {
    const [x, z] = jamoa ? xonaMarkazi(jamoa) : [0, 0];
    const zoom = jamoa ? asosiy * 2.3 : asosiy;
    const nuqta = new THREE.Vector3(x, 0.5, z);
    // panel ochiq bo'lsa, xonani ekranning bo'sh qismiga suramiz
    const ong = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    nuqta.addScaledVector(ong, -surish / zoom);
    maqsad.current = { nuqta, zoom, faol: true };
  }, [jamoa, asosiy, surish, camera]);

  useFrame((_, dt) => {
    const c = boshqaruv.current;
    const m = maqsad.current;
    if (!c || !m.faol) return;
    const k = 1 - Math.pow(0.002, dt);
    const oldin = c.target.clone();
    c.target.lerp(m.nuqta, k);
    camera.position.add(c.target.clone().sub(oldin));
    const cam = camera as THREE.OrthographicCamera;
    cam.zoom = THREE.MathUtils.lerp(cam.zoom, m.zoom, k);
    cam.updateProjectionMatrix();
    c.update();
    if (c.target.distanceTo(m.nuqta) < 0.01 && Math.abs(cam.zoom - m.zoom) < 0.01) m.faol = false;
  });

  return (
    <>
      <OrthographicCamera makeDefault position={[40, 36, 40]} zoom={asosiy} near={-200} far={400} />
      <OrbitControls
        ref={boshqaruv}
        makeDefault
        enablePan={false}
        minPolarAngle={0.35}
        maxPolarAngle={1.2}
        minZoom={asosiy * 0.7}
        maxZoom={asosiy * 6}
        onStart={() => (maqsad.current.faol = false)}
      />
    </>
  );
}

function Sahna(p: Props) {
  const kod = useKodTekstura();
  useFrame((_, dt) => {
    kod.offset.y -= dt * 0.12;
  });
  const boyicha = useMemo(() => {
    const m = new Map<JamoaId, Agent[]>();
    for (const a of p.agentlar) m.set(a.jamoa, [...(m.get(a.jamoa) ?? []), a]);
    return m;
  }, [p.agentlar]);

  return (
    <>
      <color attach="background" args={["#0a0b14"]} />
      <fog attach="fog" args={["#0a0b14", 80, 160]} />
      <hemisphereLight args={["#dfe6ff", "#20223a", 0.9]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[14, 26, 10]}
        intensity={1.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
        shadow-bias={-0.0004}
      />

      {/* umumiy pol */}
      <mesh position={[0, -0.2, 0]} receiveShadow onClick={(e) => !bosilmadi(e) && p.onBosh()}>
        <boxGeometry args={[36, 0.2, 36]} />
        <meshStandardMaterial color="#121426" roughness={0.9} />
      </mesh>
      <gridHelper args={[36, 36]} position={[0, -0.09, 0]}>
        <lineBasicMaterial attach="material" color="#ffffff" transparent opacity={0.04} />
      </gridHelper>

      <Miya band={p.band} onMiya={p.onMiya} />
      <Aloqalar agentlar={p.agentlar} />

      {JAMOALAR.map((j) => (
        <Xona
          key={j.id}
          j={j}
          agentlar={boyicha.get(j.id) ?? []}
          tanlangan={p.jamoa === j.id}
          kod={kod}
          yangi={p.yangiAgentlar}
          onXona={p.onXona}
          onAgent={p.onAgent}
        />
      ))}

      {YURUVCHILAR.map((y, i) => (
        <Yuruvchi key={i} q={qiyofa("yuruvchi" + i, y.rang)} kepka={y.rang} yarim={y.yarim} muddat={y.muddat} kechik={y.kechik} />
      ))}

      <Kamera jamoa={p.jamoa} surish={p.surish} />
      <Proyeksiya />
      <EffectComposer>
        <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.95} luminanceSmoothing={0.2} />
      </EffectComposer>
    </>
  );
}

export default function Sahna3D(p: Props) {
  const [yorliqlar] = useState<Yorliqlar>(() => new Map());
  const ref = (id: string) => (el: HTMLElement | null) => {
    yozuv(yorliqlar, id).el = el;
  };
  return (
    <YorliqCtx.Provider value={yorliqlar}>
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onPointerMissed={() => p.onBosh()}
        style={{ position: "absolute", inset: 0 }}
      >
        <YorliqCtx.Provider value={yorliqlar}>
          <Sahna {...p} />
        </YorliqCtx.Provider>
      </Canvas>
      <div className="o_yorliqlar">
        <div ref={ref("miya")} className="o_yorliq">
          <div className="o_xonaYorliq" style={{ ["--r" as string]: "#7cc4ff", cursor: "pointer" }} onClick={p.onMiya}>
            🧠 Miya <small>{p.eslatmaSoni} eslatma · umumiy xotira</small>
          </div>
        </div>
        {JAMOALAR.map((j) => (
          <div key={j.id} ref={ref(`xona:${j.id}`)} className="o_yorliq">
            <div
              className="o_xonaYorliq"
              style={{ ["--r" as string]: j.rang, cursor: "pointer" }}
              onClick={() => p.onXona(j.id)}
            >
              {j.belgi} {j.nom} <small>{p.agentlar.filter((a) => a.jamoa === j.id).length} agent</small>
            </div>
          </div>
        ))}
        {p.agentlar.map((a) => (
          <div key={a.id} ref={ref(`agent:${a.id}`)} className="o_yorliq o_yorliqAgent">
            <div className="o_tikIchiHtml">
              {a.holat === "ishlamoqda" && <div className="o_pufak">•••</div>}
              {a.holat === "tasdiq" && <div className="o_pufak">✋</div>}
              <div className="o_agentNom">
                <i
                  className={`o_nuqta ${a.holat === "ishlamoqda" ? "o_nuqtaIshda" : a.holat === "tasdiq" ? "o_nuqtaTasdiq" : ""}`}
                />
                {a.ism}
              </div>
            </div>
          </div>
        ))}
      </div>
    </YorliqCtx.Provider>
  );
}
