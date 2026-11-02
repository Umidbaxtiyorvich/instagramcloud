"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function ConnectInstagramPage() {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");
  const [demoName, setDemoName] = useState("");
  const [busy, setBusy] = useState(false);

  async function connectDemo() {
    setBusy(true);
    const res = await fetch("/api/instagram/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve", username: demoName || "demo.shop" }),
    });
    setBusy(false);
    if (res.ok) window.location.href = "/dashboard?ig=demo";
    else setError("Demo akkaunt yaratilmadi.");
  }

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((j) => {
        if (!j.user) {
          window.location.href = "/login";
          return;
        }
        return fetch("/api/instagram/status");
      })
      .then((r) => r?.json())
      .then((j) => {
        const errors: Record<string, string> = {
          denied: "Instagramda ruxsat berilmadi.",
          error: "Instagram bilan ulanishda xato. Qayta urinib ko'ring.",
          state: "Sessiya eskirgan. Qayta urinib ko'ring.",
          return: "Meta ilovasi sozlanmaguncha haqiqiy Instagramni ulab bo'lmaydi. Pastdagi demo bilan sinab ko'ring.",
        };
        const ig = new URLSearchParams(window.location.search).get("ig") || "";
        if (errors[ig]) setError(errors[ig]);
        setOrigin(window.location.origin);
        if (j) setConfigured(Boolean(j.configured));
        setReady(true);
      });
  }, []);

  if (!ready) return <p className="p-10 text-[var(--muted)]">Yuklanmoqda…</p>;

  return (
    <main className="rise mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <Link href="/" className="display mb-8 text-2xl">
        instagram<span className="gradient-text">cloud</span>
      </Link>
      <h1 className="display text-4xl">Instagramni ulash</h1>
      <p className="mt-4 text-[var(--muted)]">
        Ruxsat oynasi ochiladi. U yerda kirasiz, Instagram akkauntini tasdiqlaysiz — keyin saytga
        qaytasiz va ulanadi.
      </p>
      <ol className="mt-6 space-y-2 text-sm text-[var(--muted)]">
        <li>1. «Instagramni ulash»</li>
        <li>2. Kirish va ruxsatni tasdiqlash</li>
        <li>3. Avtomatik kabinetga qaytish</li>
      </ol>
      {!configured && (
        <div className="glass mt-6 rounded-2xl p-5 text-sm text-[var(--muted)]">
          <p className="text-[var(--fg)]">Meta ilovasi hali sozlanmagan.</p>
          <p className="mt-2">
            Haqiqiy Instagramni ulash uchun developers.facebook.com da ilova yarating (Instagram API with
            Instagram Login), `.env` ga `INSTAGRAM_APP_ID` va `INSTAGRAM_APP_SECRET` ni yozing. Redirect URL:
          </p>
          <code className="mt-2 block break-all rounded-xl bg-[var(--ice)] p-3 text-xs">
            {origin}/api/instagram/callback
          </code>
          <p className="mt-3">Webhook URL (komment va Direct avto-javoblari uchun):</p>
          <code className="mt-2 block break-all rounded-xl bg-[var(--ice)] p-3 text-xs">
            {origin}/api/webhooks/instagram
          </code>
        </div>
      )}
      {error && <p className="mt-6 rounded-xl bg-[var(--pink)]/10 px-4 py-3 text-sm text-[var(--pink)]">{error}</p>}
      {configured ? (
        <a href="/api/instagram/connect" className="btn btn-primary mt-8 w-full">
          Instagramni ulash
        </a>
      ) : (
        <button className="btn btn-primary mt-8 w-full opacity-40" disabled>
          Instagramni ulash
        </button>
      )}
      {!configured && (
        <div className="glass mt-6 rounded-2xl p-5">
          <p className="text-sm text-[var(--fg)]">Hozircha demo bilan sinab ko&apos;ring</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Namuna Reels va qoidalar bilan soxta akkaunt. Claude&apos;ni ulab, hammasini sinash mumkin —
            Instagramga hech narsa yuborilmaydi.
          </p>
          <input
            className="mt-3"
            value={demoName}
            onChange={(e) => setDemoName(e.target.value)}
            placeholder="demo.shop"
          />
          <button onClick={connectDemo} disabled={busy} className="btn btn-ghost mt-3 w-full">
            {busy ? "Yaratilmoqda…" : "Demo akkaunt ulash"}
          </button>
        </div>
      )}
      <Link href="/dashboard" className="mt-4 text-center text-sm text-[var(--muted)]">
        Kabinetga qaytish
      </Link>
    </main>
  );
}
