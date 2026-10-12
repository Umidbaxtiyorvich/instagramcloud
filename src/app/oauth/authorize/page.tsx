import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { validateAuthorize } from "@/lib/oauth";

export const dynamic = "force-dynamic";

const PASS = ["client_id", "redirect_uri", "state", "response_type", "code_challenge", "code_challenge_method"];

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") q.set(k, v);

  const v = await validateAuthorize(q);
  if ("fatal" in v) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <h1 className="display text-3xl">Ulanib bo&apos;lmadi</h1>
        <p className="mt-4 text-[var(--muted)]">{v.fatal}</p>
      </main>
    );
  }
  if ("redirect" in v) redirect(v.redirect);

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${q}`)}`);

  const host = new URL(v.req.redirectUri).host || v.req.redirectUri;
  const accounts = user.accounts.map((a) => `@${a.username}`);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="display mb-8 text-2xl">
        instagram<span className="text-[var(--pink)]">cloud</span>
      </Link>
      <h1 className="display text-4xl">{v.client.name} ulanmoqchi</h1>
      <p className="mt-4 text-[var(--muted)]">
        <span className="text-[var(--fg)]">{v.client.name}</span> ({host}) sizning{" "}
        {accounts.length ? accounts.join(", ") : "Instagram"} akkauntingizga kirish so&apos;ramoqda.
      </p>
      <ul className="glass mt-6 space-y-2 rounded-2xl p-5 text-sm text-[var(--muted)]">
        <li>• Statistika, postlar, Reels, kommentlar va Direct&apos;ni o&apos;qish</li>
        <li>• Kommentga javob, Direct yuborish, avto-javob qoidalarini sozlash</li>
        <li>
          • Yozish harakatlari:{" "}
          {user.aiApproval === "dashboard"
            ? "kabinetdagi «AI harakatlari»da «Ha» bosmaguningizcha yuborilmaydi"
            : "AI avval chatda matnni ko'rsatib, sizdan so'raydi"}
        </li>
        <li>• Instagram parolingiz hech qachon so&apos;ralmaydi</li>
      </ul>
      {!accounts.length && (
        <p className="mt-4 rounded-xl bg-[var(--amber)]/10 px-4 py-3 text-sm text-[var(--amber)]">
          Hali Instagram ulanmagan. Ruxsat bersangiz ham bo&apos;ladi — keyin kabinetda ulaysiz.
        </p>
      )}
      <p className="mt-4 text-xs text-[var(--muted)]">Kirgansiz: {user.email}</p>
      <form method="post" action="/api/oauth/approve" className="mt-6 grid grid-cols-2 gap-3">
        {PASS.map((k) => (
          <input key={k} type="hidden" name={k} value={k === "redirect_uri" ? v.req.redirectUri : q.get(k) || ""} />
        ))}
        <button name="decision" value="deny" className="btn btn-ghost">
          Rad etish
        </button>
        <button name="decision" value="allow" className="btn btn-primary">
          Ruxsat berish
        </button>
      </form>
    </main>
  );
}
