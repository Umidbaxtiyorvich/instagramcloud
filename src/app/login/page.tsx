"use client";

import Link from "next/link";
import { useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error || "Xato");
      return;
    }
    window.location.href = "/dashboard";
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="display mb-8 text-2xl">
        instagram<span className="text-[var(--pink)]">cloud</span>
      </Link>
      <h1 className="display text-4xl">Kirish</h1>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <input name="email" type="email" required placeholder="Email" />
        <input name="password" type="password" required placeholder="Parol" />
        {error && <p className="text-sm text-[var(--pink)]">{error}</p>}
        <button className="btn btn-primary w-full" disabled={loading}>
          {loading ? "Kutilmoqda…" : "Kirish"}
        </button>
      </form>
      <p className="mt-4 text-sm text-[var(--muted)]">
        Akkaunt yo&apos;qmi? <Link href="/register">Ro&apos;yxatdan o&apos;tish</Link>
      </p>
    </main>
  );
}
