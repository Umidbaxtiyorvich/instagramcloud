"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./ofis.css";
import dynamic from "next/dynamic";

// WebGL sahna faqat brauzerda yuklanadi
import MoliyaPanel, { pul } from "./MoliyaPanel";
import UlanishPanel from "./UlanishPanel";

const Sahna3D = dynamic(() => import("./Sahna3D"), {
  ssr: false,
  loading: () => <div className="o_yuklanmoqda">3D ofis yuklanmoqda…</div>,
});
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

const MAKS_AGENT = 6; // bir xonadagi stollar soni

// minixarita uchun xonalar joylashuvi (ustun, qator)
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

const MISOLLAR = [
  "Instagram statistikasidan hisobot ber",
  "Oxirgi kommentlarni ko'rib chiq",
  "Direct'da nimalar so'ralyapti?",
  "Avto-javob qoidalarimni ko'rsat",
  "Bugungi kirim-chiqimni ko'rsat",
  "Telegram botga kelgan to'lovlar",
  "Tovar qoldiqlari",
  "Xaridorlar qarzi",
  "Drive'dagi 3 ta yangi klipdan 30 soniyalik reels yasab ber",
  "Ertangi Instagram postlarini rejalashtir",
  "Raqobatchilarimizning narxlarini o'rganib chiq",
  "Mijozga chegirma haqida taklif xati yoz",
  "Shu oygi xarajatlarni hisobla",
  "O'tgan haftaning statistikasidan hisobot tayyorla",
];

type IgAkkaunt = { id: string; username: string; followersCount: number; isDemo: boolean };
type IgTasdiq = { id: string; summary: string; toolName: string; createdAt: string };
type IgLog = { kind: string; direction: string; username: string | null; text: string; replyText: string | null; createdAt: string };

type Eslatma = { id: string; matn: string; jamoa: JamoaId; vaqt: number };
type Ofis = { agentlar: Agent[]; vazifalar: Vazifa[]; xabarlar: Xabar[]; eslatmalar: Eslatma[] };
type Tab = "ofis" | "vazifalar" | "miya" | "moliya" | "ulanishlar";

const KALIT = "ai-ofis-v1";
const BOSH_OFIS: Ofis = { agentlar: BOSHLANGICH_AGENTLAR, vazifalar: [], xabarlar: [], eslatmalar: [] };

const birinchiBelgi = (s: string) => {
  const seg = new Intl.Segmenter("uz", { granularity: "grapheme" }).segment(s.trim())[Symbol.iterator]().next();
  return seg.done ? "🤖" : seg.value.segment;
};
const yangiId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const rangi = (r: string) => ({ "--r": r }) as CSSProperties;


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
  // MCP OAuth'dan qaytganda (?ulanish=...) — Ulanishlar oynasi natija bilan ochiladi
  const [ulanishXabar, setUlanishXabar] = useState<string | null>(null);
  useEffect(() => {
    const x = new URLSearchParams(window.location.search).get("ulanish");
    if (!x) return;
    const t = setTimeout(() => {
      setUlanishXabar(x);
      setTab("ulanishlar");
      window.history.replaceState(null, "", "/ofis");
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const [jamoa, setJamoa] = useState<JamoaId | null>(null);
  const [chatAgent, setChatAgent] = useState<string | null>(null);
  const [buyruq, setBuyruq] = useState("");
  const [chatMatn, setChatMatn] = useState("");
  const [band, setBand] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ochiqNatija, setOchiqNatija] = useState<string | null>(null);
  const [ekran, setEkran] = useState({ w: 1280, h: 800 });
  const [foydalanuvchi, setFoydalanuvchi] = useState<string | null | undefined>(undefined);
  const [igAkkaunt, setIgAkkaunt] = useState<IgAkkaunt | null>(null);
  const [igTasdiqlar, setIgTasdiqlar] = useState<IgTasdiq[]>([]);
  const [jonli, setJonli] = useState<Record<string, number>>({});
  const [moliyaHolat, setMoliyaHolat] = useState<{ cloudshop: boolean; bot: boolean } | null>(null);
  const [ovoz, setOvoz] = useState<{ faol: boolean; matn: string; maqsad: "buyruq" | "chat" }>({
    faol: false,
    matn: "",
    maqsad: "buyruq",
  });
  const [yangiAgentlar, setYangiAgentlar] = useState<Set<string>>(() => new Set());
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
      .then((d) => {
        setFoydalanuvchi(d.user ? d.user.name || d.user.email : null);
        const a = d.user?.accounts?.[0];
        if (a) setIgAkkaunt({ id: a.id, username: a.username, followersCount: a.followersCount, isDemo: a.isDemo });
      })
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

  // Instagram Cloud tasdiq navbati (ofisdan ham, AI-konnektordan ham kelganlar)
  const tasdiqlarniYangila = useCallback(() => {
    fetch("/api/approvals")
      .then((r) => (r.ok ? r.json() : { approvals: [] }))
      .then((d: { approvals: (IgTasdiq & { status: string })[] }) =>
        setIgTasdiqlar(d.approvals.filter((a) => a.status === "pending").map(({ id, summary, toolName, createdAt }) => ({ id, summary, toolName, createdAt }))),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!foydalanuvchi) return;
    const boshla = setTimeout(tasdiqlarniYangila, 0);
    const t = setInterval(tasdiqlarniYangila, 15000);
    return () => {
      clearTimeout(boshla);
      clearInterval(t);
    };
  }, [foydalanuvchi, tasdiqlarniYangila]);

  // Instagram avto-javoblari: yangi javob chiqsa, mos agent bir necha soniya "ishlaydi"
  const oxirgiLog = useRef<string | null>(null);
  useEffect(() => {
    if (!igAkkaunt) return;
    const tekshir = async () => {
      try {
        const d = (await (await fetch(`/api/logs?accountId=${igAkkaunt.id}`)).json()) as { logs: IgLog[] };
        const loglar = d.logs ?? [];
        if (oxirgiLog.current === null) {
          oxirgiLog.current = loglar[0]?.createdAt ?? "";
          return;
        }
        const yangi = loglar.filter((l) => l.createdAt > oxirgiLog.current! && l.direction === "out");
        if (loglar[0]) oxirgiLog.current = loglar[0].createdAt;
        if (!yangi.length) return;
        const vaqt = Date.now() + 5000;
        setOfis((o) => {
          const kim = (jamoa: JamoaId, konikma: string) =>
            o.agentlar.find((a) => a.jamoa === jamoa && a.konikmalar.includes(konikma)) ?? o.agentlar.find((a) => a.jamoa === jamoa);
          const ishchilar: Record<string, number> = {};
          const eslatmalar = yangi.map((l) => {
            const dm = l.kind.startsWith("dm");
            const a = dm ? kim("mijozlar", "savolga-javob") : kim("ijtimoiy", "komment-javob");
            if (a) ishchilar[a.id] = vaqt;
            return {
              id: yangiId(),
              matn: `🤖 Avto-javob (${dm ? "Direct" : "komment"})${l.username ? ` @${l.username}` : ""}: «${(l.replyText || l.text).slice(0, 80)}»`,
              jamoa: (dm ? "mijozlar" : "ijtimoiy") as JamoaId,
              vaqt: Date.now(),
            };
          });
          setJonli((j) => ({ ...j, ...ishchilar }));
          return { ...o, eslatmalar: [...eslatmalar, ...o.eslatmalar].slice(0, 200) };
        });
      } catch {}
    };
    const boshla = setTimeout(tekshir, 0);
    const t = setInterval(tekshir, 10000);
    return () => {
      clearTimeout(boshla);
      clearInterval(t);
    };
  }, [igAkkaunt]);

  // Telegram to'lov botiga yangi chek kelsa — Hisobchi ishlaydi va Miya'ga yoziladi
  const korilganCheklar = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!foydalanuvchi) return;
    const tekshir = async () => {
      try {
        // davr to'lov sanasi bo'yicha: bugun kelgan chekdagi to'lov kechagi bo'lishi mumkin
        const d = (await (await fetch("/api/ofis/moliya?bolim=tolovlar&davr=oy")).json()) as {
          ruxsat?: boolean;
          holat?: { cloudshop: boolean; bot: boolean };
          data?: { rows: { id: string; summa: number; tolovchi: string; yubordi: string; guruh: string }[] };
        };
        if (d.ruxsat && d.holat) setMoliyaHolat(d.holat);
        if (!d.ruxsat || !d.data) return;
        const rows = d.data.rows;
        if (korilganCheklar.current === null) {
          korilganCheklar.current = new Set(rows.map((r) => r.id));
          return;
        }
        const yangi = rows.filter((r) => !korilganCheklar.current!.has(r.id));
        yangi.forEach((r) => korilganCheklar.current!.add(r.id));
        if (!yangi.length) return;
        setOfis((o) => {
          const a = o.agentlar.find((x) => x.jamoa === "moliya");
          if (a) setJonli((j) => ({ ...j, [a.id]: Date.now() + 6000 }));
          return {
            ...o,
            eslatmalar: [
              ...yangi.map((r) => ({
                id: yangiId(),
                matn: `📲 Telegram botga to'lov cheki: ${r.summa ? `${pul(r.summa)} so'm` : "summa aniqlanmoqda"} — ${r.tolovchi || r.yubordi || "?"}${r.guruh ? ` (${r.guruh})` : ""}`,
                jamoa: "moliya" as JamoaId,
                vaqt: Date.now(),
              })),
              ...o.eslatmalar,
            ].slice(0, 200),
          };
        });
      } catch {}
    };
    const boshla = setTimeout(tekshir, 0);
    const t = setInterval(tekshir, 30000);
    return () => {
      clearTimeout(boshla);
      clearInterval(t);
    };
  }, [foydalanuvchi]);

  // jonli ish muddati tugagach agentni bo'shatamiz
  useEffect(() => {
    const qolgan = Object.values(jonli);
    if (!qolgan.length) return;
    const t = setTimeout(() => {
      const hozir = Date.now();
      setJonli((j) => Object.fromEntries(Object.entries(j).filter(([, v]) => v > hozir)));
    }, Math.max(200, Math.min(...qolgan) - Date.now()));
    return () => clearTimeout(t);
  }, [jonli]);

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
          tasdiqKerak: t.tasdiqKerak || !!t.instagram?.tasdiqlar.length,
          amallar: t.instagram?.amallar,
          tasdiqlar: t.instagram?.tasdiqlar,
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
            {
              id: yangiId(),
              kimdan: "agent" as const,
              agentId,
              matn:
                t.javob +
                (t.instagram?.amallar.length ? `\n\n🔗 Manba: ${t.instagram.amallar.join(" · ")}` : "") +
                (t.instagram?.tasdiqlar.length
                  ? `\n✋ Tasdiqingizni kutadi:\n${t.instagram.tasdiqlar.map((x) => `• ${x.summary}`).join("\n")}`
                  : ""),
              vaqt: Date.now(),
            },
          ].slice(-400),
        }));
        if (t.instagram?.tasdiqlar.length) tasdiqlarniYangila();
        setJamoa(t.jamoa);
        setChatAgent(agentId);
        setTab("ofis");
        if (yangiAgent) {
          const id = yangiAgent.id;
          setYangiAgentlar((s) => new Set(s).add(id));
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
    [band, ofis.agentlar, ofis.xabarlar, tasdiqlarniYangila],
  );

  // Instagram Cloud tasdig'i: «Ha» bo'lsa harakat haqiqatan Instagramga yuboriladi
  const igQaror = async (id: string, ha: boolean) => {
    const r = await fetch("/api/approvals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, decision: ha ? "approve" : "reject" }),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string; result?: { demo?: boolean } };
    if (!r.ok) throw new Error(d.error || "Instagram xatosi");
    return d.result?.demo ? " (demo akkaunt)" : "";
  };

  const tasdiqla = async (id: string, ha: boolean) => {
    const v = ofis.vazifalar.find((x) => x.id === id);
    if (!v) return;
    let matn = ha ? "Tasdiqlandi ✅ Bajaryapman." : "Bekor qilindi. Boshqa variant kerak bo'lsa, ayting.";
    if (v.tasdiqlar?.length) {
      const natijalar = await Promise.all(
        v.tasdiqlar.map((x) =>
          igQaror(x.id, ha)
            .then((demo) => `${ha ? "✅" : "🚫"} ${x.summary}${demo}`)
            .catch((e: Error) => `⚠️ ${x.summary} — ${e.message}`),
        ),
      );
      matn = (ha ? "Instagram'ga yuborildi:\n" : "Rad etildi, hech narsa yuborilmadi:\n") + natijalar.join("\n");
      tasdiqlarniYangila();
    }
    setOfis((o) => {
      const vazifalar = o.vazifalar.map((x) => (x.id === id ? { ...x, holat: "bajarildi" as const } : x));
      const qolgan = vazifalar.some((x) => x.agentId === v.agentId && x.holat !== "bajarildi");
      return {
        ...o,
        vazifalar,
        agentlar: o.agentlar.map((a) => (a.id === v.agentId && !qolgan ? { ...a, holat: "bosh" } : a)),
        xabarlar: [...o.xabarlar, { id: yangiId(), kimdan: "agent", agentId: v.agentId, matn, vaqt: Date.now() }],
      };
    });
  };

  // AI-konnektor (Claude/ChatGPT) yoki boshqa joydan kelgan tasdiqlar
  const ofisTasdiqIdlari = new Set(ofis.vazifalar.flatMap((v) => v.tasdiqlar?.map((x) => x.id) ?? []));
  const tashqiTasdiqlar = igTasdiqlar.filter((x) => !ofisTasdiqIdlari.has(x.id));
  const tashqiQaror = async (x: IgTasdiq, ha: boolean) => {
    try {
      const demo = await igQaror(x.id, ha);
      setToast(`${ha ? "✅ Yuborildi" : "🚫 Rad etildi"}: ${x.summary}${demo}`);
    } catch (e) {
      setToast(`⚠️ ${e instanceof Error ? e.message : "Xato"}`);
    }
    tasdiqlarniYangila();
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

  // ---------- kamera: panellar ochiq bo'lsa xonani bo'sh joyga suramiz ----------
  const panelChap = jamoa && tab === "ofis" && ekran.w > 720;
  const panelOng = chatAgent && tab === "ofis" && ekran.w > 720;
  const surish = (panelChap ? 190 : 0) - (panelOng ? 200 : 0);

  const agentlarJamoada = useMemo(() => {
    const m = new Map<JamoaId, Agent[]>();
    for (const a of ofis.agentlar) m.set(a.jamoa, [...(m.get(a.jamoa) ?? []), a]);
    return m;
  }, [ofis.agentlar]);

  const sahnaAgentlari = useMemo(
    () => ofis.agentlar.map((a) => (jonli[a.id] && a.holat === "bosh" ? { ...a, holat: "ishlamoqda" as const } : a)),
    [ofis.agentlar, jonli],
  );
  const ishlayotgan = ofis.agentlar.filter((a) => a.holat === "ishlamoqda").length;
  const tanlanganJamoa = jamoa ? jamoaById(jamoa) : null;
  const chatAgentObj = ofis.agentlar.find((a) => a.id === chatAgent) ?? null;

  return (
    <div className={s.ekran}>
      {/* ---------- 3D ofis (WebGL) ---------- */}
      <Sahna3D
        agentlar={sahnaAgentlari}
        jamoa={tab === "ofis" ? jamoa : null}
        band={band}
        eslatmaSoni={ofis.eslatmalar.length}
        yangiAgentlar={yangiAgentlar}
        surish={surish}
        onXona={(id) => {
          setJamoa(id);
          setTab("ofis");
        }}
        onAgent={(a) => {
          setJamoa(a.jamoa);
          setChatAgent(a.id);
          setTab("ofis");
        }}
        onMiya={() => setTab("miya")}
        onBosh={() => {
          setJamoa(null);
          setChatAgent(null);
        }}
      />

      {/* ---------- yuqori panel ---------- */}
      <div className={s.ustPanel}>
        <div className={s.logo}>
          ● AI OFIS <span>· {foydalanuvchi || "mehmon"}</span>
        </div>
        <div className={s.tablar}>
          {(
            [
              ["ofis", "Ofis"],
              ["vazifalar", `Vazifalar ${ofis.vazifalar.length || ""}${tashqiTasdiqlar.length ? ` · ✋${tashqiTasdiqlar.length}` : ""}`],
              ["moliya", "💰 Moliya"],
              ["ulanishlar", "🔌 Ulanishlar"],
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
        {foydalanuvchi && (
          <Link href="/dashboard" className={s.kirishLink} title="Instagram Cloud kabineti">
            📸 {igAkkaunt ? `@${igAkkaunt.username}` : "Kabinet"}
          </Link>
        )}
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
          moliyaniOch={() => setTab("moliya")}
          moliyaHolat={moliyaHolat}
          instagram={igAkkaunt}
          kirgan={!!foydalanuvchi}
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
                    {nom} · {royxat.length + (holat === "tasdiq" ? tashqiTasdiqlar.length : 0)}
                  </h3>
                  {!royxat.length && !(holat === "tasdiq" && tashqiTasdiqlar.length) && (
                    <div className={s.bosh}>Bo&apos;sh</div>
                  )}
                  {holat === "tasdiq" &&
                    tashqiTasdiqlar.map((x) => (
                      <div key={x.id} className={s.karta} style={rangi("#ff4d8d")}>
                        <p>{x.summary}</p>
                        <small>📸 Instagram Cloud · AI-konnektordan · {new Date(x.createdAt).toLocaleString("uz-UZ")}</small>
                        <div className={s.kartaTugmalar}>
                          <button className={s.ha} onClick={() => tashqiQaror(x, true)}>
                            Tasdiqlash
                          </button>
                          <button className={s.yoq} onClick={() => tashqiQaror(x, false)}>
                            Rad etish
                          </button>
                        </div>
                      </div>
                    ))}
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
                        {!!v.amallar?.length && <small className={s.igAmal}>🔗 {v.amallar.join(" · ")}</small>}
                        {!!v.tasdiqlar?.length && holat === "tasdiq" && (
                          <small className={s.igAmal}>✋ {v.tasdiqlar.map((x) => x.summary).join(" · ")}</small>
                        )}
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

      {/* ---------- moliya (CloudShop + Telegram bot) ---------- */}
      {tab === "moliya" && <MoliyaPanel yop={() => setTab("ofis")} kirgan={!!foydalanuvchi} />}

      {/* ---------- ulanishlar (MCP) ---------- */}
      {tab === "ulanishlar" && (
        <UlanishPanel
          yop={() => {
            setUlanishXabar(null);
            setTab("ofis");
          }}
          kirgan={!!foydalanuvchi}
          xabar={ulanishXabar}
        />
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
  moliyaniOch,
  moliyaHolat,
  instagram,
  kirgan,
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
  instagram: IgAkkaunt | null;
  kirgan: boolean;
  moliyaniOch: () => void;
  moliyaHolat: { cloudshop: boolean; bot: boolean } | null;
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

      {jamoa.id === "moliya" && (
        <button className={s.tugma} style={{ marginTop: 0, marginBottom: 12 }} onClick={moliyaniOch}>
          💰 Kirim-chiqim, tovarlar va pullar tarixi
        </button>
      )}

      <div className={s.bolimNom}>
        Ulangan vositalar <em>● ulangan</em>
      </div>
      <div className={s.vositalar}>
        {jamoa.vositalar.map((v) =>
          v.startsWith("Instagram") ? (
            instagram ? (
              <a key={v} className={s.vosita} href="/dashboard">
                {v}
                <small>
                  ● @{instagram.username}
                  {instagram.isDemo ? " · demo" : ""}
                </small>
              </a>
            ) : (
              <a key={v} className={s.vosita} href={kirgan ? "/connect/instagram" : "/login"}>
                {v}
                <small className={s.ulanmagan}>○ {kirgan ? "ulash" : "kirish kerak"}</small>
              </a>
            )
          ) : v === "CloudShop" || v.startsWith("Telegram bot") ? (
            <div key={v} className={s.vosita}>
              {v}
              {(v === "CloudShop" ? moliyaHolat?.cloudshop : moliyaHolat?.bot) ? (
                <small>● ulangan</small>
              ) : (
                <small className={s.ulanmagan}>○ {moliyaHolat ? "sozlanmagan" : "kirish kerak"}</small>
              )}
            </div>
          ) : (
            <div key={v} className={s.vosita}>
              {v}
              <small>● ulangan</small>
            </div>
          ),
        )}
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
