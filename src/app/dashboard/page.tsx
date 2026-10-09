"use client";

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
};

type User = {
  email: string;
  name: string | null;
  mcpToken: string;
  accounts: Account[];
};

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
  mediaType: string;
  views: number;
  reach: number;
  shares: number;
  saves: number;
  avgWatchSec: number;
};

const tabs = [
  ["home", "Boshqaruv"],
  ["rules", "Qoidalar"],
  ["log", "Jurnal"],
  ["analytics", "Tahlil"],
  ["mcp", "AI-konnektor"],
  ["approvals", "Tasdiqlar"],
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
    load();
    const q = new URLSearchParams(window.location.search);
    if (q.get("ig") === "ok") setMsg("Instagram akkaunti ulandi.");
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

  useEffect(() => {
    fetch("/api/approvals")
      .then((r) => r.json())
      .then((j) => setApprovals(j.approvals || []));
  }, [tab]);

  const mcpUrl = useMemo(() => {
    if (typeof window === "undefined" || !user) return "";
    // Use Cloudflare tunnel URL for production/external access
    return "https://paintings-brandon-pumps-way.trycloudflare.com/mcp";
  }, [user]);

  async function addRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!account) return;
    const fd = new FormData(e.currentTarget);
    await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        type: fd.get("type"),
        keywords: String(fd.get("keywords"))
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
    e.currentTarget.reset();
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
      <aside className="border-b border-[var(--line)] p-5 md:border-b-0 md:border-r">
        <a href="/" className="display text-xl">
          instagram<span className="text-[var(--pink)]">cloud</span>
        </a>
        <p className="mt-2 text-xs text-[var(--muted)]">{user.email}</p>
        <nav className="mt-6 grid gap-1">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-xl px-3 py-2 text-left text-sm ${
                tab === id ? "bg-white/10" : "text-[var(--muted)] hover:bg-white/5"
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
          <section>
            <h1 className="display text-4xl">Instagramni ulang</h1>
            <p className="mt-3 max-w-xl text-[var(--muted)]">
              Instagramga o&apos;tasiz, u yerda kirasiz va ruxsatni tasdiqlaysiz. Boshqa usul yo&apos;q.
            </p>
            <div className="mt-6">
              <a href="/api/instagram/connect" className="btn btn-primary">
                Instagramni ulash
              </a>
            </div>
          </section>
        )}

        {account && tab === "home" && (
          <section>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="display text-4xl">@{account.username}</h1>
                <p className="mt-2 text-[var(--muted)]">
                  {account.followersCount.toLocaleString()} obunachi
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

        {account && tab === "rules" && (
          <section>
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
              <input name="keywords" required placeholder="narx, necha pul, qancha" className="md:col-span-2" />
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
          <section>
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
          <section>
            <h1 className="display text-4xl">Reels hisoboti</h1>
            <div className="glass mt-6 overflow-x-auto rounded-2xl p-4">
              <table>
                <thead>
                  <tr>
                    <th>Video</th>
                    <th>Ko&apos;rish</th>
                    <th>Ulashish/qamrov</th>
                    <th>O&apos;rt. s</th>
                    <th>Saqlash</th>
                  </tr>
                </thead>
                <tbody>
                  {media.map((m) => (
                    <tr key={m.id}>
                      <td>{m.caption}</td>
                      <td>{m.views.toLocaleString()}</td>
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
          <section>
            <h1 className="display text-4xl">Claude, ChatGPT, Gemini</h1>
            <p className="mt-3 max-w-2xl text-[var(--muted)]">
              Shu manzilni MCP server sifatida qo&apos;ying. Token — shaxsiy kalitingiz. Yozish
              harakatlari kabinetdagi Tasdiqlar sahifasida «Ha» kutadi.
            </p>
            <div className="glass mt-6 space-y-3 rounded-2xl p-5">
              <p className="text-xs uppercase text-[var(--muted)]">MCP URL</p>
              <code className="block break-all rounded-xl bg-black/30 p-3">{mcpUrl}</code>
              <p className="text-xs uppercase text-[var(--muted)]">Bearer token</p>
              <code className="block break-all rounded-xl bg-black/30 p-3">{user.mcpToken}</code>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <article className="glass rounded-2xl p-5 text-sm">
                <h3 className="display text-xl">Claude</h3>
                <p className="mt-2 text-[var(--muted)]">
                  Settings → Connectors → Add custom connector → URL va token.
                </p>
              </article>
              <article className="glass rounded-2xl p-5 text-sm">
                <h3 className="display text-xl">ChatGPT</h3>
                <p className="mt-2 text-[var(--muted)]">
                  Developer mode → MCP servers → URL: {mcpUrl || "/mcp"}
                </p>
              </article>
              <article className="glass rounded-2xl p-5 text-sm">
                <h3 className="display text-xl">Cursor / Gemini CLI</h3>
                <pre className="mt-2 overflow-x-auto text-xs text-[var(--muted)]">{`{
  "mcpServers": {
    "instagram-cloud": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ${user.mcpToken}" }
    }
  }
}`}</pre>
              </article>
            </div>
          </section>
        )}

        {tab === "approvals" && (
          <section>
            <h1 className="display text-4xl">AI tasdiqlari</h1>
            <p className="mt-2 text-[var(--muted)]">
              Claude/ChatGPT/Gemini hech narsani o&apos;zi yubormaydi — avval shu yerda «Ha».
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
