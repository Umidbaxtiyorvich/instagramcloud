"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Gap = { kim: "miya" | "men"; matn: string };
type Qongiroq = { id: string; kanal: string; yonalish: string; holat: string; sabab: string; suhbat: Gap[]; createdAt: string };
type Holat = {
  tg: { sozlangan: boolean; ishlayapti: boolean; ulangan: boolean; men: string; kodKutilmoqda: boolean };
  bot: boolean;
  botXato: string | null;
  telegram: boolean;
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
  const [tgTel, setTgTel] = useState("");
  const [tgKod, setTgKod] = useState("");
  const [tgParol, setTgParol] = useState("");
  const [parolKerak, setParolKerak] = useState(false);
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
      const j = (await r.json().catch(() => ({}))) as { error?: string; qongiroq?: string; havola?: string };
      if (!r.ok) {
        if (/parol/i.test(j.error ?? "")) setParolKerak(true);
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      if (j.havola) {
        // await'dan keyin window.open bloklanadi — shu oynada ochamiz
        window.location.href = j.havola;
        return true;
      }
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
      {d.twilio ? (
        <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
          Muhim gap bo&apos;lsa Miya sizga <b>qo&apos;ng&apos;iroq qiladi</b>: nima bo&apos;lganini aytadi va buyrug&apos;ingizni oladi. Siz ham
          Miya raqamiga qo&apos;ng&apos;iroq qilib, PIN terasiz va oddiy gapirasiz: «bugun nechta komment keldi?», «kassada qancha pul bor?»,
          «shu kommentga javob yoz». Instagram&apos;ga yozadigan ishlarni Miya avval o&apos;qib beradi va «ha» deganingizdan keyin bajaradi.
          Qo&apos;ng&apos;iroqlar kunduzi (08:00–22:00) va 30 daqiqada ko&apos;pi bilan bir marta bo&apos;ladi.
        </div>
      ) : (
        <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
          <b>Miya sizni chaqiradi:</b> muhim gap bo&apos;lsa, Telegram botiga «📞 Miya sizga qo&apos;ng&apos;iroq qilyapti» xabari (ovozli) keladi. Havolani bosing — telefonda qo&apos;ng&apos;iroq ekrani ochiladi, yashil 📞 ni bossangiz Miya ovoz chiqarib
          gapiradi, siz javob berasiz.
          <br />
          <b>Siz Miya&apos;ni chaqirasiz:</b> quyidagi tugmani bosing (yoki telefonda <b>/qongiroq</b> sahifasini oching — uni bosh ekranga
          qo&apos;yib olsangiz, ilovadek bir bosishda ochiladi) va oddiy gapiring: «bugun nechta komment keldi?», «kassada qancha pul bor?».
          <br />
          Instagram&apos;ga yozadigan ishlarni Miya avval o&apos;qib beradi va «ha» deganingizdan keyin bajaradi. Chaqiruvlar kunduzi
          (08:00–22:00) va 30 daqiqada ko&apos;pi bilan bir marta bo&apos;ladi.
          {!d.openai && " ⚠️ OPENAI_API_KEY yo'q — ovozli suhbat ishlamaydi."}
        </div>
      )}
      <h3 className="o_ulanishSarlavha">Telegram bot</h3>
      {!d.bot ? (
        <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
          Miya&apos;ning o&apos;z Telegram boti hali yo&apos;q. Telegram&apos;da <b>@BotFather</b> → <b>/newbot</b> → nom bering (masalan «Miya»)
          → bergan <b>token</b>ni Render → instagramcloud → Environment&apos;ga <b>MIYA_BOT_TOKEN</b> nomi bilan qo&apos;ying. Bepul.
        </div>
      ) : d.telegram ? (
        <div className="o_miyaQator">
          ✅ Telegram bot ulangan — Miya shu yerga qo&apos;ng&apos;iroq qiladi, botdagi «📞 Miyaga qo&apos;ng&apos;iroq» bilan siz chaqirasiz
          <button className="o_misol" disabled={!!band} onClick={() => void amal("telegram_uz", { amal: "telegram_uz" }, "Bot uzildi")}>
            Uzish
          </button>
        </div>
      ) : (
        <>
          <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
            Tugmani bosing — Telegram ochiladi, botda <b>Start</b> ni bosing. Shundan keyin Miya botga qo&apos;ng&apos;iroq qiladi, siz ham bot
            orqali qo&apos;ng&apos;iroq qilasiz, javob berilmagan qo&apos;ng&apos;iroqlar botda tarix bo&apos;lib qoladi.
          </div>
          <button className="o_tugma" disabled={!!band} onClick={() => void amal("telegram_ulash", { amal: "telegram_ulash" })}>
            ✈️ Telegram&apos;ga ulash
          </button>
        </>
      )}
      {d.botXato && <div className="o_natija" style={{ marginBottom: 10 }}>⚠️ Bot: {d.botXato}</div>}

      <h3 className="o_ulanishSarlavha">Haqiqiy qo&apos;ng&apos;iroq — Miya&apos;ning Telegram akkaunti</h3>
      {!d.tg.sozlangan ? (
        <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
          Telefoningiz haqiqiy qo&apos;ng&apos;iroqdek jiringlashi uchun Miya&apos;ga alohida Telegram akkaunt kerak (masalan, eSIM raqamiga).
          my.telegram.org → API development tools&apos;dan olingan <b>api_id</b> va <b>api_hash</b>&apos;ni Render → Environment&apos;ga{" "}
          <b>TG_API_ID</b> va <b>TG_API_HASH</b> nomi bilan qo&apos;ying. Bepul.
        </div>
      ) : !d.tg.ishlayapti ? (
        <div className="o_natija" style={{ marginBottom: 10 }}>
          ⚠️ Qo&apos;ng&apos;iroq dasturi ishlamayapti. Render&apos;da saytni qayta deploy qiling (Manual Deploy → Clear build cache &amp; deploy) va
          loglarda «miya-tg» qatorlarini ko&apos;ring.
        </div>
      ) : d.tg.ulangan ? (
        <>
          <div className="o_miyaQator">
            ✅ Miya akkaunti ulangan: <b>{d.tg.men}</b>
          </div>
          <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
            Muhim gap bo&apos;lsa Miya shu akkauntdan sizning Telegram&apos;ingizga <b>qo&apos;ng&apos;iroq qiladi</b> — telefon jiringlaydi. Siz ham{" "}
            {d.tg.men} ga oddiy qo&apos;ng&apos;iroq qilsangiz, Miya ko&apos;taradi; botdagi «📞 Miyaga qo&apos;ng&apos;iroq» bossangiz, Miya darhol sizga
            qo&apos;ng&apos;iroq qiladi. Birinchi marta asosiy akkauntingizdan {d.tg.men} ga bitta xabar yozing (u sizni tanishi uchun).
          </div>
          {d.telegram ? (
            <button className="o_misol" disabled={!!band} onClick={() => void amal("tg_sinov", { amal: "tg_sinov" }, "Miya hozir Telegram'ingizga qo'ng'iroq qiladi")}>
              {band === "tg_sinov" ? "Qo'ng'iroq qilinmoqda…" : "📲 Sinov: Miya Telegram'imga qo'ng'iroq qilsin"}
            </button>
          ) : (
            <div className="o_ulanishMatn">Avval yuqorida Telegram botni ulang — Miya sizning Telegram&apos;ingizni shundan biladi.</div>
          )}
        </>
      ) : (
        <>
          <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
            Miya uchun ochilgan Telegram akkauntiga bir marta kiring: raqamni yozing, Telegram&apos;ga kelgan kodni kiriting. Kod Miya
            akkaunti ochilgan telefondagi Telegram&apos;ga keladi.
          </div>
          {!d.tg.kodKutilmoqda ? (
            <>
              <input className="o_qidiruv" value={tgTel} onChange={(e) => setTgTel(e.target.value)} placeholder="Miya akkaunti raqami: +998…" inputMode="tel" />
              <button className="o_tugma" disabled={!!band || !tgTel.trim()} onClick={() => void amal("tg_kod", { amal: "tg_kod", telefon: tgTel }, "Kod Telegram'ga yuborildi")}>
                {band === "tg_kod" ? "Yuborilmoqda…" : "Kod yuborish"}
              </button>
            </>
          ) : (
            <>
              <input className="o_qidiruv" value={tgKod} onChange={(e) => setTgKod(e.target.value)} placeholder="Telegram kodi" inputMode="numeric" autoComplete="one-time-code" />
              {parolKerak && (
                <input
                  className="o_qidiruv"
                  type="password"
                  value={tgParol}
                  onChange={(e) => setTgParol(e.target.value)}
                  placeholder="Ikki bosqichli parol (Cloud password)"
                  autoComplete="current-password"
                />
              )}
              <button
                className="o_tugma"
                disabled={!!band || !tgKod.trim()}
                onClick={() =>
                  void amal("tg_kirish", { amal: "tg_kirish", kod: tgKod, ...(tgParol ? { parol: tgParol } : {}) }, "Miya akkaunti ulandi").then(
                    (x) => x && (setTgKod(""), setTgParol(""), setParolKerak(false)),
                  )
                }
              >
                {band === "tg_kirish" ? "Kirilmoqda…" : "Kirish"}
              </button>
              <button className="o_misol" disabled={!!band || !tgTel.trim()} onClick={() => void amal("tg_kod", { amal: "tg_kod", telefon: tgTel }, "Kod qayta yuborildi")}>
                Kodni qayta yuborish
              </button>
            </>
          )}
        </>
      )}

      <a className="o_tugma" href="/qongiroq" style={{ display: "inline-block", textDecoration: "none", marginBottom: 6 }}>
        📞 Miya&apos;ga qo&apos;ng&apos;iroq qilish
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
            {band === "sinov" ? "Qo'ng'iroq qilinmoqda…" : d.twilio ? "📞 Hozir menga qo'ng'iroq qil (sinov)" : "📞 Sinov: Miya meni chaqirsin"}
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
