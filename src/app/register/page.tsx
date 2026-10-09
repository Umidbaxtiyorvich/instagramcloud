"use client";

import Link from "next/link";
import { useState } from "react";

export default function RegisterPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        email: fd.get("email"),
        password: fd.get("password"),
      }),
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
      <h1 className="display text-4xl">Akkaunt yarating</h1>
      <p className="mt-2 text-[var(--muted)]">Email va parol — boshqa hech narsa.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <input name="name" placeholder="Ism" />
        <input name="email" type="email" required placeholder="Email" />
        <input name="password" type="password" required minLength={8} placeholder="Parol (8+)" />
        {error && <p className="text-sm text-[var(--pink)]">{error}</p>}
        <button className="btn btn-primary w-full" disabled={loading}>
          {loading ? "Yaratilmoqda…" : "Boshlash"}
        </button>
      </form>
      <p className="mt-4 text-sm text-[var(--muted)]">
        Allaqachon bormi? <Link href="/login">Kirish</Link>
      </p>
    </main>
  );
}
