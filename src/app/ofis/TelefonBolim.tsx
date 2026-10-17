"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Gap = { kim: "miya" | "men"; matn: string };
type Qongiroq = { id: string; kanal: string; yonalish: string; holat: string; sabab: string; suhbat: Gap[]; createdAt: string };
type Holat = {
  twilio: boolean;
  openai: boolean;
  miyaRaqami: string;
  telefon: string | null;
  tasdiq: boolean;
  kodKutilmoqda: boolean;
  pinBor: boolean;
  rejim: "off" | "xavf" | "muhim";
  qongiroqlar: Qongiroq[];
};

const REJIMLAR: [Holat["rejim"], string, string][] = [
  ["xavf", "Faqat jiddiy muammoda", "Kassada takror, manfiy qoldiq, joylanmagan Reels kabi xavfli holatlarda qo'ng'iroq qiladi."],
  ["muhim", "Muammo va takliflarda", "Bundan tashqari, o'z taklifini aytib, «ha» yoki «yo'q» deb javobingizni oladi."],
  ["off", "Qo'ng'iroq qilmasin", "Faqat siz qo'ng'iroq qilasiz."],
];
const HOLAT_NOMI: Record<string, string> = {
  boshlandi: "📞 chaqirilmoqda",
  gaplashmoqda: "🗣 gaplashmoqda",
  tugadi: "✅ gaplashildi",
  javobsiz: "📵 ko'tarilmadi",
  xato: "⚠️ xato",
};
const vaqt = (s: string) =>
  new Date(s).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Miya → 📞 Telefon: raqamni ulash, qachon qo'ng'iroq qilishi, suhbatlar tarixi
export default function TelefonBolim() {
  const router = useRouter();
  const [d, setD] = useState<Holat | null>(null);
  const [telefon, setTelefon] = useState("");
  const [kod, setKod] = useState("");
  const [pin, setPin] = useState("");
  const [band, setBand] = useState<string | null>(null);
  const [xato, setXato] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const yukla = useCallback(async () => {
    const r = await fetch("/api/telefon");
    if (r.ok) setD((await r.json()) as Holat);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void yukla(), 0);
    const i = setInterval(() => void yukla(), 15_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [yukla]);

  const amal = async (nom: string, body: Record<string, unknown>, xabar?: string) => {
    setBand(nom);
    setXato(null);
    setOk(null);
    try {
      const r = await fetch("/api/telefon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; qongiroq?: string };
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      // bepul rejimdagi sinov — qo'ng'iroq ekranini darhol ochamiz (Telegram xabari Miya'ning navbatdagi tekshiruvida boradi)
      if (j.qongiroq) {
        router.push(`/qongiroq?q=${j.qongiroq}`);
        return true;
      }
      if (xabar) setOk(xabar);
      await yukla();
      return true;
    } catch (e) {
      setXato((e as Error).message);
      return false;
    } finally {
      setBand(null);
    }
  };

  if (!d) return <div className="o_bosh">Yuklanmoqda…</div>;

  return (
    <div>
      <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
        Muhim gap bo&apos;lsa Miya sizga <b>qo&apos;ng&apos;iroq qiladi</b>: nima bo&apos;lganini aytadi va buyrug&apos;ingizni oladi. Siz ham
        Miya raqamiga qo&apos;ng&apos;iroq qilib, PIN terasiz va oddiy gapirasiz: «bugun nechta komment keldi?», «kassada qancha pul bor?»,
        «shu kommentga javob yoz». Instagram&apos;ga yozadigan ishlarni Miya avval o&apos;qib beradi va «ha» deganingizdan keyin bajaradi.
        Qo&apos;ng&apos;iroqlar kunduzi (08:00–22:00) va 30 daqiqada ko&apos;pi bilan bir marta bo&apos;ladi.
      </div>
      {!d.twilio && (
        <div className="o_telefonRaqam">
          🆓 <b>Bepul rejim.</b> Miya Telegram&apos;ga «📞 Miya sizga qo&apos;ng&apos;iroq qilyapti» deb yozadi — havolani bossangiz, telefon
          brauzerida qo&apos;ng&apos;iroq ekrani ochiladi va Miya bilan ovoz orqali gaplashasiz. Siz ham istalgan payt quyidagi tugma bilan
          Miya&apos;ni chaqirasiz (saytga kirgan bo&apos;lsangiz, PIN kerak emas). Haqiqiy telefon qo&apos;ng&apos;irog&apos;i kerak bo&apos;lsa — Twilio
          (pullik) ulanadi.
          {!d.openai && " ⚠️ OPENAI_API_KEY yo'q — ovozli suhbat ishlamaydi."}
        </div>
      )}
      <a className="o_tugma" href="/qongiroq" style={{ display: "inline-block", textDecoration: "none", marginBottom: 6 }}>
        🎙 Miya bilan ovozli gaplashish
      </a>
      {d.twilio && !d.openai && (
        <div className="o_natija" style={{ marginBottom: 10 }}>
          ⚠️ OPENAI_API_KEY yo&apos;q — Miya faqat xabarni o&apos;qib beradi, gapingizni eshita olmaydi (taklifga 1/2 tugmasi bilan javob berasiz).
        </div>
      )}
      {xato && <div className="o_natija" style={{ marginBottom: 10 }}>⚠️ {xato}</div>}
      {ok && <div className="o_natija" style={{ marginBottom: 10 }}>✅ {ok}</div>}

      {d.twilio && d.miyaRaqami && (
        <div className="o_telefonRaqam">
          Miya raqami: <a href={`tel:${d.miyaRaqami}`}>{d.miyaRaqami}</a>
        </div>
      )}

      {d.twilio && <h3 className="o_ulanishSarlavha">1. Sizning raqamingiz</h3>}
      {!d.twilio ? null : d.tasdiq ? (
        <div className="o_miyaQator">
          ✅ {d.telefon} ulangan
          <button className="o_misol" disabled={!!band} onClick={() => confirm("Raqamni o'chiraymi?") && void amal("ochir", { amal: "ochir" }, "Raqam o'chirildi")}>
            O&apos;chirish
          </button>
        </div>
      ) : (
        <>
          <label className="o_miyaYorliq">Raqam — Miya shunga qo&apos;ng&apos;iroq qilib 4 xonali kodni aytadi</label>
          <input className="o_qidiruv" value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder="+998 90 123 45 67" inputMode="tel" />
          <button
            className="o_tugma"
            disabled={!!band || !d.twilio || !telefon.trim()}
            onClick={() => void amal("kod_yubor", { amal: "kod_yubor", telefon }, "Qo'ng'iroq ketdi — kodni eshitib, pastga yozing")}
          >
            {band === "kod_yubor" ? "Qo'ng'iroq qilinmoqda…" : "Kodni qo'ng'iroq qilib aytsin"}
          </button>
          {d.kodKutilmoqda && (
            <>
              <label className="o_miyaYorliq">{d.telefon} ga aytilgan kod</label>
              <input className="o_qidiruv" value={kod} onChange={(e) => setKod(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" inputMode="numeric" />
              <button className="o_tugma" disabled={!!band || kod.length !== 4} onClick={() => void amal("kod", { amal: "kod" , kod }, "Raqam tasdiqlandi").then((x) => x && setKod(""))}>
                Tasdiqlash
              </button>
            </>
          )}
        </>
      )}

      {d.twilio && d.tasdiq && (
        <>
          <h3 className="o_ulanishSarlavha">2. PIN — Miya&apos;ga o&apos;zingiz qo&apos;ng&apos;iroq qilganda</h3>
          <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
            Faqat sizning raqamingizdan kelgan qo&apos;ng&apos;iroqqa javob beradi, lekin raqamni soxtalashtirish mumkin — shuning uchun PIN ham
            so&apos;raydi. {d.pinBor ? "PIN o'rnatilgan." : "PIN hali yo'q — o'rnatmaguningizcha Miya kiruvchi qo'ng'iroqqa javob bermaydi."}
          </div>
          <input
            className="o_qidiruv"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="4-6 ta raqam"
            inputMode="numeric"
            autoComplete="new-password"
          />
          <button className="o_tugma" disabled={!!band || pin.length < 4} onClick={() => void amal("pin", { amal: "pin", pin }, "PIN saqlandi").then((x) => x && setPin(""))}>
            {d.pinBor ? "PIN'ni almashtirish" : "PIN o'rnatish"}
          </button>
        </>
      )}

      {(!d.twilio || d.tasdiq) && (
        <>
          <h3 className="o_ulanishSarlavha">Miya qachon qo&apos;ng&apos;iroq qilsin</h3>
          {REJIMLAR.map(([k, nom, izoh]) => (
            <label key={k} className="o_miyaQator" style={{ alignItems: "flex-start" }}>
              <input type="radio" name="rejim" checked={d.rejim === k} disabled={!!band} onChange={() => void amal("rejim", { amal: "rejim", rejim: k })} />
              <span>
                <b>{nom}</b> — {izoh}
              </span>
            </label>
          ))}
          <button className="o_misol" disabled={!!band} onClick={() => void amal("sinov", { amal: "sinov" }, "Miya hozir qo'ng'iroq qiladi")}>
            {band === "sinov" ? "Qo'ng'iroq qilinmoqda…" : d.twilio ? "📞 Hozir menga qo'ng'iroq qil (sinov)" : "📞 Sinov: Telegram'ga qo'ng'iroq havolasini yubor"}
          </button>
        </>
      )}

      <h3 className="o_ulanishSarlavha">Suhbatlar</h3>
      {!d.qongiroqlar.length && <div className="o_bosh">Hali qo&apos;ng&apos;iroq bo&apos;lmagan.</div>}
      {d.qongiroqlar.map((q) => (
        <div key={q.id} className="o_telefonSuhbat">
          <small>
            {vaqt(q.createdAt)} · {q.yonalish === "kiruvchi" ? "siz qo'ng'iroq qildingiz" : "Miya qo'ng'iroq qildi"} · {HOLAT_NOMI[q.holat] ?? q.holat}
            {q.kanal === "web" && q.yonalish === "chiquvchi" && ["boshlandi", "javobsiz"].includes(q.holat) && (
              <>
                {" · "}
                <a href={`/qongiroq?q=${q.id}`}>javob berish</a>
              </>
            )}
          </small>
          {q.suhbat.map((g, i) => (
            <div key={i} className={g.kim === "miya" ? "o_telefonMiya" : "o_telefonMen"}>
              <b>{g.kim === "miya" ? "🧠 Miya" : "🙂 Siz"}:</b> {g.matn}
            </div>
          ))}
          {q.holat === "xato" && q.sabab.includes("⚠️") && <div className="o_telefonMiya">{q.sabab.slice(q.sabab.indexOf("⚠️"))}</div>}
        </div>
      ))}
    </div>
  );
}
