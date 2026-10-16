"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// «Miya» boshqaruvi: Miya o'zi topgan ogohlantirishlar, avtomatik Reels, rejadagi postlar
// va ChatGPT xotirasidan olingan profil.

type Xabar = { id: string; tur: string; daraja: "info" | "ogoh" | "xavf"; matn: string; oqildi: boolean; createdAt: string };
type Reja = { id: string; tur: string; caption: string; vaqt: string; holat: string; xato: string | null; manba: string };
type Upload = { id: string; filename: string; kind: "video" | "image" | null; createdAt: string };
type Sozlama = {
  autoReels: boolean;
  reelsVaqtlari: string;
  reelsBrend: string;
  reelsFooter: string;
  kamQoldiq: number;
  qarzKunlari: number;
  oxirgiMoliya: string | null;
  oxirgiInstagram: string | null;
};
type Javob = {
  sozlama: Sozlama;
  moliya: boolean;
  chatgpt: boolean;
  xabarlar: Xabar[];
  rejalar: Reja[];
  xotira: { yangilandi: string; profil: string } | null;
  uploads: Upload[];
};

type Bolim = "xabarlar" | "reels" | "reja" | "xotira";
const BOLIMLAR: [Bolim, string][] = [
  ["xabarlar", "🔔 Ogohlantirishlar"],
  ["reels", "🎬 Avtomatik Reels"],
  ["reja", "🗓 Rejadagi postlar"],
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
  const [bolim, setBolim] = useState<Bolim>("xabarlar");
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

  return (
    <div className="o_miya">
      <div className="o_moliyaTablar">
        {BOLIMLAR.map(([k, nom]) => (
          <button key={k} className={`o_tab ${bolim === k ? "o_tabFaol" : ""}`} onClick={() => setBolim(k)}>
            {nom}
            {k === "xabarlar" && oqilmagan > 0 && <span className="o_miyaSon">{oqilmagan}</span>}
          </button>
        ))}
      </div>
      {xato && <div className="o_natija" style={{ marginBottom: 10 }}>⚠️ {xato}</div>}
      {ok && <div className="o_natija" style={{ marginBottom: 10 }}>✅ {ok}</div>}

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
        video yasaydi, matn va hashtaglarni yozib joylaydi, keyin Telegram&apos;da xabar beradi. O&apos;chirilsa — faqat eslatadi.
        {!chatgpt && " ⚠️ OPENAI_API_KEY yo'q — hozircha faqat eslatadi."}
      </div>
      <label className="o_miyaQator">
        <input type="checkbox" checked={f.autoReels} onChange={(e) => setF({ ...f, autoReels: e.target.checked })} />
        Avtomatik yasab joylasin
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
