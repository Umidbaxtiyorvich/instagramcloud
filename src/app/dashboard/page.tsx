"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Account = {
  id: string;
  username: string;
  name: string | null;
  isDemo: boolean;
  dmAutoReplyEnabled: boolean;
  commentRepliesOn: boolean;
  defaultDmReply: string;
  defaultDmMode: string;
  followersCount: number;
  lastWebhookAt: string | null;
};

type Upload = {
  id: string;
  filename: string;
  kind: "video" | "image" | null;
  size: number;
  createdAt: string;
  available: boolean;
  publishedId: string | null;
};

type User = {
  email: string;
  name: string | null;
  mcpToken: string;
  aiApproval: "chat" | "dashboard";
  mcpUrl: string;
  igConfigured: boolean;
  accounts: Account[];
};

type Connection = { clientId: string; name: string; since: string; lastUsedAt: string | null };

type Rule = {
  id: string;
  type: string;
  keywords: string;
  dmMessage: string;
  publicReplies: string;
  enabled: boolean;
  matchMode: string;
};

type Log = {
  id: string;
  kind: string;
  direction: string;
  username: string | null;
  text: string;
  replyText: string | null;
  createdAt: string;
};

type Approval = {
  id: string;
  toolName: string;
  summary: string;
  status: string;
  createdAt: string;
};

type Media = {
  id: string;
  caption: string;
  permalink: string;
  likes: number;
  comments: number;
  mediaType: string;
  views: number;
  reach: number;
  shares: number;
  saves: number;
  avgWatchSec: number;
};

// Facebook place page of Shahrisabz city — what Instagram's location_id expects
const SHAHRISABZ_LOCATION_ID = "361740101103266";

const tabs = [
  ["home", "Boshqaruv"],
  ["publish", "Joylash"],
  ["rules", "Qoidalar"],
  ["log", "Jurnal"],
  ["analytics", "Tahlil"],
  ["mcp", "AI-konnektor"],
  ["approvals", "AI harakatlari"],
] as const;

function parseJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("home");
  const [accountId, setAccountId] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [msg, setMsg] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [copied, setCopied] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [selected, setSelected] = useState("");
  const [publishing, setPublishing] = useState(false);

  const account = user?.accounts.find((a) => a.id === accountId) || user?.accounts[0];

  const load = useCallback(async () => {
    const res = await fetch("/api/me");
    const json = await res.json();
    if (!json.user) {
      window.location.href = "/login";
      return;
    }
    setUser(json.user);
    setAccountId((prev) => prev || json.user.accounts[0]?.id || "");
  }, []);

  useEffect(() => {
    load().then(() => {
      const q = new URLSearchParams(window.location.search);
      const t = q.get("tab");
      if (tabs.some(([id]) => id === t)) setTab(t as (typeof tabs)[number][0]);
      const ig = q.get("ig");
      if (ig === "ok") setMsg("Instagram akkaunti ulandi.");
      if (ig === "demo") setMsg("Demo akkaunt ulandi. Endi «AI-konnektor» bo'limidan Claude'ni ulang.");
    });
  }, [load]);

  useEffect(() => {
    if (!accountId) return;
    fetch(`/api/rules?accountId=${accountId}`)
      .then((r) => r.json())
      .then((j) => setRules(j.rules || []));
    fetch(`/api/logs?accountId=${accountId}`)
      .then((r) => r.json())
      .then((j) => setLogs(j.logs || []));
    fetch(`/api/analytics?accountId=${accountId}`)
      .then((r) => r.json())
      .then((j) => setMedia(j.media || []));
  }, [accountId, tab]);

  const loadUploads = useCallback(async () => {
    const j = await (await fetch("/api/uploads")).json();
    setUploads(j.uploads || []);
    return (j.uploads || []) as Upload[];
  }, []);

  useEffect(() => {
    if (tab !== "publish") return;
    fetch("/api/uploads")
      .then((r) => r.json())
      .then((j) => setUploads(j.uploads || []));
  }, [tab]);

  // XHR rather than fetch: it reports upload progress, which matters for 100 MB videos
  function uploadFile(file: File) {
    setMsg("");
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = async () => {
      setProgress(null);
      const j = JSON.parse(xhr.responseText || "{}");
      if (xhr.status !== 200) return setMsg(j.error || "Yuklanmadi");
      await loadUploads();
      setSelected(j.upload.id);
      setMsg("Fayl yuklandi. Endi matn yozib «Joylash» ni bosing yoki Claude'ga «yukladim» deb yozing.");
    };
    xhr.onerror = () => {
      setProgress(null);
      setMsg("Yuklashda tarmoq xatosi");
    };
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  }

  async function publish(form: FormData) {
    if (!account || !selected) return;
    const post = form.get("post") === "on";
    const story = form.get("story") === "on";
    if (!post && !story) return setMsg("Post yoki Story ni belgilang");
    setPublishing(true);
    setMsg("Instagram faylni qayta ishlamoqda — 1–2 daqiqa kuting…");
    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        uploadId: selected,
        caption: String(form.get("caption") || ""),
        locationId: String(form.get("locationId") || ""),
        collaborators: String(form.get("collaborators") || ""),
        post,
        story,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setPublishing(false);
    setMsg(res.ok ? `Instagramga joylandi ✅ (${[post && "post", story && "story"].filter(Boolean).join(" + ")})` : `Joylanmadi: ${j.error || "xato"}`);
    if (res.ok) setSelected("");
    await loadUploads();
  }

  useEffect(() => {
    if (tab !== "mcp") return;
    fetch("/api/connections")
      .then((r) => r.json())
      .then((j) => setConnections(j.connections || []));
  }, [tab]);

  useEffect(() => {
    fetch("/api/approvals")
      .then((r) => r.json())
      .then((j) => setApprovals(j.approvals || []));
  }, [tab]);

  const mcpUrl = user?.mcpUrl || "";
  const localOnly = useMemo(() => /^http:\/\/(localhost|127\.|\[::1\])/.test(mcpUrl), [mcpUrl]);

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  }

  async function refreshMedia() {
    if (!account) return;
    setSyncing(true);
    const j = await (await fetch(`/api/analytics?accountId=${account.id}&refresh=1`)).json();
    setMedia(j.media || []);
    setSyncing(false);
    if (j.syncError) setMsg(`Instagram: ${j.syncError}`);
  }

  async function addRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!account) return;
    // currentTarget is null once we await, so keep the form for reset().
    const form = e.currentTarget;
    const fd = new FormData(form);
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        type: fd.get("type"),
        keywords: String(fd.get("keywords") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        dmMessage: fd.get("dmMessage"),
        publicReplies: String(fd.get("publicReplies") || "Direct'ga yubordik 📩")
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean),
        matchMode: fd.get("matchMode"),
      }),
    });
    const saved = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(saved.error || "Qoida saqlanmadi");
      return;
    }
    form.reset();
    setMsg("Qoida qo'shildi.");
    const j = await (await fetch(`/api/rules?accountId=${account.id}`)).json();
    setRules(j.rules || []);
  }

  async function decide(id: string, decision: "approve" | "reject") {
    await fetch("/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
    const j = await (await fetch("/api/approvals")).json();
    setApprovals(j.approvals || []);
  }

  if (!user) {
    return <p className="p-10 text-[var(--muted)]">Yuklanmoqda…</p>;
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="glass p-5 md:sticky md:top-0 md:h-screen md:rounded-none">
        <Link href="/" className="display text-xl">
          instagram<span className="gradient-text">cloud</span>
        </Link>
        <p className="mt-2 text-xs text-[var(--muted)]">{user.email}</p>
        <nav className="mt-6 grid gap-1">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-200 ${
                tab === id ? "bg-gradient-to-r from-sky-400 to-blue-600 text-white shadow-md shadow-blue-500/30" : "text-[var(--muted)] hover:bg-sky-500/10 hover:text-[var(--brand)]"
              }`}
            >
              {label}
              {id === "approvals" && approvals.filter((a) => a.status === "pending").length > 0
                ? ` (${approvals.filter((a) => a.status === "pending").length})`
                : ""}
            </button>
          ))}
        </nav>
        <button
          className="btn btn-ghost mt-8 w-full !py-2 text-sm"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/";
          }}
        >
          Chiqish
        </button>
      </aside>

      <main className="p-6 md:p-10">
        {msg && <p className="mb-4 rounded-xl bg-[var(--mint)]/10 px-4 py-2 text-sm text-[var(--mint)]">{msg}</p>}

        {!account && tab === "home" && (
          <section key={tab} className="rise">
            <h1 className="display text-4xl">Instagramni ulang</h1>
            <p className="mt-3 max-w-xl text-[var(--muted)]">
              Instagramga o&apos;tasiz, u yerda kirasiz va ruxsatni tasdiqlaysiz. Boshqa usul yo&apos;q.
            </p>
            <div className="mt-6">
              <a href={user.igConfigured ? "/api/instagram/connect" : "/connect/instagram"} className="btn btn-primary">
                Instagramni ulash
              </a>
            </div>
          </section>
        )}

        {account && tab === "home" && (
          <section key={tab} className="rise">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="display text-4xl">@{account.username}</h1>
                <p className="mt-2 text-[var(--muted)]">
                  {account.followersCount.toLocaleString()} obunachi
                  {account.isDemo && <span className="ml-2 rounded-full bg-[var(--amber)]/15 px-2 py-0.5 text-xs text-[var(--amber)]">demo</span>}
                </p>
                <a href="/connect/instagram" className="mt-2 inline-block text-sm text-[var(--amber)]">
                  Boshqa Instagram ulash
                </a>
              </div>
              {user.accounts.length > 1 && (
                <select value={account.id} onChange={(e) => setAccountId(e.target.value)}>
                  {user.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.username}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="glass rounded-2xl p-5">
                <p className="text-sm text-[var(--muted)]">Qoidalar</p>
                <p className="display text-3xl">{rules.length}</p>
              </div>
              <div className="glass rounded-2xl p-5">
                <p className="text-sm text-[var(--muted)]">Jurnal</p>
                <p className="display text-3xl">{logs.length}</p>
              </div>
              <div className="glass rounded-2xl p-5">
                <p className="text-sm text-[var(--muted)]">Kutayotgan tasdiq</p>
                <p className="display text-3xl">{approvals.filter((a) => a.status === "pending").length}</p>
              </div>
            </div>

            {!account.isDemo && (
              <div
                className={`mt-8 rounded-2xl p-5 text-sm ${
                  account.lastWebhookAt ? "glass" : "bg-[var(--amber)]/10 text-[var(--amber)]"
                }`}
              >
                {account.lastWebhookAt ? (
                  <p>
                    ✅ Instagram xabarlari kelyapti — oxirgisi {new Date(account.lastWebhookAt).toLocaleString()}. Avto-javoblar
                    ishlayapti.
                  </p>
                ) : (
                  <>
                    <p className="font-semibold">⚠️ Instagram&apos;dan hali bitta ham komment yoki Direct xabari kelmadi</p>
                    <p className="mt-2">
                      Qoidalar saqlangan, lekin Meta webhook yubormaguncha ishlamaydi. developers.facebook.com → ilovangiz →
                      Instagram → <b>API setup with Instagram login</b>:
                    </p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5">
                      <li>
                        <b>Configure webhooks</b> → Callback URL: <code>{user.mcpUrl.replace(/\/mcp$/, "")}/api/webhooks/instagram</code>,
                        Verify token: Render → Environment → <code>INSTAGRAM_WEBHOOK_VERIFY_TOKEN</code> → <b>Verify and save</b>.
                      </li>
                      <li><b>comments</b> va <b>messages</b> maydonlarini <b>Subscribe</b> qiling.</li>
                      <li>
                        Shu akkaunt uchun <b>Generate token</b> qatoridagi <b>Webhook subscription</b> ni yoqing.
                      </li>
                      <li>
                        Ilova <b>Development</b> rejimida bo&apos;lsa, faqat ilovada roli bor (Tester) odamlarning
                        komment/xabarlari keladi. Hamma uchun ishlashi uchun ilovani <b>Live</b> qiling (Privacy policy:{" "}
                        <code>{user.mcpUrl.replace(/\/mcp$/, "")}/privacy</code>).
                      </li>
                    </ol>
                    <p className="mt-2">Sinash: boshqa akkauntdan postga «narx» deb yozing — bu yozuv yashil bo&apos;lishi kerak.</p>
                  </>
                )}
              </div>
            )}

            <form
              className="glass mt-8 grid gap-3 rounded-2xl p-6 md:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                await fetch("/api/account", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    accountId: account.id,
                    dmAutoReplyEnabled: fd.get("dmOn") === "on",
                    commentRepliesOn: fd.get("commentOn") === "on",
                    defaultDmMode: fd.get("defaultDmMode"),
                    defaultDmReply: fd.get("defaultDmReply"),
                  }),
                });
                await load();
                setMsg("Sozlamalar saqlandi.");
              }}
            >
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="commentOn" defaultChecked={account.commentRepliesOn} className="w-auto" />
                Komment avto-javob
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="dmOn" defaultChecked={account.dmAutoReplyEnabled} className="w-auto" />
                Direct avto-javob
              </label>
              <select name="defaultDmMode" defaultValue={account.defaultDmMode}>
                <option value="first">Standart javob: faqat birinchi xabar</option>
                <option value="daily">Standart javob: kuniga bir marta</option>
                <option value="always">Standart javob: har doim</option>
                <option value="off">Standart javob yo&apos;q</option>
              </select>
              <textarea
                name="defaultDmReply"
                rows={2}
                defaultValue={account.defaultDmReply}
                placeholder="Kalit so'z mos kelmasa yuboriladigan matn"
              />
              <div className="flex flex-wrap gap-3 md:col-span-2">
                <button className="btn btn-primary">Saqlash</button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    await fetch("/api/instagram/disconnect", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ accountId: account.id }),
                    });
                    setAccountId("");
                    await load();
                  }}
                >
                  Akkauntni uzish
                </button>
              </div>
            </form>

          </section>
        )}

        {account && tab === "publish" && (
          <section key={tab} className="rise">
            <h1 className="display text-4xl">Video va rasm joylash</h1>
            <p className="mt-3 max-w-2xl text-[var(--muted)]">
              Faylni shu yerga yuklang — keyin o&apos;zingiz joylaysiz yoki Claude&apos;ga «yukladim, joyla» deysiz. Video:
              MP4/MOV, 9:16, 3–90 soniya, 100 MB gacha. Rasm: faqat JPEG.
            </p>
            <label className="glass mt-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line)] p-8 text-center">
              <input
                type="file"
                accept="video/mp4,video/quicktime,image/jpeg"
                className="hidden"
                disabled={progress !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFile(f);
                  e.target.value = "";
                }}
              />
              <span className="display text-2xl">{progress !== null ? `Yuklanmoqda… ${progress}%` : "Fayl tanlash"}</span>
              <span className="mt-1 text-sm text-[var(--muted)]">telefon yoki kompyuterdan</span>
            </label>

            <div className="mt-6 space-y-2">
              {uploads.map((u) => (
                <label
                  key={u.id}
                  className={`glass flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${u.available ? "cursor-pointer" : "opacity-50"} ${
                    selected === u.id ? "border-[var(--pink)]" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="upload"
                    disabled={!u.available}
                    checked={selected === u.id}
                    onChange={() => setSelected(u.id)}
                  />
                  <span>{u.kind === "image" ? "🖼" : "🎬"}</span>
                  <span className="flex-1 truncate">{u.filename}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {(u.size / 1024 / 1024).toFixed(1)} MB ·{" "}
                    {u.publishedId ? "joylangan" : u.available ? new Date(u.createdAt).toLocaleString() : "muddati o'tgan"}
                  </span>
                </label>
              ))}
              {!uploads.length && <p className="text-sm text-[var(--muted)]">Hali fayl yuklanmagan.</p>}
            </div>

            <form
              className="glass mt-6 grid gap-3 rounded-2xl p-5"
              onSubmit={(e) => {
                e.preventDefault();
                publish(new FormData(e.currentTarget));
              }}
            >
              <div className="flex flex-wrap gap-5 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="post" defaultChecked /> Post / Reels (lentada)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="story" /> Story (24 soat)
                </label>
              </div>
              <textarea name="caption" rows={4} placeholder="Post matni (caption), heshteglar" />
              <input name="collaborators" placeholder="Hamkorlar (collab): username1, username2 — 3 tagacha" />
              <input
                name="locationId"
                inputMode="numeric"
                defaultValue={SHAHRISABZ_LOCATION_ID}
                placeholder="Lokatsiya: joyning Facebook sahifa ID si (bo'sh — lokatsiyasiz)"
              />
              <p className="text-xs text-[var(--muted)]">
                Standart lokatsiya — Shahrisabz shahri ({SHAHRISABZ_LOCATION_ID}). Boshqa joy uchun instagram.com/explore/locations/
                sahifasidagi uzun raqamli ID ni qo&apos;ying, kerak bo&apos;lmasa o&apos;chirib tashlang.
              </p>
              <p className="text-xs text-[var(--muted)]">
                Story&apos;ga matn, lokatsiya va hamkor qo&apos;shilmaydi — bu Instagram API cheklovi. Hamkorlar taklifni qabul
                qilgach, post ularning profilida ham ko&apos;rinadi.
              </p>
              <button className="btn btn-primary" disabled={!selected || publishing}>
                {publishing ? "Joylanmoqda…" : `@${account.username} ga joylash`}
              </button>
            </form>
          </section>
        )}

        {account && tab === "rules" && (
          <section key={tab} className="rise">
            <h1 className="display text-4xl">Kalit so&apos;z qoidalari</h1>
            <form onSubmit={addRule} className="glass mt-6 grid gap-3 rounded-2xl p-5 md:grid-cols-2">
              <select name="type" defaultValue="comment">
                <option value="comment">Komment → Direct</option>
                <option value="dm">Direct xabar</option>
              </select>
              <select name="matchMode" defaultValue="contains">
                <option value="contains">Kalit so&apos;z bor bo&apos;lsa</option>
                <option value="any">Istalgan komment</option>
              </select>
              <input name="keywords" placeholder="narx, necha pul, qancha (istalgan komment uchun bo'sh qoldiring)" className="md:col-span-2" />
              <textarea name="dmMessage" required placeholder="Direct'ga yuboriladigan matn" rows={3} className="md:col-span-2" />
              <input name="publicReplies" placeholder="Ochiq javoblar | navbat bilan" className="md:col-span-2" />
              <button className="btn btn-primary md:col-span-2">Qoida qo&apos;shish</button>
            </form>
            <div className="mt-6 space-y-3">
              {rules.map((r) => (
                <article key={r.id} className="glass rounded-2xl p-5">
                  <div className="flex justify-between gap-3">
                    <p className="text-sm uppercase text-[var(--amber)]">{r.type}</p>
                    <button
                      className="text-sm text-[var(--pink)]"
                      onClick={async () => {
                        await fetch(`/api/rules?id=${r.id}`, { method: "DELETE" });
                        setRules((prev) => prev.filter((x) => x.id !== r.id));
                      }}
                    >
                      O&apos;chirish
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {(parseJson(r.keywords) as string[]).join(", ")} · {r.matchMode}
                  </p>
                  <p className="mt-2">{r.dmMessage}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {account && tab === "log" && (
          <section key={tab} className="rise">
            <h1 className="display text-4xl">Xabarlar jurnali</h1>
            <div className="mt-6 space-y-2">
              {logs.map((l) => (
                <div key={l.id} className="glass rounded-xl px-4 py-3 text-sm">
                  <span className="text-[var(--muted)]">
                    {new Date(l.createdAt).toLocaleString()} · {l.kind} · {l.direction}
                    {l.username ? ` · @${l.username}` : ""}
                  </span>
                  <p className="mt-1">{l.text}</p>
                  {l.replyText && <p className="text-[var(--mint)]">DM: {l.replyText}</p>}
                </div>
              ))}
              {!logs.length && <p className="text-[var(--muted)]">Hali yozishma yo&apos;q.</p>}
            </div>
          </section>
        )}

        {account && tab === "analytics" && (
          <section key={tab} className="rise">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h1 className="display text-4xl">Postlar va Reels</h1>
              {!account.isDemo && (
                <button className="btn btn-ghost !py-2 text-sm" onClick={refreshMedia} disabled={syncing}>
                  {syncing ? "Yangilanmoqda…" : "Instagram'dan yangilash"}
                </button>
              )}
            </div>
            <div className="glass mt-6 overflow-x-auto rounded-2xl p-4">
              <table>
                <thead>
                  <tr>
                    <th>Post</th>
                    <th>Tur</th>
                    <th>Ko&apos;rish</th>
                    <th>Qamrov</th>
                    <th>Like</th>
                    <th>Ulashish/qamrov</th>
                    <th>O&apos;rt. s</th>
                    <th>Saqlash</th>
                  </tr>
                </thead>
                <tbody>
                  {media.map((m) => (
                    <tr key={m.id}>
                      <td className="max-w-[280px] truncate">
                        {m.permalink ? <a href={m.permalink} target="_blank" rel="noreferrer">{m.caption || "—"}</a> : m.caption || "—"}
                      </td>
                      <td className="text-xs text-[var(--muted)]">{m.mediaType}</td>
                      <td>{m.views.toLocaleString()}</td>
                      <td>{m.reach.toLocaleString()}</td>
                      <td>{m.likes.toLocaleString()}</td>
                      <td>{m.reach ? `${((m.shares / m.reach) * 100).toFixed(1)}%` : "—"}</td>
                      <td>{m.avgWatchSec}</td>
                      <td>{m.saves.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!media.length && <p className="p-4 text-[var(--muted)]">Hali media yo&apos;q.</p>}
            </div>
          </section>
        )}

        {tab === "mcp" && (
          <section key={tab} className="rise">
            <h1 className="display text-4xl">Claude&apos;ga ulash</h1>
            <p className="mt-3 max-w-2xl text-[var(--muted)]">
              Bitta manzil — Claude Instagramingizni ko&apos;radi va boshqaradi: statistika, kommentlar,
              Direct, avto-javoblar, Reels. Token yoki parol kiritish shart emas — Claude sizni shu saytga
              yuboradi, siz «Ruxsat berish» ni bosasiz.
            </p>

            <div className="glass mt-6 space-y-3 rounded-2xl p-5">
              <p className="text-xs uppercase text-[var(--muted)]">Konnektor manzili (MCP URL)</p>
              <div className="flex gap-2">
                <code className="block flex-1 break-all rounded-xl bg-[var(--ice)] p-3">{mcpUrl}</code>
                <button className="btn btn-primary !px-4 !py-2 text-sm" onClick={() => copy(mcpUrl, "url")}>
                  {copied === "url" ? "Nusxalandi" : "Nusxa"}
                </button>
              </div>
              {localOnly && (
                <p className="rounded-xl bg-[var(--amber)]/10 px-4 py-3 text-sm text-[var(--amber)]">
                  Bu manzil faqat shu kompyuterda ochiladi — claude.ai unga yetib bora olmaydi. Saytni
                  internetga chiqaring (masalan <code>cloudflared tunnel --url http://localhost:3001</code>) va
                  saytni o&apos;sha https manzil orqali oching — bu yerda https manzil chiqadi.
                </p>
              )}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <article className="glass rounded-2xl p-5 text-sm">
                <h3 className="display text-2xl">Claude (claude.ai, ilova)</h3>
                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[var(--muted)]">
                  <li>claude.ai → <b className="text-[var(--fg)]">Settings → Connectors</b></li>
                  <li><b className="text-[var(--fg)]">Add custom connector</b></li>
                  <li>Name: <b className="text-[var(--fg)]">Instagram Cloud</b>, URL: yuqoridagi manzil → <b className="text-[var(--fg)]">Add</b></li>
                  <li><b className="text-[var(--fg)]">Connect</b> → shu sayt ochiladi → <b className="text-[var(--fg)]">Ruxsat berish</b></li>
                  <li>Chatda: «Instagramimda bu oy qaysi Reels yaxshi ishladi?»</li>
                </ol>
              </article>
              <article className="glass rounded-2xl p-5 text-sm">
                <h3 className="display text-2xl">Claude Code, Cursor, ChatGPT</h3>
                <p className="mt-3 text-[var(--muted)]">Claude Code (brauzerda ruxsat so&apos;raydi):</p>
                <pre className="mt-1 overflow-x-auto rounded-xl bg-[var(--ice)] p-3 text-xs">{`claude mcp add --transport http instagram-cloud ${mcpUrl}`}</pre>
                <p className="mt-3 text-[var(--muted)]">
                  ChatGPT: Settings → Apps &amp; Connectors → Developer mode → Create → shu URL, OAuth.
                </p>
                <p className="mt-3 text-[var(--muted)]">OAuth bo&apos;lmagan mijozlar uchun shaxsiy token:</p>
                <div className="mt-1 flex gap-2">
                  <code className="block flex-1 break-all rounded-xl bg-[var(--ice)] p-3 text-xs">{user.mcpToken}</code>
                  <button className="btn btn-ghost !px-3 !py-1 text-xs" onClick={() => copy(user.mcpToken, "token")}>
                    {copied === "token" ? "✓" : "Nusxa"}
                  </button>
                </div>
                <button
                  className="mt-2 text-xs text-[var(--pink)]"
                  onClick={async () => {
                    if (!confirm("Eski token ishlamay qoladi. Davom etasizmi?")) return;
                    await fetch("/api/settings", { method: "POST" });
                    await load();
                  }}
                >
                  Tokenni yangilash
                </button>
              </article>
            </div>

            <div className="glass mt-6 rounded-2xl p-5">
              <h3 className="display text-2xl">AI yozish harakatlari</h3>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Kommentga javob, Direct, qoida o&apos;zgartirish, Reels joylash — qanday tasdiqlanadi?
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {(
                  [
                    ["chat", "Chatda so'raydi", "AI matnni ko'rsatadi, «ha» desangiz bajaradi. Claude ham har bir harakatdan oldin ruxsat so'raydi."],
                    ["dashboard", "Faqat kabinetda «Ha»", "AI faqat navbatga qo'yadi. «AI harakatlari» bo'limida «Ha» bosmaguningizcha hech narsa ketmaydi."],
                  ] as const
                ).map(([value, title, desc]) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-2xl border p-4 text-sm ${
                      user.aiApproval === value ? "border-[var(--pink)] bg-[var(--pink)]/5" : "border-[var(--line)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="aiApproval"
                      className="mr-2"
                      checked={user.aiApproval === value}
                      onChange={async () => {
                        await fetch("/api/settings", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ aiApproval: value }),
                        });
                        await load();
                      }}
                    />
                    <b>{title}</b>
                    <p className="mt-1 text-[var(--muted)]">{desc}</p>
                  </label>
                ))}
              </div>
            </div>

            <div className="glass mt-6 rounded-2xl p-5">
              <h3 className="display text-2xl">Ulangan AI ilovalar</h3>
              <div className="mt-3 space-y-2">
                {connections.map((c) => (
                  <div key={c.clientId} className="flex items-center justify-between gap-3 rounded-xl bg-sky-500/5 px-4 py-3 text-sm">
                    <div>
                      <p>{c.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {new Date(c.since).toLocaleDateString()} dan
                        {c.lastUsedAt ? ` · oxirgi marta ${new Date(c.lastUsedAt).toLocaleString()}` : ""}
                      </p>
                    </div>
                    <button
                      className="text-sm text-[var(--pink)]"
                      onClick={async () => {
                        await fetch(`/api/connections?clientId=${encodeURIComponent(c.clientId)}`, { method: "DELETE" });
                        setConnections((prev) => prev.filter((x) => x.clientId !== c.clientId));
                      }}
                    >
                      Uzish
                    </button>
                  </div>
                ))}
                {!connections.length && (
                  <p className="text-sm text-[var(--muted)]">Hali hech qaysi AI ulanmagan.</p>
                )}
              </div>
            </div>
          </section>
        )}

        {tab === "approvals" && (
          <section key={tab} className="rise">
            <h1 className="display text-4xl">AI harakatlari</h1>
            <p className="mt-2 text-[var(--muted)]">
              {user.aiApproval === "dashboard"
                ? "AI hech narsani o'zi yubormaydi — avval shu yerda «Ha»."
                : "AI chatda tasdiqlab bajargan harakatlar. Kabinetda tasdiqlashni «AI-konnektor» bo'limida yoqish mumkin."}
            </p>
            <div className="mt-6 space-y-3">
              {approvals.map((a) => (
                <article key={a.id} className="glass rounded-2xl p-5">
                  <p className="text-xs uppercase text-[var(--amber)]">
                    {a.toolName} · {a.status}
                  </p>
                  <p className="mt-2">{a.summary}</p>
                  {a.status === "pending" && (
                    <div className="mt-3 flex gap-2">
                      <button className="btn btn-primary !py-2" onClick={() => decide(a.id, "approve")}>
                        Ha, bajar
                      </button>
                      <button className="btn btn-ghost !py-2" onClick={() => decide(a.id, "reject")}>
                        Yo&apos;q
                      </button>
                    </div>
                  )}
                </article>
              ))}
              {!approvals.length && <p className="text-[var(--muted)]">Hozircha so&apos;rov yo&apos;q.</p>}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
