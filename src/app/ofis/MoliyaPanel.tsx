"use client";

import { useEffect, useState } from "react";

// AI Ofis «Moliya» paneli: CloudShop kassasi, tovarlar, hujjatlar, qarzlar
// va Telegram to'lov boti (@claudeadminbot_bot) cheklari — faqat ko'rish.

type Bolim = "kassa" | "tovarlar" | "hujjatlar" | "qarzlar" | "tolovlar";
type Davr = "bugun" | "kecha" | "hafta" | "oy";

type Pul = { id: string; sana: number; tur: "kirim" | "chiqim"; summa: number; raqam: string; toifa: string; hisob: string; kontragent: string; izoh: string };
type Hujjat = { id: string; sana: number; tur: string; turNomi: string; summa: number; raqam: string; kontragent: string; izoh: string; tovarSoni: number };
type Tovar = { id: string; nom: string; birlik: string; narx: number; tannarx: number; qoldiq: number; qiymat: number; sku: string };
type Qarzdor = { id: string; nom: string; telefon: string; qarz: number };
type TolovHolat = "done" | "exists" | "new" | "old" | "future" | "oqilmoqda";
type Tolov = {
  id: string;
  sana: number;
  sanaAniq: boolean;
  xabarSana: number;
  guruh: string;
  yubordi: string;
  tolovchi: string;
  matn: string;
  holat: TolovHolat;
  summa: number;
  izoh: string;
};
const TOLOV_HOLAT: Record<TolovHolat, [string, string]> = {
  done: ["✅", "CloudShop'ga kiritildi"],
  exists: ["☑️", "CloudShop'da oldindan bor"],
  new: ["🆕", "tasdiq kutmoqda"],
  old: ["⚠️", "eski sana — tekshiring"],
  future: ["🔮", "sana kelajakda — tekshiring"],
  oqilmoqda: ["⏳", "bot hali o'qimadi"],
};
const kun = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("uz-UZ", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", year: "numeric" });

type Javob = {
  ruxsat?: boolean;
  holat?: { cloudshop: boolean; bot: boolean };
  error?: string;
  data?: {
    rows: unknown[];
    kirim?: number;
    chiqim?: number;
    sof?: number;
    sotuv?: number;
    qabul?: number;
    jamiQiymat?: number;
    tugagan?: number;
    jami?: number;
    kiritildi?: number;
    kutmoqda?: number;
  };
};

const BOLIMLAR: [Bolim, string][] = [
  ["kassa", "💵 Kirim-chiqim"],
  ["tovarlar", "📦 Tovarlar"],
  ["hujjatlar", "🧾 Sotuv / qabul"],
  ["qarzlar", "💰 Qarzlar"],
  ["tolovlar", "📲 Telegram to'lovlar"],
];
const DAVRLAR: [Davr, string][] = [
  ["bugun", "Bugun"],
  ["kecha", "Kecha"],
  ["hafta", "7 kun"],
  ["oy", "30 kun"],
];

export const pul = (n: number) => `${Math.round(n || 0).toLocaleString("en-US").replace(/,/g, " ")}`;
const vaqt = (ts: number) =>
  new Date(ts * 1000).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function MoliyaPanel({ yop, kirgan }: { yop: () => void; kirgan: boolean }) {
  const [bolim, setBolim] = useState<Bolim>("kassa");
  const [davr, setDavr] = useState<Davr>("bugun");
  const [javob, setJavob] = useState<Javob | null>(null);
  const [yuklanmoqda, setYuklanmoqda] = useState(false);
  const [qidiruv, setQidiruv] = useState("");

  useEffect(() => {
    if (!kirgan) return;
    let bekor = false;
    const t = setTimeout(() => {
      setYuklanmoqda(true);
      fetch(`/api/ofis/moliya?bolim=${bolim}&davr=${davr}`)
        .then((r) => r.json())
        .then((d: Javob) => !bekor && setJavob(d))
        .catch(() => !bekor && setJavob({ error: "Server bilan aloqa yo'q" }))
        .finally(() => !bekor && setYuklanmoqda(false));
    }, 0);
    return () => {
      bekor = true;
      clearTimeout(t);
    };
  }, [bolim, davr, kirgan]);

  const d = javob?.data;
  const davrKerak = bolim === "kassa" || bolim === "hujjatlar" || bolim === "tolovlar";
  const q = qidiruv.toLowerCase();

  return (
    <div className="o_panel o_taxta">
      <div className="o_panelBosh">
        <div className="o_panelBelgi" style={{ ["--r" as string]: "#2cc6c6" }}>
          💰
        </div>
        <div>
          <h2>Moliya — CloudShop va Telegram bot</h2>
          <p>Kirim-chiqim, tovarlar, pullar tarixi · @claudeadminbot_bot bilan bir baza · faqat ko&apos;rish</p>
        </div>
        <button className="o_yop" onClick={yop} aria-label="Yopish">
          ✕
        </button>
      </div>

      <div className="o_moliyaTablar">
        {BOLIMLAR.map(([k, nom]) => (
          <button key={k} className={`o_tab ${bolim === k ? "o_tabFaol" : ""}`} onClick={() => setBolim(k)}>
            {nom}
          </button>
        ))}
        {davrKerak && (
          <span className="o_davrlar">
            {DAVRLAR.map(([k, nom]) => (
              <button key={k} className={`o_misol ${davr === k ? "o_davrFaol" : ""}`} onClick={() => setDavr(k)}>
                {nom}
              </button>
            ))}
          </span>
        )}
      </div>

      {!kirgan && <div className="o_bosh">Moliyani ko&apos;rish uchun tizimga kiring.</div>}
      {kirgan && javob?.ruxsat === false && (
        <div className="o_natija">
          Bu bo&apos;lim maxfiy. Ruxsat berish uchun serverga MOLIYA_ADMIN_EMAILS=sizning@email.uz sozlamasini qo&apos;shing
          (bir nechta bo&apos;lsa vergul bilan).
        </div>
      )}
      {kirgan && javob?.ruxsat && javob.holat && (!javob.holat.cloudshop || !javob.holat.bot) && (
        <div className="o_natija" style={{ marginBottom: 10 }}>
          {!javob.holat.cloudshop && "○ CloudShop ulanmagan: CS_EMAIL, CS_PASSWORD, CLOUDSHOP_APP_KEY ni qo'shing (botdagi qiymatlar bilan bir xil).\n"}
          {!javob.holat.bot && "○ Telegram bot ulanmagan: TOLOV_BOT_URL (Railway manzili) va TOLOV_BOT_API_KEY (botdagi API_KEY) ni qo'shing."}
        </div>
      )}
      {javob?.error && <div className="o_natija">⚠️ {javob.error}</div>}
      {yuklanmoqda && <div className="o_bosh">Yuklanmoqda…</div>}

      {d && !yuklanmoqda && (
        <>
          <div className="o_korsatkichlar">
            {bolim === "kassa" && (
              <>
                <Kart nom="Kirim" qiymat={pul(d.kirim ?? 0)} rang="#3dff9a" />
                <Kart nom="Chiqim" qiymat={pul(d.chiqim ?? 0)} rang="#ff6b5a" />
                <Kart nom="Sof" qiymat={pul(d.sof ?? 0)} />
              </>
            )}
            {bolim === "hujjatlar" && (
              <>
                <Kart nom="Sotuv" qiymat={pul(d.sotuv ?? 0)} rang="#3dff9a" />
                <Kart nom="Tovar qabul" qiymat={pul(d.qabul ?? 0)} rang="#ffb45a" />
                <Kart nom="Hujjatlar" qiymat={String(d.rows.length)} />
              </>
            )}
            {bolim === "tovarlar" && (
              <>
                <Kart nom="Tovar turi" qiymat={String(d.rows.length)} />
                <Kart nom="Ombor qiymati" qiymat={pul(d.jamiQiymat ?? 0)} />
                <Kart nom="Tugagan" qiymat={String(d.tugagan ?? 0)} rang="#ff6b5a" />
              </>
            )}
            {bolim === "qarzlar" && (
              <>
                <Kart nom="Qarzdorlar" qiymat={String(d.rows.length)} />
                <Kart nom="Jami qarz" qiymat={pul(d.jami ?? 0)} rang="#ffb45a" />
                <Kart nom="O'rtacha" qiymat={pul(d.rows.length ? (d.jami ?? 0) / d.rows.length : 0)} />
              </>
            )}
            {bolim === "tolovlar" && (
              <>
                <Kart nom="To'lovlar" qiymat={String(d.rows.length)} />
                <Kart nom="Jami summa" qiymat={pul(d.jami ?? 0)} rang="#3dff9a" />
                <Kart nom="CloudShop'ga kiritilgan" qiymat={pul(d.kiritildi ?? 0)} />
                <Kart nom="Tekshiruv kutmoqda" qiymat={String(d.kutmoqda ?? 0)} rang="#ffb45a" />
              </>
            )}
          </div>

          {(bolim === "tovarlar" || bolim === "qarzlar") && (
            <input
              className="o_qidiruv"
              placeholder={bolim === "tovarlar" ? "Tovar nomi yoki SKU…" : "Xaridor ismi yoki telefoni…"}
              value={qidiruv}
              onChange={(e) => setQidiruv(e.target.value)}
            />
          )}

          <div className="o_jadval">
            {!d.rows.length && <div className="o_bosh">Bu davrda yozuv yo&apos;q.</div>}
            {bolim === "kassa" &&
              (d.rows as Pul[]).slice(0, 300).map((r) => (
                <div key={r.id + r.sana} className="o_qator">
                  <span className="o_qSana">{vaqt(r.sana)}</span>
                  <span className={r.tur === "kirim" ? "o_qKirim" : "o_qChiqim"}>
                    {r.tur === "kirim" ? "+" : "−"}
                    {pul(r.summa)}
                  </span>
                  <span className="o_qMatn">
                    <b>{r.toifa || (r.tur === "kirim" ? "Kirim" : "Chiqim")}</b>
                    {r.kontragent && ` · ${r.kontragent}`}
                    {r.hisob && <small> · {r.hisob}</small>}
                    {r.izoh && <small> · {r.izoh}</small>}
                  </span>
                </div>
              ))}
            {bolim === "hujjatlar" &&
              (d.rows as Hujjat[]).slice(0, 300).map((r) => (
                <div key={r.id} className="o_qator">
                  <span className="o_qSana">{vaqt(r.sana)}</span>
                  <span className={r.tur === "sales" ? "o_qKirim" : "o_qChiqim"}>{pul(r.summa)}</span>
                  <span className="o_qMatn">
                    <b>
                      {r.turNomi} №{r.raqam}
                    </b>
                    {r.kontragent && ` · ${r.kontragent}`}
                    {r.tovarSoni > 0 && <small> · {r.tovarSoni} xil tovar</small>}
                    {r.izoh && <small> · {r.izoh}</small>}
                  </span>
                </div>
              ))}
            {bolim === "tovarlar" &&
              (d.rows as Tovar[])
                .filter((r) => !q || r.nom.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))
                .slice(0, 300)
                .map((r) => (
                  <div key={r.id} className="o_qator">
                    <span className={r.qoldiq > 0 ? "o_qSana" : "o_qChiqim"}>
                      {r.qoldiq} {r.birlik}
                    </span>
                    <span className="o_qKirim">{pul(r.narx)}</span>
                    <span className="o_qMatn">
                      <b>{r.nom}</b>
                      <small>
                        {" "}
                        · qiymat {pul(r.qiymat)}
                        {r.sku && ` · ${r.sku}`}
                      </small>
                    </span>
                  </div>
                ))}
            {bolim === "qarzlar" &&
              (d.rows as Qarzdor[])
                .filter((r) => !q || r.nom.toLowerCase().includes(q) || r.telefon.includes(q))
                .slice(0, 300)
                .map((r, i) => (
                  <div key={r.id} className="o_qator">
                    <span className="o_qSana">{i + 1}.</span>
                    <span className="o_qChiqim">{pul(r.qarz)}</span>
                    <span className="o_qMatn">
                      <b>{r.nom}</b>
                      {r.telefon && <small> · {r.telefon}</small>}
                    </span>
                  </div>
                ))}
            {bolim === "tolovlar" &&
              (d.rows as Tolov[]).slice(0, 300).map((r) => (
                <div key={r.id} className="o_qator">
                  <span className="o_qSana" title={`Xabar: ${vaqt(r.xabarSana)}`}>
                    {r.holat === "oqilmoqda" ? vaqt(r.sana) : kun(r.sana)}
                    {!r.sanaAniq && r.holat !== "oqilmoqda" && <small> (sana o&apos;qilmagan)</small>}
                  </span>
                  <span className="o_qKirim">{r.summa ? pul(r.summa) : "—"}</span>
                  <span className="o_qMatn">
                    <span title={TOLOV_HOLAT[r.holat][1]}>{TOLOV_HOLAT[r.holat][0]} </span>
                    <b>{r.tolovchi || r.yubordi || "Noma'lum"}</b>
                    <small> · {TOLOV_HOLAT[r.holat][1]}</small>
                    {r.guruh && <small> · {r.guruh}</small>}
                    <small> · xabar {vaqt(r.xabarSana)}</small>
                    {r.matn && <small> · «{r.matn}»</small>}
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

function Kart({ nom, qiymat, rang }: { nom: string; qiymat: string; rang?: string }) {
  return (
    <div className="o_korsatkich">
      <small>{nom}</small>
      <b style={rang ? { color: rang } : undefined}>{qiymat}</b>
    </div>
  );
}
