"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function ConnectInstagramPage() {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("ig") === "denied") setError("Instagramda ruxsat berilmadi.");
    if (q.get("ig") === "error") setError("Instagram bilan ulanishda xato. Qayta urinib ko'ring.");
    if (q.get("ig") === "state") setError("Sessiya eskirgan. Qayta urinib ko'ring.");
    if (q.get("ig") === "return") {
      setError(
        "Hozir Instagram login ochilsa, u yerda qolib ketasiz. Tasdiq oynasi va saytga qaytish faqat ruxsat havolasi tayyor bo'lganda ishlaydi."
      );
    }

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
        if (j) setConfigured(Boolean(j.configured));
        setReady(true);
      });
  }, []);

  if (!ready) return <p className="p-10 text-[var(--muted)]">Yuklanmoqda…</p>;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <Link href="/" className="display mb-8 text-2xl">
        instagram<span className="text-[var(--pink)]">cloud</span>
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
          <p className="text-[var(--fg)]">Tasdiq + qaytish hali yoqilmagan.</p>
          <p className="mt-2">
            Instagram oddiy loginni ochsa, tasdiq so&apos;ramaydi va saytga qaytarmaydi. `.env` da
            `INSTAGRAM_APP_ID` va `INSTAGRAM_APP_SECRET` bo&apos;lishi kerak, redirect esa:
          </p>
          <code className="mt-2 block break-all rounded-xl bg-black/30 p-3 text-xs">
            http://localhost:3000/api/instagram/callback
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
      <Link href="/dashboard" className="mt-4 text-center text-sm text-[var(--muted)]">
        Kabinetga qaytish
      </Link>
    </main>
  );
}
