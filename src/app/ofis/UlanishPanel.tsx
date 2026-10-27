"use client";

import { useCallback, useEffect, useState } from "react";

// AI Ofis «Ulanishlar»: agentlar ishlatadigan tashqi MCP serverlar.
// OAuth bo'lsa «Ulash» → serverning ruxsat sahifasi; token bo'lsa — tokenni kiritasiz.

type Vosita = { name: string; description: string; readOnly: boolean };
type Ulanish = {
  id: string;
  name: string;
  url: string;
  auth: "none" | "token" | "oauth";
  enabled: boolean;
  allowWrites: boolean;
  ulangan: boolean;
  vositalar: Vosita[] | null;
  oqishSoni: number | null;
  checkedAt: string | null;
  lastError: string | null;
};
type Tayyor = { name: string; url: string; auth: Ulanish["auth"]; tavsif: string; tokenYordam?: string };

const AUTH_NOMI: Record<Ulanish["auth"], string> = { oauth: "OAuth", token: "API token", none: "Tokensiz" };

export default function UlanishPanel({ yop, kirgan, xabar }: { yop: () => void; kirgan: boolean; xabar: string | null }) {
  const [rows, setRows] = useState<Ulanish[]>([]);
  const [tayyor, setTayyor] = useState<Tayyor[]>([]);
  const [claude, setClaude] = useState(true);
  const [xato, setXato] = useState<string | null>(null);
  const [band, setBand] = useState(false);
  const [forma, setForma] = useState<{ name: string; url: string; auth: Ulanish["auth"]; token: string; yordam?: string } | null>(null);
  const [ochiq, setOchiq] = useState<string | null>(null);

  const yukla = useCallback(async () => {
    const r = await fetch("/api/ofis/ulanish");
    if (!r.ok) return;
    const d = (await r.json()) as { ulanishlar: Ulanish[]; tayyor: Tayyor[]; claude: boolean };
    setRows(d.ulanishlar);
    setTayyor(d.tayyor);
    setClaude(d.claude);
  }, []);

  useEffect(() => {
    if (!kirgan) return;
    const t = setTimeout(() => void yukla(), 0);
    return () => clearTimeout(t);
  }, [kirgan, yukla]);

  const sorov = async (method: string, body?: unknown, q = "") => {
    setBand(true);
    setXato(null);
    try {
      const r = await fetch(`/api/ofis/ulanish${q}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; ulanish?: Ulanish };
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await yukla();
      return d.ulanish;
    } catch (e) {
      setXato((e as Error).message);
      return undefined;
    } finally {
      setBand(false);
    }
  };

  const qosh = async () => {
    if (!forma) return;
    const u = await sorov("POST", { name: forma.name, url: forma.url, auth: forma.auth, token: forma.token || undefined });
    if (!u) return;
    setForma(null);
    // to'liq sahifa o'tishi kerak: API xizmatning tashqi ruxsat sahifasiga yo'naltiradi
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (u.auth === "oauth") window.location.href = `/api/ofis/ulanish/oauth/start?id=${u.id}`;
  };

  const bor = new Set(rows.map((r) => r.name));

  return (
    <div className="o_panel o_taxta">
      <div className="o_panelBosh">
        <div className="o_panelBelgi" style={{ ["--r" as string]: "#9b7bff" }}>
          🔌
        </div>
        <div>
          <h2>Ulanishlar — agentlarning tashqi vositalari</h2>
          <p>MCP serverlar: OAuth bilan bir bosishda yoki API token bilan · agentlar vazifada o&apos;zi ishlatadi</p>
        </div>
        <button className="o_yop" onClick={yop} aria-label="Yopish">
          ✕
        </button>
      </div>

      {!kirgan && <div className="o_bosh">Ulanishlarni boshqarish uchun tizimga kiring.</div>}
      {kirgan && !claude && (
        <div className="o_natija" style={{ marginBottom: 10 }}>
          ○ Agentlar hozir oddiy rejimda: ulanishlar AI rejimida ishlaydi. Pastda ChatGPT yoki Claude kaliti qo&apos;yilgach yoqiladi.
        </div>
      )}
      {xabar && <div className="o_natija" style={{ marginBottom: 10 }}>🔌 {xabar}</div>}
      {xato && <div className="o_natija" style={{ marginBottom: 10 }}>⚠️ {xato}</div>}

      {kirgan && (
        <>
          <AiKalit yangilandi={() => void yukla()} {...CHATGPT} />
          <AiKalit yangilandi={() => void yukla()} {...CLAUDE} />
          <div className="o_jadval">
            {!rows.length && <div className="o_bosh">Hali ulanish yo&apos;q. Pastdan tanlang yoki o&apos;zingiz qo&apos;shing.</div>}
            {rows.map((r) => (
              <div key={r.id} className="o_ulanish">
                <div className="o_ulanishBosh">
                  <span className={`o_holatNuqta ${r.enabled && r.ulangan && !r.lastError ? "o_yashil" : r.lastError ? "o_qizil" : ""}`} />
                  <b>{r.name}</b>
                  <small>
                    {AUTH_NOMI[r.auth]} · {r.url}
                  </small>
                </div>
                <div className="o_ulanishMatn">
                  {!r.ulangan && "Hali ulanmagan. "}
                  {r.vositalar &&
                    `${r.vositalar.length} ta vosita, shundan ${r.oqishSoni} tasi faqat o'qish. ` +
                      (r.allowWrites ? "Agentlar hammasini ishlata oladi." : "Agentlar faqat o'qish vositalarini ishlatadi.")}
                  {!r.vositalar && r.ulangan && !r.allowWrites && "Vositalar ro'yxati olinmadi — «Yozishga ruxsat» yoqilmaguncha agentlar ishlatmaydi."}
                  {r.lastError && <span className="o_ulanishXato"> ⚠️ {r.lastError}</span>}
                </div>
                <div className="o_ulanishTugmalar">
                  {r.auth === "oauth" && (
                    <a className="o_misol" href={`/api/ofis/ulanish/oauth/start?id=${r.id}`}>
                      {r.ulangan ? "Qayta ulash" : "Ulash"}
                    </a>
                  )}
                  <button className="o_misol" disabled={band} onClick={() => void sorov("PATCH", { id: r.id, tekshir: true })}>
                    Tekshirish
                  </button>
                  <button className="o_misol" disabled={band} onClick={() => void sorov("PATCH", { id: r.id, enabled: !r.enabled })}>
                    {r.enabled ? "O'chirib qo'yish" : "Yoqish"}
                  </button>
                  <button
                    className={`o_misol ${r.allowWrites ? "o_davrFaol" : ""}`}
                    disabled={band}
                    title="Yoqilsa, agentlar shu xizmatga tasdiqsiz yozadi (sahifa yaratish, vazifa ochish va h.k.)"
                    onClick={() => {
                      if (r.allowWrites || confirm(`${r.name}: agentlar shu xizmatga tasdiqsiz yoza oladi. Yoqaymi?`)) {
                        void sorov("PATCH", { id: r.id, allowWrites: !r.allowWrites });
                      }
                    }}
                  >
                    Yozishga ruxsat: {r.allowWrites ? "bor" : "yo'q"}
                  </button>
                  {r.vositalar && (
                    <button className="o_misol" onClick={() => setOchiq(ochiq === r.id ? null : r.id)}>
                      Vositalar
                    </button>
                  )}
                  <button
                    className="o_misol"
                    disabled={band}
                    onClick={() => confirm(`${r.name} ulanishini o'chiraymi?`) && void sorov("DELETE", undefined, `?id=${r.id}`)}
                  >
                    O&apos;chirish
                  </button>
                </div>
                {r.auth === "token" && (
                  <TokenYangila band={band} saqla={(token) => void sorov("PATCH", { id: r.id, token })} />
                )}
                {ochiq === r.id && r.vositalar && (
                  <div className="o_vositalar">
                    {r.vositalar.map((v) => (
                      <div key={v.name}>
                        {v.readOnly ? "👁" : "✏️"} <b>{v.name}</b>
                        {v.description && <small> — {v.description}</small>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {!forma && (
            <>
              <h3 className="o_ulanishSarlavha">Qo&apos;shish</h3>
              <div className="o_tayyorlar">
                {tayyor
                  .filter((t) => !bor.has(t.name))
                  .map((t) => (
                    <button
                      key={t.name}
                      className="o_tayyor"
                      onClick={() => setForma({ name: t.name, url: t.url, auth: t.auth, token: "", yordam: t.tokenYordam })}
                    >
                      <b>{t.name}</b>
                      <small>{t.tavsif}</small>
                      <small>{AUTH_NOMI[t.auth]}</small>
                    </button>
                  ))}
                <button className="o_tayyor" onClick={() => setForma({ name: "", url: "https://", auth: "token", token: "" })}>
                  <b>＋ Boshqa MCP</b>
                  <small>Manzil va token bilan</small>
                </button>
              </div>
            </>
          )}

          {forma && (
            <div className="o_ulanishForma">
              <h3 className="o_ulanishSarlavha">Yangi ulanish</h3>
              <input
                className="o_qidiruv"
                placeholder="Nomi (masalan, Notion)"
                value={forma.name}
                onChange={(e) => setForma({ ...forma, name: e.target.value })}
              />
              <input
                className="o_qidiruv"
                placeholder="MCP manzili (https://...)"
                value={forma.url}
                onChange={(e) => setForma({ ...forma, url: e.target.value })}
              />
              <div className="o_moliyaTablar">
                {(["oauth", "token", "none"] as const).map((a) => (
                  <button key={a} className={`o_tab ${forma.auth === a ? "o_tabFaol" : ""}`} onClick={() => setForma({ ...forma, auth: a })}>
                    {AUTH_NOMI[a]}
                  </button>
                ))}
              </div>
              {forma.auth === "token" && (
                <>
                  <input
                    className="o_qidiruv"
                    type="password"
                    autoComplete="off"
                    placeholder="API token"
                    value={forma.token}
                    onChange={(e) => setForma({ ...forma, token: e.target.value })}
                  />
                  {forma.yordam && <div className="o_ulanishMatn">Token qayerdan: {forma.yordam}</div>}
                </>
              )}
              {forma.auth === "oauth" && (
                <div className="o_ulanishMatn">«Ulash» bosilgach, xizmatning o&apos;z sahifasida ruxsat berasiz va shu yerga qaytasiz.</div>
              )}
              <div className="o_ulanishTugmalar">
                <button className="o_tugma" disabled={band || !forma.name || !forma.url} onClick={() => void qosh()}>
                  {band ? "Tekshirilmoqda…" : forma.auth === "oauth" ? "Ulash" : "Qo'shish"}
                </button>
                <button className="o_tugma" style={{ background: "rgba(255,255,255,0.08)" }} onClick={() => setForma(null)}>
                  Bekor qilish
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type KalitHolat = { ulangan: boolean; manba: "sayt" | "server" | null; oxiri: string | null; yangilandi: string | null; ruxsat: boolean };
type KalitTur = { nom: string; api: string; tavsif: string; yoq: string; serverNom: string; misol: string; tekshiruv: string };

const CHATGPT: KalitTur = {
  nom: "ChatGPT",
  api: "/api/ofis/openai",
  tavsif: "OpenAI API kaliti · Miya va agentlarning «miyasi»",
  yoq: "Kalit yo'q — Miya o'ylay olmaydi, gapira olmaydi. ",
  serverNom: "OPENAI_API_KEY",
  misol: "Yangi OpenAI kaliti (sk-...)",
  tekshiruv: "OpenAI'da",
};
const CLAUDE: KalitTur = {
  nom: "Claude",
  api: "/api/ofis/claude",
  tavsif: "Anthropic API kaliti · agentlar vazifalarni Claude bilan bajaradi",
  yoq: "Kalit yo'q — agentlar ChatGPT (bo'lsa) yoki oddiy rejimda ishlaydi. ",
  serverNom: "ANTHROPIC_API_KEY",
  misol: "Yangi Claude kaliti (sk-ant-...)",
  tekshiruv: "Anthropic'da",
};

// Miya va agentlar ishlatadigan AI kaliti (ChatGPT yoki Claude) — butun sayt uchun bitta, almashtirishni admin qiladi
function AiKalit({ yangilandi, nom, api, tavsif, yoq, serverNom, misol, tekshiruv }: KalitTur & { yangilandi: () => void }) {
  const [h, setH] = useState<KalitHolat | null>(null);
  const [band, setBand] = useState(false);
  const [xato, setXato] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const sorov = useCallback(
    async (method: string, body?: unknown) => {
      setBand(method !== "GET");
      setXato(null);
      setOk(false);
      try {
        const r = await fetch(api, {
          method,
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const d = (await r.json().catch(() => ({}))) as KalitHolat & { error?: string };
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        setH(d);
        if (method !== "GET") {
          setOk(true);
          yangilandi();
        }
      } catch (e) {
        setXato((e as Error).message);
      } finally {
        setBand(false);
      }
    },
    [yangilandi, api],
  );

  useEffect(() => {
    const t = setTimeout(() => void sorov("GET"), 0);
    return () => clearTimeout(t);
  }, [sorov]);

  if (!h) return null;
  return (
    <div className="o_ulanish" style={{ marginBottom: 10 }}>
      <div className="o_ulanishBosh">
        <span className={`o_holatNuqta ${h.ulangan ? "o_yashil" : "o_qizil"}`} />
        <b>{nom}</b>
        <small>
          {tavsif}
          {h.oxiri && ` · …${h.oxiri}`}
        </small>
      </div>
      <div className="o_ulanishMatn">
        {!h.ulangan && yoq}
        {h.manba === "sayt" && `Kalit shu yerda saqlangan${h.yangilandi ? ` (${new Date(h.yangilandi).toLocaleString("uz-UZ")})` : ""}. `}
        {h.manba === "server" && `Kalit serverning ${serverNom} sozlamasidan olinmoqda. `}
        {h.ruxsat ? `Yangi kalitni qo'ysangiz, avval ${tekshiruv} tekshiriladi (hisobda pul borligi ham), keyin darhol ishlay boshlaydi.` : "Kalitni faqat admin almashtira oladi."}
        {ok && <span> ✅ Saqlandi.</span>}
        {xato && <span className="o_ulanishXato"> ⚠️ {xato}</span>}
      </div>
      {h.ruxsat && (
        <>
          <TokenYangila band={band} saqla={(kalit) => void sorov("POST", { kalit })} matn={misol} />
          {h.manba === "sayt" && (
            <div className="o_ulanishTugmalar" style={{ marginTop: 8 }}>
              <button
                className="o_misol"
                disabled={band}
                onClick={() => confirm(`Saytdagi kalitni o'chiraymi? Serverdagi ${serverNom} (bo'lsa) ishlatiladi.`) && void sorov("DELETE")}
              >
                Saytdagi kalitni o&apos;chirish
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TokenYangila({ band, saqla, matn }: { band: boolean; saqla: (token: string) => void; matn?: string }) {
  const [token, setToken] = useState("");
  return (
    <div className="o_tokenYangi">
      <input
        className="o_qidiruv"
        type="password"
        autoComplete="off"
        placeholder={matn ?? "Yangi API token (almashtirish uchun)"}
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <button
        className="o_misol"
        disabled={band || !token}
        onClick={() => {
          saqla(token);
          setToken("");
        }}
      >
        Saqlash
      </button>
    </div>
  );
}
