"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TelefonBolim from "./TelefonBolim";

// «Miya» boshqaruvi: Miya o'zi topgan ogohlantirishlar, avtomatik Reels, rejadagi postlar
// va ChatGPT xotirasidan olingan profil.

type Xabar = { id: string; tur: string; daraja: "info" | "ogoh" | "xavf"; matn: string; oqildi: boolean; createdAt: string };
type Reja = { id: string; tur: string; caption: string; vaqt: string; holat: string; xato: string | null; manba: string };
type Fikr = {
  id: string;
  amal: string;
  sarlavha: string;
  fikr: string;
  payload: string;
  ishonch: number;
  xavf: "past" | "orta" | "yuqori";
  holat: string;
  natija: string | null;
  izoh: string | null;
  createdAt: string;
};
type Upload = { id: string; filename: string; kind: "video" | "image" | null; createdAt: string };
type Sozlama = {
  autoReels: boolean;
  reelsTasdiq: boolean;
  reelsVaqtlari: string;
  reelsBrend: string;
  reelsFooter: string;
  kamQoldiq: number;
  qarzKunlari: number;
  oxirgiMoliya: string | null;
  oxirgiInstagram: string | null;
  mustaqillik: "maslahat" | "ishonchli" | "toliq";
  oxirgiFikr: string | null;
  qoidalar: string;
};
type Javob = {
  sozlama: Sozlama;
  moliya: boolean;
  chatgpt: boolean;
  xabarlar: Xabar[];
  rejalar: Reja[];
  xotira: { yangilandi: string; profil: string } | null;
  uploads: Upload[];
  fikrlar: Fikr[];
  ishonch: Record<string, { ha: number; yoq: number }>;
};

type Bolim = "fikrlar" | "xabarlar" | "telefon" | "reels" | "reja" | "qoidalar" | "xotira";
const BOLIMLAR: [Bolim, string][] = [
  ["fikrlar", "💭 Fikrlar"],
  ["xabarlar", "🔔 Ogohlantirishlar"],
  ["telefon", "📞 Telefon"],
  ["reels", "🎬 Avtomatik Reels"],
  ["reja", "🗓 Rejadagi postlar"],
  ["qoidalar", "📌 Qoidalarim"],
  ["xotira", "🧩 Men haqimda"],
];
const DARAJA_RANG: Record<Xabar["daraja"], string> = { info: "#3dff9a", ogoh: "#ffb45a", xavf: "#ff6b5a" };
const TUR_NOMI: Record<string, string> = {
  reel: "Reels",
  photo: "Rasm",
  story: "Story",
  reel_story: "Reels + story",
  photo_story: "Rasm + story",
};
const vaqt = (s: string) =>
  new Date(s).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Toshkent vaqti bo'yicha "YYYY-MM-DDTHH:MM" (datetime-local uchun)
function keyinroq(daqiqa: number) {
  return new Date(Date.now() + daqiqa * 60_000 + 5 * 3600_000).toISOString().slice(0, 16);
}

export default function MiyaBoshqaruv({ kirgan }: { kirgan: boolean }) {
  const [bolim, setBolim] = useState<Bolim>("fikrlar");
  const [d, setD] = useState<Javob | null>(null);
  const [band, setBand] = useState<string | null>(null);
  const [xato, setXato] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const yukla = useCallback(async () => {
    const r = await fetch("/api/miya");
    if (r.ok) setD((await r.json()) as Javob);
  }, []);

  useEffect(() => {
    if (!kirgan) return;
    const t = setTimeout(() => void yukla(), 0);
    const i = setInterval(() => void yukla(), 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [kirgan, yukla]);

  const sorov = async (nom: string, url: string, method: string, body?: unknown) => {
    setBand(nom);
    setXato(null);
    setOk(null);
    try {
      const r = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      await yukla();
      return j;
    } catch (e) {
      setXato((e as Error).message);
      return null;
    } finally {
      setBand(null);
    }
  };

  if (!kirgan) return <div className="o_bosh">Miya bilan ishlash uchun tizimga kiring.</div>;
  if (!d) return <div className="o_bosh">Yuklanmoqda…</div>;

  const oqilmagan = d.xabarlar.filter((x) => !x.oqildi && x.daraja !== "info").length;
  const kutayotgan = d.fikrlar.filter((f) => f.holat === "kutmoqda").length;

  return (
    <div className="o_miya">
      <div className="o_moliyaTablar">
        {BOLIMLAR.map(([k, nom]) => (
          <button key={k} className={`o_tab ${bolim === k ? "o_tabFaol" : ""}`} onClick={() => setBolim(k)}>
            {nom}
            {k === "xabarlar" && oqilmagan > 0 && <span className="o_miyaSon">{oqilmagan}</span>}
            {k === "fikrlar" && kutayotgan > 0 && <span className="o_miyaSon">{kutayotgan}</span>}
          </button>
        ))}
      </div>
      {xato && <div className="o_natija" style={{ marginBottom: 10 }}>⚠️ {xato}</div>}
      {ok && <div className="o_natija" style={{ marginBottom: 10 }}>✅ {ok}</div>}

      {bolim === "fikrlar" && (
        <FikrlarBolim
          d={d}
          band={band}
          sorov={sorov}
          setOk={setOk}
        />
      )}

      {bolim === "xabarlar" && (
        <>
          <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
            Miya CloudShop&apos;ni har 6 soatda (kam tovar, manfiy qoldiq, tannarxdan arzon narx, kassadagi takror va katta summalar,
            qarzlar o&apos;sishi, uzoq to&apos;lamaganlar) va Instagram&apos;ni har kuni tekshiradi. Muhimlari Telegram&apos;ga ham boradi.
            {d.sozlama.oxirgiMoliya && <> Oxirgi CloudShop tekshiruvi: {vaqt(d.sozlama.oxirgiMoliya)}.</>}
          </div>
          <div className="o_ulanishTugmalar">
            <button className="o_misol" disabled={!!band} onClick={() => void sorov("tekshir", "/api/miya", "POST", { amal: "tekshir" }).then((j) => j && setOk("Tekshirildi"))}>
              {band === "tekshir" ? "Tekshirilmoqda…" : "Hozir tekshir"}
            </button>
            {oqilmagan > 0 && (
              <button className="o_misol" disabled={!!band} onClick={() => void sorov("oqildi", "/api/miya", "POST", { amal: "oqildi" })}>
                Hammasini o&apos;qildi deb belgilash
              </button>
            )}
          </div>
          <div className="o_jadval" style={{ marginTop: 12 }}>
            {!d.xabarlar.length && <div className="o_bosh">Hali xabar yo&apos;q. Birinchi tekshiruv tez orada bo&apos;ladi.</div>}
            {d.xabarlar.map((x) => (
              <div key={x.id} className={`o_miyaXabar ${x.oqildi ? "" : "o_miyaYangi"}`} style={{ ["--r" as string]: DARAJA_RANG[x.daraja] }}>
                <small>{vaqt(x.createdAt)}</small>
                <div>{x.matn}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {bolim === "telefon" && <TelefonBolim />}

      {bolim === "reels" && <ReelsSozlama s={d.sozlama} chatgpt={d.chatgpt} band={!!band} saqla={(b) => sorov("sozla", "/api/miya", "PATCH", b).then((j) => j && setOk("Saqlandi"))} />}

      {bolim === "reja" && (
        <RejaBolim
          d={d}
          band={!!band}
          yangila={yukla}
          qosh={(b) => sorov("reja", "/api/miya", "POST", { amal: "reja", ...b }).then((j) => Boolean(j && (setOk("Rejaga qo'yildi"), true)))}
          ochir={(id) => void sorov("ochir", `/api/miya?reja=${encodeURIComponent(id)}`, "DELETE")}
          xatoBer={setXato}
        />
      )}

      {bolim === "qoidalar" && (
        <QoidaBolim key={d.sozlama.qoidalar} qoidalar={d.sozlama.qoidalar} band={!!band} saqla={(q) => sorov("sozla", "/api/miya", "PATCH", { qoidalar: q }).then((j) => j && setOk("Saqlandi"))} />
      )}

      {bolim === "xotira" && <XotiraBolim xotira={d.xotira} chatgpt={d.chatgpt} yangila={yukla} />}
    </div>
  );
}

function ReelsSozlama({ s, chatgpt, band, saqla }: { s: Sozlama; chatgpt: boolean; band: boolean; saqla: (b: Partial<Sozlama>) => void }) {
  const [f, setF] = useState(s);
  return (
    <div>
      <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
        Belgilangan vaqtlarda Miya o&apos;zi ssenariy yozadi (eng ko&apos;p ko&apos;rilgan Reels&apos;laringiz va siz haqingizdagi ma&apos;lumotga qarab),
        video yasaydi, matn va hashtaglarni yozadi; so&apos;rash yoqilgan bo&apos;lsa, videoni Telegram&apos;da ko&apos;rsatib ruxsatingizni kutadi, aks holda o&apos;zi joylaydi. O&apos;chirilsa — faqat eslatadi.
        {!chatgpt && " ⚠️ OPENAI_API_KEY yo'q — hozircha faqat eslatadi."}
      </div>
      <label className="o_miyaQator">
        <input type="checkbox" checked={f.autoReels} onChange={(e) => setF({ ...f, autoReels: e.target.checked })} />
        Avtomatik yasab joylasin
      </label>
      <label className="o_miyaQator">
        <input type="checkbox" checked={f.reelsTasdiq} onChange={(e) => setF({ ...f, reelsTasdiq: e.target.checked })} />
        Joylashdan oldin so&apos;rasin (video Telegram&apos;ga «✅ Joyla / ❌ Bekor» bilan keladi)
      </label>
      <label className="o_miyaYorliq">Vaqtlar (Toshkent, vergul bilan)</label>
      <input className="o_qidiruv" value={f.reelsVaqtlari} onChange={(e) => setF({ ...f, reelsVaqtlari: e.target.value })} placeholder="10:00,19:00" />
      <label className="o_miyaYorliq">Videodagi brend nomi (bo&apos;sh bo&apos;lsa — akkaunt nomi)</label>
      <input className="o_qidiruv" value={f.reelsBrend} onChange={(e) => setF({ ...f, reelsBrend: e.target.value })} placeholder="Oson Market POS" />
      <label className="o_miyaYorliq">Pastki qator (telefon, manzil)</label>
      <input className="o_qidiruv" value={f.reelsFooter} onChange={(e) => setF({ ...f, reelsFooter: e.target.value })} placeholder="+998 90 123 45 67" />
      <h3 className="o_ulanishSarlavha">CloudShop chegaralari</h3>
      <label className="o_miyaYorliq">«Kam qolgan» deb hisoblash: qoldiq shundan kam yoki teng</label>
      <input className="o_qidiruv" type="number" min={0} value={f.kamQoldiq} onChange={(e) => setF({ ...f, kamQoldiq: Number(e.target.value) })} />
      <label className="o_miyaYorliq">Necha kun to&apos;lamasa ogohlantirsin</label>
      <input className="o_qidiruv" type="number" min={3} value={f.qarzKunlari} onChange={(e) => setF({ ...f, qarzKunlari: Number(e.target.value) })} />
      <button
        className="o_tugma"
        disabled={band}
        onClick={() =>
          saqla({
            autoReels: f.autoReels,
            reelsTasdiq: f.reelsTasdiq,
            reelsVaqtlari: f.reelsVaqtlari,
            reelsBrend: f.reelsBrend,
            reelsFooter: f.reelsFooter,
            kamQoldiq: f.kamQoldiq,
            qarzKunlari: f.qarzKunlari,
          })
        }
      >
        Saqlash
      </button>
    </div>
  );
}

function RejaBolim({
  d,
  band,
  yangila,
  qosh,
  ochir,
  xatoBer,
}: {
  d: Javob;
  band: boolean;
  yangila: () => Promise<void>;
  qosh: (b: { upload_id: string; tur: string; caption: string; vaqt: string }) => Promise<boolean>;
  ochir: (id: string) => void;
  xatoBer: (x: string | null) => void;
}) {
  const [uploadId, setUploadId] = useState("");
  const [tur, setTur] = useState("reel");
  const [caption, setCaption] = useState("");
  const [vaqtQiymat, setVaqtQiymat] = useState(keyinroq(60));
  const [yuklanmoqda, setYuklanmoqda] = useState(false);
  const fayl = useRef<HTMLInputElement>(null);
  const tanlangan = d.uploads.find((u) => u.id === uploadId);
  const turlar = tanlangan?.kind === "image" ? ["photo", "photo_story", "story"] : ["reel", "reel_story", "story"];

  const yukla = async (f: File) => {
    setYuklanmoqda(true);
    xatoBer(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/uploads", { method: "POST", body: fd });
      const j = (await r.json()) as { upload?: { id: string; kind: string }; error?: string };
      if (!r.ok || !j.upload) throw new Error(j.error || "Yuklanmadi");
      await yangila();
      setUploadId(j.upload.id);
      setTur(j.upload.kind === "image" ? "photo" : "reel");
    } catch (e) {
      xatoBer((e as Error).message);
    } finally {
      setYuklanmoqda(false);
      if (fayl.current) fayl.current.value = "";
    }
  };

  return (
    <div>
      <div className="o_jadval">
        {!d.rejalar.length && <div className="o_bosh">Rejada post yo&apos;q.</div>}
        {d.rejalar.map((r) => (
          <div key={r.id} className="o_qator">
            <span className="o_qSana">{vaqt(r.vaqt)}</span>
            <span className={r.holat === "xato" ? "o_qChiqim" : "o_qKirim"}>{TUR_NOMI[r.tur] ?? r.tur}</span>
            <span className="o_qMatn">
              {r.holat === "kutmoqda" ? "⏳ kutmoqda" : r.holat === "joylanmoqda" ? "📤 joylanmoqda" : r.holat === "joylandi" ? "✅ joylandi" : `⚠️ ${r.xato ?? "xato"}`}
              {r.manba === "miya" && <small> · Miya</small>}
              {r.caption && <small> · «{r.caption.slice(0, 80)}»</small>}
              {r.holat === "kutmoqda" && (
                <button className="o_misol" style={{ marginLeft: 8 }} disabled={band} onClick={() => ochir(r.id)}>
                  Bekor qilish
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      <h3 className="o_ulanishSarlavha">Yangi post</h3>
      <div className="o_ulanishTugmalar" style={{ marginTop: 0 }}>
        <input ref={fayl} type="file" accept="video/mp4,video/quicktime,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && void yukla(e.target.files[0])} />
        <button className="o_misol" disabled={yuklanmoqda} onClick={() => fayl.current?.click()}>
          {yuklanmoqda ? "Yuklanmoqda…" : "📎 Video yoki rasm yuklash (MP4 / JPEG)"}
        </button>
      </div>
      <label className="o_miyaYorliq">Fayl</label>
      <select className="o_qidiruv" value={uploadId} onChange={(e) => setUploadId(e.target.value)}>
        <option value="">— tanlang —</option>
        {d.uploads.map((u) => (
          <option key={u.id} value={u.id}>
            {u.kind === "image" ? "🖼" : "🎬"} {u.filename}
          </option>
        ))}
      </select>
      <label className="o_miyaYorliq">Turi</label>
      <div className="o_moliyaTablar">
        {turlar.map((t) => (
          <button key={t} className={`o_tab ${tur === t ? "o_tabFaol" : ""}`} onClick={() => setTur(t)}>
            {TUR_NOMI[t]}
          </button>
        ))}
      </div>
      {tur !== "story" && (
        <>
          <label className="o_miyaYorliq">Matn (caption)</label>
          <textarea className="o_qidiruv" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Post matni va hashtaglar" />
        </>
      )}
      <label className="o_miyaYorliq">Qachon (Toshkent vaqti)</label>
      <input className="o_qidiruv" type="datetime-local" value={vaqtQiymat} onChange={(e) => setVaqtQiymat(e.target.value)} />
      <button
        className="o_tugma"
        disabled={band || !uploadId || !vaqtQiymat}
        onClick={async () => {
          if (await qosh({ upload_id: uploadId, tur, caption, vaqt: vaqtQiymat.replace("T", " ") })) {
            setUploadId("");
            setCaption("");
          }
        }}
      >
        Rejaga qo&apos;yish
      </button>
      <div className="o_ulanishMatn">Ofisda ham aytishingiz mumkin: «oxirgi yuklagan videomni ertaga 18:00 da Reels qilib qo&apos;y».</div>
    </div>
  );
}

// ChatGPT eksporti: conversations.json dan foydalanuvchining o'z xabarlari (yangilari birinchi)
type Suhbat = {
  title?: string;
  mapping?: Record<string, { message?: { author?: { role?: string }; create_time?: number | null; content?: { parts?: unknown[] } } | null }>;
};

function eksportniOqi(fayllar: Record<string, string>) {
  const xabarlar: { t: number; s: string }[] = [];
  const sarlavhalar: string[] = [];
  const xotiralar: string[] = [];
  for (const [nom, matn] of Object.entries(fayllar)) {
    if (/conversations.*\.json$/i.test(nom)) {
      const suhbatlar = JSON.parse(matn) as Suhbat[];
      for (const c of suhbatlar) {
        if (c.title) sarlavhalar.push(c.title);
        for (const n of Object.values(c.mapping ?? {})) {
          const m = n.message;
          if (m?.author?.role !== "user") continue;
          const s = (m.content?.parts ?? []).filter((p): p is string => typeof p === "string").join("\n").trim();
          if (s.length > 2) xabarlar.push({ t: m.create_time ?? 0, s: s.slice(0, 4000) });
        }
      }
    } else if (/memor/i.test(nom) && nom.endsWith(".json")) {
      // ba'zi eksportlarda saqlangan xotiralar alohida faylda bo'ladi
      const j = JSON.parse(matn) as unknown;
      const yig = (v: unknown) => {
        if (typeof v === "string" && v.length > 3) xotiralar.push(v.slice(0, 2000));
        else if (Array.isArray(v)) v.forEach(yig);
        else if (v && typeof v === "object") Object.values(v).forEach(yig);
      };
      yig(j);
    }
  }
  xabarlar.sort((a, b) => b.t - a.t);
  return {
    xabarlar: xabarlar.slice(0, 3000).map((x) => x.s),
    sarlavhalar: sarlavhalar.slice(0, 3000).map((x) => x.slice(0, 200)),
    xotiralar: xotiralar.slice(0, 500),
  };
}

function QoidaBolim({ qoidalar, band, saqla }: { qoidalar: string; band: boolean; saqla: (q: string) => void }) {
  const [q, setQ] = useState(qoidalar);
  return (
    <div>
      <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
        Miya doim amal qiladigan qoidalaringiz — har qatorga bittadan. Reels yozganda, taklif berganda, telefonda va ofisda shunga qaraydi.
        Telegram&apos;da yoki qo&apos;ng&apos;iroqda «eslab qol: …» desangiz, o&apos;zi shu yerga qo&apos;shadi; «… ni unut» desangiz — o&apos;chiradi.
      </div>
      <textarea
        className="o_qidiruv"
        rows={8}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={"Chegirmani 10% dan oshirma\nReels'da narxni yozma, «Direct'ga yozing» de\nMijozlarga «siz» deb murojaat qil"}
      />
      <button className="o_tugma" disabled={band} onClick={() => saqla(q)}>
        Saqlash
      </button>
    </div>
  );
}

function XotiraBolim({ xotira, chatgpt, yangila }: { xotira: Javob["xotira"]; chatgpt: boolean; yangila: () => Promise<void> }) {
  const [holat, setHolat] = useState<string | null>(null);
  const [xato, setXato] = useState<string | null>(null);
  const fayl = useRef<HTMLInputElement>(null);

  const ishla = async (f: File) => {
    setXato(null);
    try {
      setHolat("Fayl ochilmoqda…");
      const bytes = new Uint8Array(await f.arrayBuffer());
      const fayllar: Record<string, string> = {};
      if (f.name.toLowerCase().endsWith(".zip")) {
        const { unzipSync, strFromU8 } = await import("fflate");
        const ochildi = unzipSync(bytes, { filter: (x) => /conversations.*\.json$/i.test(x.name) || (/memor/i.test(x.name) && x.name.endsWith(".json")) });
        for (const [nom, b] of Object.entries(ochildi)) fayllar[nom] = strFromU8(b);
      } else {
        fayllar[f.name] = new TextDecoder().decode(bytes);
      }
      if (!Object.keys(fayllar).length) throw new Error("ZIP ichida conversations.json topilmadi — ChatGPT eksportini yuklang");
      setHolat("Xabarlar ajratilmoqda…");
      const tayyor = eksportniOqi(fayllar);
      if (!tayyor.xabarlar.length && !tayyor.xotiralar.length) throw new Error("Faylda xabar topilmadi");
      setHolat(`${tayyor.xabarlar.length} ta xabaringiz o'qilmoqda — profil yozilmoqda (1-2 daqiqa)…`);
      const r = await fetch("/api/miya/xotira", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tayyor) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setHolat(null);
      await yangila();
    } catch (e) {
      setHolat(null);
      setXato((e as Error).message);
    } finally {
      if (fayl.current) fayl.current.value = "";
    }
  };

  return (
    <div>
      <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
        ChatGPT&apos;da: <b>Settings → Data controls → Export data</b>. Emailga kelgan ZIP faylni shu yerga yuklang. Fayl
        brauzeringizda ochiladi; serverga faqat sizning xabarlaringiz boradi va ulardan profil yoziladi (parol, karta, telefon
        raqamlari yozilmaydi). Agentlar va Miya siz bilan shu profilga qarab gaplashadi.
        {!chatgpt && " ⚠️ OPENAI_API_KEY yo'q — profil yozib bo'lmaydi."}
      </div>
      <input ref={fayl} type="file" accept=".zip,.json" hidden onChange={(e) => e.target.files?.[0] && void ishla(e.target.files[0])} />
      <button className="o_tugma" disabled={!!holat || !chatgpt} onClick={() => fayl.current?.click()}>
        {holat ?? (xotira ? "Yangi eksport yuklash" : "ChatGPT eksportini (ZIP) yuklash")}
      </button>
      {xato && <div className="o_natija" style={{ marginTop: 10 }}>⚠️ {xato}</div>}
      {xotira && (
        <>
          <h3 className="o_ulanishSarlavha">Profil · {vaqt(xotira.yangilandi)}</h3>
          <div className="o_miyaProfil">{xotira.profil}</div>
          <button
            className="o_misol"
            style={{ marginTop: 10 }}
            onClick={async () => {
              if (!confirm("Profilni o'chiraymi?")) return;
              await fetch("/api/miya/xotira", { method: "DELETE" });
              await yangila();
            }}
          >
            Profilni o&apos;chirish
          </button>
        </>
      )}
    </div>
  );
}

const AMAL_NOMI: Record<string, string> = {
  save_dm_rule: "Direct qoidasi",
  save_comment_rule: "Komment qoidasi",
  configure_direct: "Direct sozlamasi",
  reply_comment: "Kommentga javob",
  reels_vaqtlari: "Reels vaqtlari",
  eslatma: "Eslatma",
};
const HOLAT: Record<string, string> = {
  kutmoqda: "⏳ javobingizni kutyapti",
  bajarildi: "✅ siz tasdiqladingiz",
  avtomatik: "🤖 o'zi qildi",
  rad: "✋ rad etildi",
  xato: "⚠️ bajarilmadi",
  eskirdi: "⌛ eskirdi",
};
const XAVF: Record<Fikr["xavf"], string> = { past: "xavfi past", orta: "mijozlar ko'radi", yuqori: "xavfi yuqori" };
const MUSTAQIL: [Sozlama["mustaqillik"], string, string][] = [
  ["maslahat", "Faqat maslahat", "Miya o'ylaydi va aytadi, lekin hech narsani o'zi qilmaydi — hammasiga siz «Ha» bosasiz."],
  ["ishonchli", "Ishonchni orttirsin", "Siz bir xil turdagi taklifni bir necha marta tasdiqlasangiz (xavfi past — 2, mijozlar ko'radigan — 5 marta), keyingilarini o'zi qiladi. Bir marta rad etsangiz — yana so'raydi."],
  ["toliq", "To'liq mustaqil", "Ishonchi 70% dan yuqori bo'lsa o'zi qiladi va sizga xabar beradi. Direct'ni o'chirish kabi xavfli ishlarni baribir so'raydi."],
];

function argsMatn(f: Fikr) {
  try {
    const a = JSON.parse(f.payload) as Record<string, unknown>;
    return Object.entries(a)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" | ") : String(v)}`)
      .join("\n");
  } catch {
    return "";
  }
}

function FikrlarBolim({
  d,
  band,
  sorov,
  setOk,
}: {
  d: Javob;
  band: string | null;
  sorov: (nom: string, url: string, method: string, body?: unknown) => Promise<unknown>;
  setOk: (s: string | null) => void;
}) {
  const [radId, setRadId] = useState<string | null>(null);
  const [izoh, setIzoh] = useState("");
  const kutayotgan = d.fikrlar.filter((f) => f.holat === "kutmoqda");
  const tarix = d.fikrlar.filter((f) => f.holat !== "kutmoqda");
  return (
    <div>
      <div className="o_ulanishMatn" style={{ marginTop: 0 }}>
        Miya kunduzi har 6 soatda Instagram&apos;ingizni o&apos;rganadi: statistika, Reels, kim nima so&apos;rayapti, qaysi savol javobsiz
        qolyapti, sizning oldingi qarorlaringiz. Keyin o&apos;z fikrini aytadi va aniq ish taklif qiladi. Rad etsangiz, sababini eslab qoladi.
        {d.sozlama.oxirgiFikr && <> Oxirgi marta o&apos;yladi: {vaqt(d.sozlama.oxirgiFikr)}.</>}
        {!d.chatgpt && " ⚠️ OPENAI_API_KEY yo'q — Miya o'ylay olmaydi."}
      </div>

      <h3 className="o_ulanishSarlavha">Qanchalik mustaqil bo&apos;lsin</h3>
      <div className="o_miyaMustaqil">
        {MUSTAQIL.map(([k, nom, izohi]) => (
          <button
            key={k}
            className={`o_miyaKarta ${d.sozlama.mustaqillik === k ? "o_miyaKartaFaol" : ""}`}
            disabled={!!band}
            onClick={() => void sorov("mustaqil", "/api/miya", "PATCH", { mustaqillik: k }).then((j) => j && setOk("Saqlandi"))}
          >
            <b>{nom}</b>
            <span>{izohi}</span>
          </button>
        ))}
      </div>

      <div className="o_ulanishTugmalar">
        <button
          className="o_misol"
          disabled={!!band || !d.chatgpt}
          onClick={() =>
            void sorov("fikrla", "/api/miya", "POST", { amal: "fikrla" }).then((j) => {
              const r = j as { takliflar?: number; ozi?: number } | null;
              if (r) setOk(`Miya o'yladi: ${r.takliflar ?? 0} ta taklif${r.ozi ? `, ${r.ozi} tasini o'zi qildi` : ""}`);
            })
          }
        >
          {band === "fikrla" ? "O'ylayapti… (1 daqiqagacha)" : "🧠 Hozir o'ylab ko'r"}
        </button>
      </div>

      {kutayotgan.length > 0 && <h3 className="o_ulanishSarlavha">Javobingizni kutyapti</h3>}
      {kutayotgan.map((f) => (
        <div key={f.id} className="o_miyaFikr o_miyaYangi">
          <small>
            {vaqt(f.createdAt)} · {AMAL_NOMI[f.amal] ?? f.amal} · ishonchi {f.ishonch}% · {XAVF[f.xavf]}
          </small>
          <b>{f.sarlavha}</b>
          <div>{f.fikr}</div>
          {argsMatn(f) && <pre className="o_miyaArgs">{argsMatn(f)}</pre>}
          {radId === f.id ? (
            <div className="o_ulanishTugmalar">
              <input className="o_qidiruv" value={izoh} onChange={(e) => setIzoh(e.target.value)} placeholder="Nega yo'q? (Miya buni eslab qoladi)" />
              <button
                className="o_misol"
                disabled={!!band}
                onClick={() =>
                  void sorov("yoq", "/api/miya", "POST", { amal: "fikr_yoq", id: f.id, izoh }).then(() => {
                    setRadId(null);
                    setIzoh("");
                  })
                }
              >
                Yuborish
              </button>
            </div>
          ) : (
            <div className="o_ulanishTugmalar">
              <button className="o_tugma" disabled={!!band} onClick={() => void sorov("ha", "/api/miya", "POST", { amal: "fikr_ha", id: f.id }).then((j) => j && setOk("Bajarildi"))}>
                {band === "ha" ? "Bajarilmoqda…" : "Ha, qil"}
              </button>
              <button className="o_misol" disabled={!!band} onClick={() => setRadId(f.id)}>
                Yo&apos;q
              </button>
            </div>
          )}
        </div>
      ))}

      <h3 className="o_ulanishSarlavha">Oldingi fikrlari</h3>
      <div className="o_jadval">
        {!tarix.length && <div className="o_bosh">Hali yo&apos;q. «Hozir o&apos;ylab ko&apos;r» ni bosing yoki Miya o&apos;zi o&apos;ylaguncha kuting.</div>}
        {tarix.map((f) => (
          <div key={f.id} className="o_miyaFikr">
            <small>
              {vaqt(f.createdAt)} · {AMAL_NOMI[f.amal] ?? f.amal} · {f.amal === "eslatma" ? "📣 sizga aytdi" : HOLAT[f.holat] ?? f.holat}
            </small>
            <b>{f.sarlavha}</b>
            <div>{f.fikr}</div>
            {f.izoh && <small>Siz: «{f.izoh}»</small>}
            {f.holat === "xato" && f.natija && <small>⚠️ {f.natija}</small>}
          </div>
        ))}
      </div>
      {Object.keys(d.ishonch).length > 0 && (
        <div className="o_ulanishMatn">
          Ishonch hisobi (60 kun):{" "}
          {Object.entries(d.ishonch)
            .map(([k, v]) => `${AMAL_NOMI[k] ?? k} — ${v.ha} ha / ${v.yoq} yo'q`)
            .join("; ")}
        </div>
      )}
    </div>
  );
}
