"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./ofis.css";
import { OtirganOdam, YuruvchiOdam, qiyofa } from "./Odam";
import {
  BOSHLANGICH_AGENTLAR,
  JAMOALAR,
  jamoaById,
  type Agent,
  type JamoaId,
  type Taqsimot,
  type Vazifa,
  type Xabar,
} from "@/lib/ofis";

// ofis.css dagi barcha klasslar "o_" bilan boshlanadi
const s = new Proxy({} as Record<string, string>, { get: (_t, k) => `o_${String(k)}` });

// ---------- sahna o'lchamlari ----------
const R = 320; // xona tomoni
const GAP = 80;
const W = 3 * R + 2 * GAP;
const DEVOR = 78;

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

// stol joylari (xona ichida)
const STOLLAR: [number, number][] = [
  [62, 70],
  [190, 70],
  [62, 160],
  [190, 160],
  [62, 245],
  [190, 245],
];
const MAKS_AGENT = STOLLAR.length;

const MISOLLAR = [
  "Drive'dagi 3 ta yangi klipdan 30 soniyalik reels yasab ber",
  "Ertangi Instagram postlarini rejalashtir",
  "Raqobatchilarimizning narxlarini o'rganib chiq",
  "Mijozga chegirma haqida taklif xati yoz",
  "Shu oygi xarajatlarni hisobla",
  "O'tgan haftaning statistikasidan hisobot tayyorla",
];

// yo'lak bo'ylab aylanib yuradigan xodimlar (1 — ichki halqa, 2 — tashqi halqa)
const YURUVCHILAR = [
  { yol: 1, kechik: 0, muddat: 40, rang: "#4d8dff" },
  { yol: 1, kechik: -20, muddat: 40, rang: "#ff4d8d" },
  { yol: 2, kechik: -8, muddat: 70, rang: "#2ecf8f" },
  { yol: 2, kechik: -43, muddat: 70, rang: "#ffb45a" },
];

type Eslatma = { id: string; matn: string; jamoa: JamoaId; vaqt: number };
type Ofis = { agentlar: Agent[]; vazifalar: Vazifa[]; xabarlar: Xabar[]; eslatmalar: Eslatma[] };
type Tab = "ofis" | "vazifalar" | "miya";

const KALIT = "ai-ofis-v1";
const BOSH_OFIS: Ofis = { agentlar: BOSHLANGICH_AGENTLAR, vazifalar: [], xabarlar: [], eslatmalar: [] };

const birinchiBelgi = (s: string) => {
  const seg = new Intl.Segmenter("uz", { granularity: "grapheme" }).segment(s.trim())[Symbol.iterator]().next();
  return seg.done ? "🤖" : seg.value.segment;
};
const yangiId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const rangi = (r: string) => ({ "--r": r }) as CSSProperties;

function xonaKoordinata(id: JamoaId) {
  const [c, r] = JOYLAR[id];
  return { x: c * (R + GAP), y: r * (R + GAP) };
}

function ballar(nom: string, ishlatildi: number) {
  let h = 0;
  for (const ch of nom) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return Math.min(100, 35 + (h % 45) + ishlatildi * 6);
}

// Bir qadam oldinga: jarayondagi vazifalarni yuritadi.
function oldinga(o: Ofis): Ofis {
  const jarayonda = o.vazifalar.filter((v) => v.holat === "jarayonda");
  if (!jarayonda.length) return o;
  const xabarlar = [...o.xabarlar];
  const eslatmalar = [...o.eslatmalar];
  const tugaganAgentlar = new Map<string, "tasdiq" | "bosh">();
  const vazifalar = o.vazifalar.map((v) => {
    if (v.holat !== "jarayonda") return v;
    const bosqich = v.bosqich + 1;
    if (bosqich < v.qadamlar.length) return { ...v, bosqich };
    const holat = v.tasdiqKerak ? ("tasdiq" as const) : ("bajarildi" as const);
    tugaganAgentlar.set(v.agentId, holat === "tasdiq" ? "tasdiq" : "bosh");
    xabarlar.push({
      id: yangiId(),
      kimdan: "agent",
      agentId: v.agentId,
      matn:
        (v.natija ? v.natija + "\n\n" : "") +
        (holat === "tasdiq" ? "✋ Tayyor. Tasdiqlaysizmi? (Vazifalar bo'limida «Tasdiqlash»)" : "✅ Bajarildi."),
      vaqt: Date.now(),
    });
    eslatmalar.unshift({ id: yangiId(), matn: v.matn, jamoa: v.jamoa, vaqt: Date.now() });
    return { ...v, bosqich, holat, tugadi: Date.now() };
  });
  const agentlar = o.agentlar.map((a) => {
    if (!tugaganAgentlar.has(a.id)) return a;
    const yanaIshi = vazifalar.some((v) => v.agentId === a.id && v.holat === "jarayonda");
    return { ...a, holat: yanaIshi ? ("ishlamoqda" as const) : tugaganAgentlar.get(a.id)! };
  });
  return { agentlar, vazifalar, xabarlar, eslatmalar: eslatmalar.slice(0, 200) };
}

// ---------- brauzer ovoz tanish turlari ----------
type Tanish = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

export default function OfisSahifa() {
  const [ofis, setOfis] = useState<Ofis>(BOSH_OFIS);
  const [yuklandi, setYuklandi] = useState(false);
  const [tab, setTab] = useState<Tab>("ofis");
  const [jamoa, setJamoa] = useState<JamoaId | null>(null);
  const [chatAgent, setChatAgent] = useState<string | null>(null);
  const [buyruq, setBuyruq] = useState("");
  const [chatMatn, setChatMatn] = useState("");
  const [band, setBand] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ochiqNatija, setOchiqNatija] = useState<string | null>(null);
  const [ekran, setEkran] = useState({ w: 1280, h: 800 });
  const [foydalanuvchi, setFoydalanuvchi] = useState<string | null | undefined>(undefined);
  const [ovoz, setOvoz] = useState<{ faol: boolean; matn: string; maqsad: "buyruq" | "chat" }>({
    faol: false,
    matn: "",
    maqsad: "buyruq",
  });
  const tanishRef = useRef<Tanish | null>(null);
  const xabarOxiri = useRef<HTMLDivElement>(null);

  // saqlangan ofisni yuklash
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(KALIT);
        if (raw) {
          const o = JSON.parse(raw) as Ofis;
          if (Array.isArray(o.agentlar) && o.agentlar.length) setOfis({ ...BOSH_OFIS, ...o });
        }
      } catch {}
      setYuklandi(true);
    }, 0);
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setFoydalanuvchi(d.user ? d.user.name || d.user.email : null))
      .catch(() => setFoydalanuvchi(null));
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!yuklandi) return;
    try {
      localStorage.setItem(KALIT, JSON.stringify(ofis));
    } catch {}
  }, [ofis, yuklandi]);

  useEffect(() => {
    const f = () => setEkran({ w: window.innerWidth, h: window.innerHeight });
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  const jarayonSoni = ofis.vazifalar.filter((v) => v.holat === "jarayonda").length;
  useEffect(() => {
    if (!jarayonSoni) return;
    const t = setInterval(() => setOfis(oldinga), 1700);
    return () => clearInterval(t);
  }, [jarayonSoni]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const el = xabarOxiri.current?.parentElement;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [ofis.xabarlar.length, ofis.vazifalar, chatAgent]);

  // ---------- vazifa topshirish ----------
  const topshir = useCallback(
    async (matn: string, opts: { jamoa?: JamoaId; agentId?: string } = {}) => {
      const toza = matn.trim();
      if (toza.length < 2 || band) return;
      setBand(true);
      try {
        const tarix = opts.agentId
          ? ofis.xabarlar
              .filter((x) => x.agentId === opts.agentId)
              .slice(-10)
              .map((x) => ({ kimdan: x.kimdan, matn: x.matn.slice(0, 3900) }))
          : undefined;
        const res = await fetch("/api/ofis/vazifa", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            matn: toza,
            jamoa: opts.jamoa,
            agentId: opts.agentId,
            tarix,
            agentlar: ofis.agentlar.map(({ id, ism, rol, jamoa, konikmalar }) => ({ id, ism, rol, jamoa, konikmalar })),
          }),
        });
        const d = (await res.json()) as { taqsimot?: Taqsimot; eslatma?: string; error?: string };
        if (!d.taqsimot) {
          setToast(d.error || "Xatolik yuz berdi");
          return;
        }
        const t = d.taqsimot;
        let agentlar = ofis.agentlar;
        let aid = t.agentId && agentlar.some((a) => a.id === t.agentId) ? t.agentId : null;
        let yangiAgent: Agent | null = null;
        const jamoaAgentlari = agentlar.filter((a) => a.jamoa === t.jamoa);
        if (!aid) {
          if (jamoaAgentlari.length >= MAKS_AGENT || !t.yangiAgent) {
            aid = jamoaAgentlari.find((a) => a.holat === "bosh")?.id ?? jamoaAgentlari[0]?.id ?? null;
          }
          if (!aid) {
            const y = t.yangiAgent ?? { ism: "Yangi agent", rol: "Yordamchi", avatar: "🤖", konikmalar: [] };
            yangiAgent = {
              id: yangiId(),
              ism: y.ism.slice(0, 40),
              rol: y.rol.slice(0, 80),
              avatar: birinchiBelgi(y.avatar),
              konikmalar: y.konikmalar.slice(0, 4),
              jamoa: t.jamoa,
              holat: "bosh",
              yangi: true,
            };
            agentlar = [...agentlar, yangiAgent];
            aid = yangiAgent.id;
          }
        }
        const agentId = aid!;
        const vazifa: Vazifa = {
          id: yangiId(),
          matn: toza,
          jamoa: t.jamoa,
          agentId,
          holat: "jarayonda",
          qadamlar: t.qadamlar.length ? t.qadamlar.slice(0, 6) : ["Bajarish"],
          bosqich: 0,
          natija: t.natija,
          tasdiqKerak: t.tasdiqKerak,
          manba: t.manba,
          vaqt: Date.now(),
        };
        setOfis((o) => ({
          ...o,
          agentlar: (yangiAgent ? [...o.agentlar, yangiAgent] : o.agentlar).map((a) =>
            a.id === agentId ? { ...a, holat: "ishlamoqda" } : a,
          ),
          vazifalar: [vazifa, ...o.vazifalar].slice(0, 150),
          xabarlar: [
            ...o.xabarlar,
            { id: yangiId(), kimdan: "men" as const, agentId, matn: toza, vaqt: Date.now() },
            { id: yangiId(), kimdan: "agent" as const, agentId, matn: t.javob, vaqt: Date.now() },
          ].slice(-400),
        }));
        setJamoa(t.jamoa);
        setChatAgent(agentId);
        setTab("ofis");
        if (yangiAgent) {
          setToast(`✨ Yangi agent yaratildi: ${yangiAgent.avatar} ${yangiAgent.ism} — ${jamoaById(t.jamoa).nom} jamoasi`);
        } else if (d.eslatma) {
          setToast(d.eslatma);
        }
      } catch {
        setToast("Server bilan aloqa yo'q");
      } finally {
        setBand(false);
      }
    },
    [band, ofis.agentlar, ofis.xabarlar],
  );

  const tasdiqla = (id: string, ha: boolean) => {
    setOfis((o) => {
      const v = o.vazifalar.find((x) => x.id === id);
      if (!v) return o;
      const vazifalar = o.vazifalar.map((x) => (x.id === id ? { ...x, holat: "bajarildi" as const } : x));
      const qolgan = vazifalar.some((x) => x.agentId === v.agentId && x.holat !== "bajarildi");
      return {
        ...o,
        vazifalar,
        agentlar: o.agentlar.map((a) => (a.id === v.agentId && !qolgan ? { ...a, holat: "bosh" } : a)),
        xabarlar: [
          ...o.xabarlar,
          {
            id: yangiId(),
            kimdan: "agent",
            agentId: v.agentId,
            matn: ha ? "Tasdiqlandi ✅ Bajaryapman." : "Bekor qilindi. Boshqa variant kerak bo'lsa, ayting.",
            vaqt: Date.now(),
          },
        ],
      };
    });
  };

  // ---------- ovoz ----------
  const ovozniBoshla = (maqsad: "buyruq" | "chat") => {
    const w = window as unknown as { SpeechRecognition?: new () => Tanish; webkitSpeechRecognition?: new () => Tanish };
    const Klass = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Klass) {
      setToast("Bu brauzer ovozni tanimaydi. Chrome'dan foydalaning yoki yozib yuboring.");
      return;
    }
    const t = new Klass();
    t.lang = "uz-UZ";
    t.interimResults = true;
    t.continuous = false;
    let oxirgi = "";
    t.onresult = (e) => {
      oxirgi = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(" ");
      setOvoz((o) => ({ ...o, matn: oxirgi }));
    };
    t.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setToast("Mikrofon xatosi: " + e.error);
    };
    t.onend = () => {
      setOvoz((o) => ({ ...o, faol: false }));
      tanishRef.current = null;
      if (oxirgi.trim()) {
        if (maqsad === "chat" && chatAgent) topshir(oxirgi, { agentId: chatAgent });
        else topshir(oxirgi, { jamoa: jamoa ?? undefined });
      }
    };
    tanishRef.current = t;
    setOvoz({ faol: true, matn: "", maqsad });
    try {
      t.start();
    } catch {
      setOvoz((o) => ({ ...o, faol: false }));
    }
  };

  const ovozniTugat = () => tanishRef.current?.stop();

  // ---------- kamera ----------
  const asosiyMasshtab = Math.min(ekran.w / (W * 1.5), (ekran.h - 120) / (W * 0.82));
  const panelChap = jamoa && tab === "ofis" && ekran.w > 720;
  const panelOng = chatAgent && tab === "ofis" && ekran.w > 720;
  const fokus = jamoa ? xonaKoordinata(jamoa) : null;
  const masshtab = fokus ? asosiyMasshtab * 2.1 : asosiyMasshtab;
  const dx = fokus ? W / 2 - (fokus.x + R / 2) : 0;
  const dy = fokus ? W / 2 - (fokus.y + R / 2) : 0;
  const kameraX = (panelChap ? 190 : 0) - (panelOng ? 200 : 0);
  const kameraY = ekran.w <= 720 && (jamoa || chatAgent) ? -ekran.h * 0.22 : -20;

  const agentlarJamoada = useMemo(() => {
    const m = new Map<JamoaId, Agent[]>();
    for (const a of ofis.agentlar) m.set(a.jamoa, [...(m.get(a.jamoa) ?? []), a]);
    return m;
  }, [ofis.agentlar]);

  const ishlayotgan = ofis.agentlar.filter((a) => a.holat === "ishlamoqda").length;
  const tanlanganJamoa = jamoa ? jamoaById(jamoa) : null;
  const chatAgentObj = ofis.agentlar.find((a) => a.id === chatAgent) ?? null;
  const markaz = W / 2;

  return (
    <div className={s.ekran}>
      {/* ---------- 3D ofis ---------- */}
      <div className={s.kamera} style={{ transform: `translate(${kameraX}px, ${kameraY}px)` }}>
        <div
          className={s.dunyo}
          style={{
            width: W,
            height: W,
            marginLeft: -W / 2,
            marginTop: -W / 2,
            transform: `scale(${masshtab}) rotateX(60deg) rotateZ(-45deg) translate(${dx}px, ${dy}px)`,
          }}
        >
          <div className={s.pol} onClick={() => setJamoa(null)} />

          <svg className={s.chiziqlar} width={W} height={W} viewBox={`0 0 ${W} ${W}`}>
            {JAMOALAR.map((j) => {
              const { x, y } = xonaKoordinata(j.id);
              const faol = agentlarJamoada.get(j.id)?.some((a) => a.holat === "ishlamoqda");
              return (
                <line
                  key={j.id}
                  x1={markaz}
                  y1={markaz}
                  x2={x + R / 2}
                  y2={y + R / 2}
                  stroke={j.rang}
                  className={`${s.chiziq} ${faol ? s.chiziqFaol : ""}`}
                />
              );
            })}
          </svg>

          {/* miya */}
          {[300, 220, 150].map((d) => (
            <div
              key={d}
              className={s.miyaHalqa}
              style={{ width: d, height: d, left: markaz - d / 2, top: markaz - d / 2 }}
            />
          ))}
          <div className={s.miyaPlatforma} style={{ width: 260, height: 260, left: markaz - 130, top: markaz - 130 }} />
          <div className={s.anchor} style={{ left: markaz, top: markaz }}>
            <div className={s.tik}>
              <div className={s.nur} />
              <div className={s.tikIchi}>
                <div className={s.xonaYorliq} style={{ ...rangi("#7cc4ff"), marginBottom: 10 }}>
                  🧠 Miya <small>{ofis.eslatmalar.length} eslatma · umumiy xotira</small>
                </div>
                <div className={`${s.shar} ${band ? s.sharBand : ""}`} onClick={() => setTab("miya")} />
              </div>
            </div>
          </div>

          {/* yo'laklarda yurib yurgan xodimlar */}
          {YURUVCHILAR.map((y, i) => (
            <div key={i} className={`${s.anchor} ${s.yol} ${s["yol" + y.yol]}`} style={{ animationDelay: `${y.kechik}s`, animationDuration: `${y.muddat}s` }}>
              <div className={s.tik}>
                <div className={s.tikIchi}>
                  <div className={`${s.burilish} ${s["burilish" + y.yol]}`} style={{ animationDelay: `${y.kechik}s`, animationDuration: `${y.muddat}s` }}>
                    <YuruvchiOdam q={qiyofa("yuruvchi" + i, y.rang)} kepkaRang={y.rang} />
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* xonalar */}
          {JAMOALAR.map((j) => {
            const { x, y } = xonaKoordinata(j.id);
            const agentlar = agentlarJamoada.get(j.id) ?? [];
            return (
              <div
                key={j.id}
                className={`${s.xona} ${jamoa === j.id ? s.xonaTanlangan : ""}`}
                style={{ ...rangi(j.rang), left: x, top: y, width: R, height: R }}
                onClick={(e) => {
                  e.stopPropagation();
                  setJamoa(j.id);
                  setTab("ofis");
                }}
              >
                <div className={s.xonaPol} />
                <div className={s.gilam} style={{ left: 40, top: 50, width: R - 70, height: R - 80 }} />
                <div className={s.devorOrqa} style={{ width: R, height: DEVOR }}>
                  <div className={s.deraza} style={{ left: 40 }} />
                  <div className={s.deraza} style={{ left: 110 }} />
                  <div className={s.javon} style={{ left: 210 }} />
                </div>
                <div className={s.devorChap} style={{ width: DEVOR, height: R }}>
                  <div className={s.deraza} style={{ left: 14, top: 120, width: 34, height: 54 }} />
                </div>

                {STOLLAR.map(([sx, sy], i) => {
                  const a = agentlar[i];
                  if (!a && i >= Math.max(2, agentlar.length)) return null;
                  return (
                    <div key={i}>
                      <div className={s.stol} style={{ left: sx, top: sy }}>
                        <div className={s.stolUst} />
                        <div className={s.stolOld} />
                        <div className={s.stolYon} />
                        <div className={s.monitor}>
                          <div className={`${s.monitorEkran} ${a?.holat === "ishlamoqda" ? s.monitorYonik : ""}`} />
                        </div>
                      </div>
                      {!a && <div className={s.stul} style={{ left: sx + 23, top: sy + 52 }} />}
                      {a && (
                        <div className={s.anchor} style={{ left: sx + 34, top: sy + 66 }}>
                          <div className={s.tik}>
                            <div
                              className={`${s.tikIchi} ${s.agent} ${a.yangi ? s.agentYangi : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setJamoa(a.jamoa);
                                setChatAgent(a.id);
                                setTab("ofis");
                              }}
                            >
                              {a.holat === "ishlamoqda" && <div className={s.pufak}>•••</div>}
                              {a.holat === "tasdiq" && <div className={s.pufak}>✋</div>}
                              <div className={s.agentNom}>
                                <i
                                  className={`${s.nuqta} ${
                                    a.holat === "ishlamoqda" ? s.nuqtaIshda : a.holat === "tasdiq" ? s.nuqtaTasdiq : ""
                                  }`}
                                />
                                {a.ism}
                              </div>
                              <OtirganOdam q={qiyofa(a.id + a.ism, j.rang)} ishda={a.holat === "ishlamoqda"} kepkaRang={j.rang} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className={s.anchor} style={{ left: R - 40, top: R - 30 }}>
                  <div className={s.tik}>
                    <div className={s.tikIchi} style={{ fontSize: 30 }}>
                      🪴
                    </div>
                  </div>
                </div>

                <div className={s.anchor} style={{ left: 30, top: 30 }}>
                  <div className={s.tik}>
                    <div className={s.tikIchi} style={{ bottom: DEVOR + 10 }}>
                      <div className={s.xonaYorliq}>
                        {j.belgi} {j.nom} <small>{agentlar.length} agent</small>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------- yuqori panel ---------- */}
      <div className={s.ustPanel}>
        <div className={s.logo}>
          ● AI OFIS <span>· {foydalanuvchi || "mehmon"}</span>
        </div>
        <div className={s.tablar}>
          {(
            [
              ["ofis", "Ofis"],
              ["vazifalar", `Vazifalar ${ofis.vazifalar.length || ""}`],
              ["miya", "Miya"],
            ] as [Tab, string][]
          ).map(([k, nom]) => (
            <button key={k} className={`${s.tab} ${tab === k ? s.tabFaol : ""}`} onClick={() => setTab(k)}>
              {nom}
            </button>
          ))}
        </div>
        <div className={s.holatPill}>
          <i className={`${s.nuqta} ${ishlayotgan ? s.nuqtaIshda : ""}`} />
          {ofis.agentlar.length} agent · {ishlayotgan} ishlamoqda
        </div>
        {foydalanuvchi === null && (
          <Link href="/login" className={s.kirishLink} title="Kirgandan keyin agentlar Claude bilan ishlaydi">
            Kirish
          </Link>
        )}
      </div>

      {yuklandi && (
        <div className={s.intro}>
          <div>
            <h1>
              MENING <b>AI</b> OFISIM
            </h1>
            <div className={s.introSub}>
              8 JAMOA · {ofis.agentlar.length} AGENT · 1 MIYA
            </div>
          </div>
        </div>
      )}

      {/* ---------- jamoa paneli ---------- */}
      {tab === "ofis" && tanlanganJamoa && (
        <JamoaPaneli
          jamoa={tanlanganJamoa}
          agentlar={agentlarJamoada.get(tanlanganJamoa.id) ?? []}
          vazifalar={ofis.vazifalar.filter((v) => v.jamoa === tanlanganJamoa.id)}
          yop={() => {
            setJamoa(null);
            setChatAgent(null);
          }}
          agentniOch={(id) => setChatAgent(id)}
          yashirin={ekran.w <= 720 && !!chatAgent}
        />
      )}

      {/* ---------- chat ---------- */}
      {tab === "ofis" && chatAgentObj && (
        <div className={`${s.panel} ${s.chatPanel}`} style={rangi(jamoaById(chatAgentObj.jamoa).rang)}>
          <div className={s.chatBosh}>
            <div className={s.miniAvatar}>{chatAgentObj.avatar}</div>
            <div>
              <b>{chatAgentObj.ism}</b>
              <small>
                {chatAgentObj.rol} · {jamoaById(chatAgentObj.jamoa).nom}
              </small>
            </div>
            <button className={s.yop} onClick={() => setChatAgent(null)} aria-label="Yopish">
              ✕
            </button>
          </div>
          <div className={s.xabarlar}>
            {ofis.xabarlar
              .filter((x) => x.agentId === chatAgentObj.id)
              .map((x) => (
                <div key={x.id} className={`${s.xabar} ${x.kimdan === "men" ? s.xabarMen : s.xabarAgent}`}>
                  <small>{x.kimdan === "men" ? "Siz" : chatAgentObj.ism}</small>
                  {x.matn}
                </div>
              ))}
            {ofis.vazifalar
              .filter((v) => v.agentId === chatAgentObj.id && v.holat === "jarayonda")
              .map((v) => (
                <div key={v.id} className={`${s.xabar} ${s.xabarAgent}`}>
                  <small>Bajaryapman</small>
                  <ul className={s.qadamlar}>
                    {v.qadamlar.map((q, i) => (
                      <li
                        key={i}
                        className={i < v.bosqich ? s.qadamTayyor : i === v.bosqich ? s.qadamHozir : undefined}
                      >
                        {i < v.bosqich ? "✓" : i === v.bosqich ? "▸" : "○"} {q}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            {!ofis.xabarlar.some((x) => x.agentId === chatAgentObj.id) && (
              <div className={s.bosh}>
                Salom! Men {chatAgentObj.ism}man. Ko&apos;nikmalarim: {chatAgentObj.konikmalar.join(", ") || "—"}.
                Vazifa bering.
              </div>
            )}
            <div ref={xabarOxiri} />
          </div>
          <form
            className={s.chatKirish}
            onSubmit={(e) => {
              e.preventDefault();
              topshir(chatMatn, { agentId: chatAgentObj.id });
              setChatMatn("");
            }}
          >
            <input
              value={chatMatn}
              onChange={(e) => setChatMatn(e.target.value)}
              placeholder={`${chatAgentObj.ism}ga yozing…`}
              disabled={band}
            />
            <button type="button" className={s.ikon} onClick={() => ovozniBoshla("chat")} aria-label="Ovoz">
              🎤
            </button>
            <button type="submit" className={`${s.ikon} ${s.ikonAsosiy}`} disabled={band} aria-label="Yuborish">
              ➤
            </button>
          </form>
        </div>
      )}

      {/* ---------- vazifalar taxtasi ---------- */}
      {tab === "vazifalar" && (
        <div className={`${s.panel} ${s.taxta}`}>
          <div className={s.panelBosh}>
            <div>
              <h2>Vazifalar taxtasi · bugun</h2>
              <p>Agentlar parallel ishlaydi — hech kim hech kimni kutmaydi</p>
            </div>
            <button className={s.yop} onClick={() => setTab("ofis")} aria-label="Yopish">
              ✕
            </button>
          </div>
          <div className={s.ustunlar}>
            {(
              [
                ["jarayonda", "⚡ Jarayonda"],
                ["tasdiq", "✋ Tasdiq kutmoqda"],
                ["bajarildi", "✅ Bajarildi"],
              ] as const
            ).map(([holat, nom]) => {
              const royxat = ofis.vazifalar.filter((v) => v.holat === holat);
              return (
                <div key={holat} className={s.ustun}>
                  <h3>
                    {nom} · {royxat.length}
                  </h3>
                  {!royxat.length && <div className={s.bosh}>Bo&apos;sh</div>}
                  {royxat.map((v) => {
                    const a = ofis.agentlar.find((x) => x.id === v.agentId);
                    const j = jamoaById(v.jamoa);
                    return (
                      <div
                        key={v.id}
                        className={s.karta}
                        style={rangi(j.rang)}
                        onClick={() => setOchiqNatija(ochiqNatija === v.id ? null : v.id)}
                      >
                        <p>{v.matn}</p>
                        <small>
                          {a?.avatar} {a?.ism ?? "Agent"} · {j.nom}
                          {holat === "jarayonda" && ` · ${v.bosqich + 1}/${v.qadamlar.length}`}
                          {v.manba === "claude" ? " · Claude" : ""}
                        </small>
                        {holat === "tasdiq" && (
                          <div className={s.kartaTugmalar}>
                            <button
                              className={s.ha}
                              onClick={(e) => {
                                e.stopPropagation();
                                tasdiqla(v.id, true);
                              }}
                            >
                              Tasdiqlash
                            </button>
                            <button
                              className={s.yoq}
                              onClick={(e) => {
                                e.stopPropagation();
                                tasdiqla(v.id, false);
                              }}
                            >
                              Rad etish
                            </button>
                          </div>
                        )}
                        {ochiqNatija === v.id && (
                          <div className={s.natija} onClick={(e) => e.stopPropagation()}>
                            {v.natija || v.qadamlar.map((q, i) => `${i + 1}. ${q}`).join("\n")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------- miya ---------- */}
      {tab === "miya" && (
        <div className={`${s.panel} ${s.taxta}`} style={{ width: "min(640px, calc(100vw - 32px))" }}>
          <div className={s.panelBosh}>
            <div className={s.panelBelgi} style={rangi("#7cc4ff")}>
              🧠
            </div>
            <div>
              <h2>Miya — umumiy xotira</h2>
              <p>Har bir bajarilgan ish shu yerga yoziladi, hech narsa unutilmaydi</p>
            </div>
            <button className={s.yop} onClick={() => setTab("ofis")} aria-label="Yopish">
              ✕
            </button>
          </div>
          {!ofis.eslatmalar.length && <div className={s.bosh}>Hali eslatma yo&apos;q. Birinchi vazifani bering!</div>}
          {ofis.eslatmalar.map((e) => (
            <div key={e.id} className={s.eslatma}>
              {jamoaById(e.jamoa).belgi} {e.matn}
              <small>
                {jamoaById(e.jamoa).nom} · {new Date(e.vaqt).toLocaleString("uz-UZ")}
              </small>
            </div>
          ))}
          <button
            className={s.tugma}
            style={{ background: "rgba(255,255,255,0.08)" }}
            onClick={() => {
              if (confirm("Ofisni boshlang'ich holatga qaytaraymi? Barcha vazifa va xabarlar o'chadi.")) {
                setOfis(BOSH_OFIS);
                setJamoa(null);
                setChatAgent(null);
              }
            }}
          >
            Ofisni tozalash
          </button>
        </div>
      )}

      {/* ---------- minixarita ---------- */}
      {tab === "ofis" && (
        <div className={s.xarita}>
          {[0, 1, 2].flatMap((r) =>
            [0, 1, 2].map((c) => {
              const j = JAMOALAR.find((x) => JOYLAR[x.id][0] === c && JOYLAR[x.id][1] === r);
              return (
                <button
                  key={`${c}${r}`}
                  title={j ? j.nom : "Miya"}
                  style={rangi(j ? j.rang : "#7cc4ff")}
                  onClick={() => {
                    setJamoa(j ? j.id : null);
                    if (!j) setChatAgent(null);
                  }}
                />
              );
            }),
          )}
        </div>
      )}

      {/* ---------- buyruq paneli ---------- */}
      <div className={s.buyruqQutisi}>
        {!buyruq && !band && tab === "ofis" && (
          <div className={s.misollar}>
            {MISOLLAR.map((m) => (
              <button key={m} className={s.misol} onClick={() => topshir(m, { jamoa: jamoa ?? undefined })}>
                {m}
              </button>
            ))}
          </div>
        )}
        <form
          className={s.buyruq}
          onSubmit={(e) => {
            e.preventDefault();
            topshir(buyruq, { jamoa: jamoa ?? undefined });
            setBuyruq("");
          }}
        >
          <input
            value={buyruq}
            onChange={(e) => setBuyruq(e.target.value)}
            placeholder={
              tanlanganJamoa
                ? `${tanlanganJamoa.nom} jamoasiga vazifa ayting…`
                : "Vazifa ayting — kerakli agentni o'zim topaman yoki yarataman…"
            }
            disabled={band}
          />
          {band && <span className={s.dispetcher}>Dispetcher o&apos;ylayapti…</span>}
          <button type="button" className={s.ikon} onClick={() => ovozniBoshla("buyruq")} aria-label="Ovoz bilan">
            🎤
          </button>
          <button type="submit" className={`${s.ikon} ${s.ikonAsosiy}`} disabled={band} aria-label="Yuborish">
            ➤
          </button>
        </form>
      </div>

      {/* ---------- ovoz rejimi ---------- */}
      {ovoz.faol && (
        <div className={s.ovoz} onClick={ovozniTugat}>
          <div className={s.ovozIchi}>
            <div className={s.ovozYorliq}>● OVOZ REJIMI · TINGLAYAPMAN</div>
            <div className={s.ovozShar} />
            <div className={s.ovozMatn}>{ovoz.matn || "Gapiring… masalan: «Drive'dagi klipdan reels yasab ber»"}</div>
            <button className={`${s.ikon} ${s.ikonYozmoqda}`} style={{ width: 56, height: 56 }} aria-label="To'xtatish">
              ■
            </button>
          </div>
        </div>
      )}

      {toast && <div className={s.toast}>{toast}</div>}
    </div>
  );
}

function JamoaPaneli({
  jamoa,
  agentlar,
  vazifalar,
  yop,
  agentniOch,
  yashirin,
}: {
  jamoa: ReturnType<typeof jamoaById>;
  agentlar: Agent[];
  vazifalar: Vazifa[];
  yop: () => void;
  agentniOch: (id: string) => void;
  yashirin: boolean;
}) {
  if (yashirin) return null;
  const ishda = agentlar.filter((a) => a.holat === "ishlamoqda").length;
  const tugagan = vazifalar.filter((v) => v.tugadi);
  const ortacha = tugagan.length
    ? Math.round(tugagan.reduce((t, v) => t + (v.tugadi! - v.vaqt), 0) / tugagan.length / 1000)
    : 0;
  const ishlatilgan = (k: string) => agentlar.filter((a) => a.konikmalar.includes(k)).length;
  const barchaKonikmalar = Array.from(new Set([...jamoa.konikmalar, ...agentlar.flatMap((a) => a.konikmalar)]));

  return (
    <div className={`${s.panel} ${s.jamoaPanel}`} style={rangi(jamoa.rang)}>
      <div className={s.panelBosh}>
        <div className={s.panelBelgi}>{jamoa.belgi}</div>
        <div>
          <h2>{jamoa.nom} jamoasi</h2>
          <p>
            {agentlar.length} agent · {jamoa.tavsif}
          </p>
        </div>
        <button className={s.yop} onClick={yop} aria-label="Yopish">
          ✕
        </button>
      </div>

      <div className={s.korsatkichlar}>
        <div className={s.korsatkich}>
          <small>Vazifalar</small>
          <b>{vazifalar.length}</b>
        </div>
        <div className={s.korsatkich}>
          <small>Ishlamoqda</small>
          <b>{ishda}</b>
        </div>
        <div className={s.korsatkich}>
          <small>O&apos;rtacha</small>
          <b>{ortacha ? `${ortacha}s` : "—"}</b>
        </div>
      </div>

      <div className={s.bolimNom}>
        Ulangan vositalar <em>● ulangan</em>
      </div>
      <div className={s.vositalar}>
        {jamoa.vositalar.map((v) => (
          <div key={v} className={s.vosita}>
            {v}
            <small>● ulangan</small>
          </div>
        ))}
      </div>

      <div className={s.bolimNom}>
        Ko&apos;nikmalar {ishda > 0 && <em>{ishda} ta parallel ishlamoqda</em>}
      </div>
      {barchaKonikmalar.slice(0, 8).map((k) => {
        const b = ballar(k, ishlatilgan(k));
        return (
          <div key={k} className={s.konikma}>
            <span style={{ textAlign: "left", color: "#c9cdea", fontSize: 12 }}>● {k}</span>
            <i style={{ "--w": `${b}%` } as CSSProperties} />
            <span>{b}%</span>
          </div>
        );
      })}

      <div className={s.bolimNom}>Agentlar</div>
      {agentlar.map((a) => (
        <button key={a.id} className={s.agentQator} onClick={() => agentniOch(a.id)}>
          <div className={s.miniAvatar}>{a.avatar}</div>
          <div>
            <b>
              {a.ism}
              {a.yangi && <span className={`${s.belgi} ${s.belgiYangi}`}>yangi</span>}
            </b>
            <small>{a.rol}</small>
          </div>
          <span
            className={`${s.belgi} ${
              a.holat === "ishlamoqda" ? s.belgiIshda : a.holat === "tasdiq" ? s.belgiTasdiq : ""
            }`}
          >
            {a.holat === "ishlamoqda" ? "ishlamoqda" : a.holat === "tasdiq" ? "tasdiq kerak" : "bo'sh"}
          </span>
        </button>
      ))}
    </div>
  );
}
