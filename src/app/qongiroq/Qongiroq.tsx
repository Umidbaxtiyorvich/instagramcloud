"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import "./qongiroq.css";

type Gap = { kim: "miya" | "men"; matn: string };
type Q = { id: string; kalit: string; yonalish: string; holat: string; sabab: string; fikrId: string | null; tugat: boolean; suhbat: Gap[] };
type Holat = "yuklanmoqda" | "kirish" | "kelyapti" | "kutish" | "gapiryapti" | "eshityapti" | "oylayapti" | "tugadi" | "xato";

const HOLAT_MATN: Partial<Record<Holat, string>> = {
  gapiryapti: "🧠 Miya gapiryapti…",
  eshityapti: "🎙 Eshityapman — gapiring",
  oylayapti: "💭 O'ylayapman…",
  kutish: "Gapirish uchun mikrofonni bosing",
  tugadi: "Qo'ng'iroq tugadi",
};

// Brauzer qo'llaydigan ovoz formati (iPhone — mp4, boshqalar — webm)
function ovozTuri() {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

// Telegram botidagi havolada kirish kaliti bo'ladi (t) — saytga kirmasdan ishlaydi
const sarlavha = (t: string): Record<string, string> => (t ? { "x-qongiroq": t } : {});

async function api(body: unknown, t: string): Promise<Q> {
  const r = await fetch("/api/telefon/web", {
    method: "POST",
    ...(body instanceof FormData
      ? { body, headers: sarlavha(t) }
      : { headers: { "Content-Type": "application/json", ...sarlavha(t) }, body: JSON.stringify(body) }),
  });
  const j = (await r.json().catch(() => ({}))) as { qongiroq?: Q; error?: string };
  if (!r.ok || !j.qongiroq) throw new Error(j.error || `HTTP ${r.status}`);
  return j.qongiroq;
}

export default function Qongiroq() {
  const params = useSearchParams();
  const qId = params.get("q");
  const t = params.get("t") ?? "";
  const [q, setQ] = useState<Q | null>(null);
  const [holat, setHolat] = useState<Holat>("yuklanmoqda");
  const [xato, setXato] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const oqim = useRef<MediaStream | null>(null);
  const yozish = useRef<{ stop: (yubor: boolean) => void } | null>(null);
  const tugadi = useRef(false);
  const pastki = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let bekor = false;
    (async () => {
      if (!qId) {
        const r = await fetch("/api/me").catch(() => null);
        if (!bekor) setHolat(r?.ok ? "kutish" : "kirish");
        return;
      }
      const r = await fetch(`/api/telefon/web?q=${encodeURIComponent(qId)}`, { headers: sarlavha(t) });
      if (bekor) return;
      if (r.status === 401) return setHolat("kirish");
      const j = (await r.json().catch(() => ({}))) as { qongiroq?: Q; error?: string };
      if (!j.qongiroq) {
        setXato(j.error ?? "Qo'ng'iroq topilmadi");
        return setHolat("xato");
      }
      setQ(j.qongiroq);
      setHolat(["boshlandi", "javobsiz"].includes(j.qongiroq.holat) ? "kelyapti" : ["tugadi", "xato"].includes(j.qongiroq.holat) ? "tugadi" : "kutish");
    })();
    return () => {
      bekor = true;
    };
  }, [qId, t]);

  useEffect(() => {
    pastki.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [q?.suhbat.length, holat]);

  useEffect(
    () => () => {
      tugadi.current = true;
      yozish.current?.stop(false);
      oqim.current?.getTracks().forEach((t) => t.stop());
      audio.current?.pause();
    },
    [],
  );

  // Miya'ning n-gapini ovozda o'qiydi
  const oqi = useCallback(async (x: Q, n: number) => {
    const a = audio.current;
    if (!a || tugadi.current) return;
    setHolat("gapiryapti");
    a.src = `/api/telefon/ovoz?q=${x.id}&k=${x.kalit}&n=${n}`;
    await new Promise<void>((ok) => {
      a.onended = () => ok();
      a.onerror = () => ok();
      a.play().catch(() => ok());
    });
  }, []);

  // Gapni yozib oladi: gapira boshlagach 1.3 soniya jim tursa — o'zi yuboradi
  const tingla = useCallback((): Promise<Blob | null> => {
    const stream = oqim.current;
    if (!stream || tugadi.current) return Promise.resolve(null);
    setHolat("eshityapti");
    return new Promise((ok) => {
      const tur = ovozTuri();
      const rec = new MediaRecorder(stream, tur ? { mimeType: tur } : undefined);
      const bolaklar: Blob[] = [];
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      const boshi = Date.now();
      let shovqin = 0.01;
      let gapirdi = false;
      let oxirgiOvoz = 0;
      let yuborilsin = true;
      const tekshir = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (const v of buf) s += v * v;
        const rms = Math.sqrt(s / buf.length);
        const t = Date.now() - boshi;
        if (t < 400) shovqin = Math.max(shovqin, rms);
        else if (rms > Math.max(0.02, shovqin * 2.5)) {
          gapirdi = true;
          oxirgiOvoz = Date.now();
        }
        if ((gapirdi && Date.now() - oxirgiOvoz > 1300) || t > 45_000) stop(true);
        else if (!gapirdi && t > 12_000) stop(false);
      }, 100);
      const stop = (yubor: boolean) => {
        clearInterval(tekshir);
        yozish.current = null;
        yuborilsin = yubor && (gapirdi || Date.now() - boshi > 1500);
        if (rec.state !== "inactive") rec.stop();
      };
      rec.ondataavailable = (e) => e.data.size && bolaklar.push(e.data);
      rec.onstop = () => {
        void ctx.close();
        ok(yuborilsin && bolaklar.length ? new Blob(bolaklar, { type: rec.mimeType || tur || "audio/webm" }) : null);
      };
      yozish.current = { stop };
      rec.start();
    });
  }, []);

  // Suhbat aylanasi: Miya gapiradi → siz gapirasiz → Miya o'ylaydi → …
  const aylana = useCallback(
    async (x: Q, oqishdan: boolean) => {
      let joriy = x;
      try {
        if (oqishdan) await oqi(joriy, joriy.suhbat.length - 1);
        while (!tugadi.current) {
          if (joriy.tugat) break;
          const ovoz = await tingla();
          if (tugadi.current) return;
          if (!ovoz) {
            setHolat("kutish");
            return;
          }
          setHolat("oylayapti");
          const f = new FormData();
          f.append("q", joriy.id);
          f.append("audio", ovoz, "gap");
          joriy = await api(f, t);
          setQ(joriy);
          await oqi(joriy, joriy.suhbat.length - 1);
        }
        tugadi.current = true;
        oqim.current?.getTracks().forEach((t) => t.stop());
        setHolat("tugadi");
      } catch (e) {
        setXato((e as Error).message);
        setHolat("kutish");
      }
    },
    [oqi, tingla, t],
  );

  const mikrofon = async () => {
    if (oqim.current) return true;
    try {
      oqim.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      return true;
    } catch {
      setXato("Mikrofonga ruxsat bering (brauzer manzil qatoridagi belgidan)");
      return false;
    }
  };

  // «Javob berish» / «Miya bilan gaplashish» — ovoz va mikrofon shu bosishdan ochiladi
  const boshla = async () => {
    setXato(null);
    audio.current ??= new Audio();
    void audio.current.play().catch(() => null); // iPhone'da ovozni ochib qo'yish
    if (!(await mikrofon())) return;
    tugadi.current = false;
    try {
      const x = q ? await api({ amal: "javob", q: q.id }, t) : await api({ amal: "boshla" }, t);
      setQ(x);
      await aylana(x, true);
    } catch (e) {
      setXato((e as Error).message);
      setHolat("kutish");
    }
  };

  const qayta = async () => {
    if (!q || !(await mikrofon())) return;
    audio.current ??= new Audio();
    tugadi.current = false;
    await aylana(q, false);
  };

  const tugma = async (ha: boolean) => {
    if (!q) return;
    yozish.current?.stop(false);
    setHolat("oylayapti");
    try {
      const x = await api({ amal: "tugma", q: q.id, ha }, t);
      setQ(x);
      tugadi.current = false;
      await aylana(x, true);
    } catch (e) {
      setXato((e as Error).message);
      setHolat("kutish");
    }
  };

  const qoy = async (rad = false) => {
    tugadi.current = true;
    yozish.current?.stop(false);
    audio.current?.pause();
    oqim.current?.getTracks().forEach((t) => t.stop());
    oqim.current = null;
    if (q) setQ(await api({ amal: "tugat", q: q.id, rad }, t).catch(() => q));
    setHolat("tugadi");
  };

  if (holat === "yuklanmoqda") return <div className="q_ekran q_markaz">Yuklanmoqda…</div>;
  if (holat === "kirish") {
    const next = qId ? `/qongiroq?q=${qId}` : "/qongiroq";
    return (
      <div className="q_ekran q_markaz">
        <div className="q_avatar">🧠</div>
        <p>Miya bilan gaplashish uchun tizimga kiring.</p>
        <a className="q_yashil" href={`/login?next=${encodeURIComponent(next)}`}>
          Kirish
        </a>
      </div>
    );
  }
  if (holat === "xato") return <div className="q_ekran q_markaz">⚠️ {xato}</div>;

  const suhbatda = !["kelyapti", "tugadi"].includes(holat) && Boolean(q);

  return (
    <div className="q_ekran">
      <div className="q_tepa">
        <div className={`q_avatar ${holat === "gapiryapti" || holat === "kelyapti" ? "q_puls" : ""} ${holat === "eshityapti" ? "q_tinglash" : ""}`}>🧠</div>
        <h1>Miya</h1>
        <div className="q_holat">{holat === "kelyapti" ? "📞 sizga qo'ng'iroq qilyapti…" : (HOLAT_MATN[holat] ?? "")}</div>
      </div>

      <div className="q_suhbat">
        {q?.suhbat.map((g, i) => (
          <div key={i} className={g.kim === "miya" ? "q_miya" : "q_men"}>
            {g.matn}
          </div>
        ))}
        {xato && <div className="q_xato">⚠️ {xato}</div>}
        <div ref={pastki} />
      </div>

      <div className="q_past">
        {holat === "kelyapti" && (
          <div className="q_qator">
            <button className="q_qizil q_dumaloq" onClick={() => void qoy(true)} aria-label="Rad etish">
              ✕
            </button>
            <button className="q_yashil q_dumaloq q_puls" onClick={() => void boshla()} aria-label="Javob berish">
              📞
            </button>
          </div>
        )}
        {!q && holat === "kutish" && (
          <button className="q_yashil" onClick={() => void boshla()}>
            📞 Miya bilan gaplashish
          </button>
        )}
        {suhbatda && q?.fikrId && !q.tugat && (
          <div className="q_qator">
            <button className="q_tugma" onClick={() => void tugma(true)}>
              ✅ Ha, qil
            </button>
            <button className="q_tugma" onClick={() => void tugma(false)}>
              ✋ Yo&apos;q
            </button>
          </div>
        )}
        {suhbatda && (
          <div className="q_qator">
            {holat === "kutish" && (
              <button className="q_mikrofon" onClick={() => void qayta()} aria-label="Gapirish">
                🎙
              </button>
            )}
            {holat === "eshityapti" && (
              <button className="q_mikrofon q_tinglash" onClick={() => yozish.current?.stop(true)} aria-label="Yuborish">
                ⏹
              </button>
            )}
            <button className="q_qizil q_dumaloq" onClick={() => void qoy()} aria-label="Go'shakni qo'yish">
              ✕
            </button>
          </div>
        )}
        {holat === "tugadi" && (
          <a className="q_tugma" href="/ofis">
            Ofisga qaytish
          </a>
        )}
      </div>
    </div>
  );
}
