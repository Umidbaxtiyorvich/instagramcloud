import Link from "next/link";

const d = (s: number) => ({ "--d": `${s}s` }) as React.CSSProperties;

export default function Home() {
  return (
    <div>
      <header className="sticky top-3 z-20 mx-auto mt-3 flex max-w-6xl items-center justify-between rounded-full px-5 py-3 glass">
        <Link href="/" className="display text-xl">
          instagram<span className="gradient-text">cloud</span>
        </Link>
        <nav className="hidden gap-7 text-sm font-medium text-[var(--muted)] md:flex">
          <a href="#avto" className="transition-colors hover:text-[var(--brand)]">Avto-javoblar</a>
          <a href="#mcp" className="transition-colors hover:text-[var(--brand)]">AI-konnektor</a>
          <a href="#qadam" className="transition-colors hover:text-[var(--brand)]">Qanday ishlaydi</a>
        </nav>
        <div className="flex gap-2">
          <Link href="/login" className="btn btn-ghost !py-2 !px-4 text-sm">
            Kirish
          </Link>
          <Link href="/register" className="btn btn-primary !py-2 !px-4 text-sm">
            Boshlash
          </Link>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-16 md:grid-cols-[1.1fr_1fr] md:py-24">
        <div>
          <span className="chip rise" style={d(0)}>
            <span className="dot" /> Rasmiy Instagram API · 24/7 ishlaydi
          </span>
          <h1 className="display rise mt-6 mb-6 text-5xl leading-[1.04] md:text-7xl" style={d(0.1)}>
            O&apos;zi javob beradigan <span className="gradient-text">Instagram</span>
          </h1>
          <p className="rise mb-9 max-w-xl text-lg leading-relaxed text-[var(--muted)]" style={d(0.2)}>
            Odam kommentga kalit so&apos;z yozadi — bir soniyadan keyin Direct&apos;da narx yoki havolani oladi.
            Claude, ChatGPT yoki Gemini MCP orqali akkauntni boshqaradi: Reels, Story, javoblar va qoidalar.
          </p>
          <div className="rise flex flex-wrap gap-3" style={d(0.3)}>
            <Link href="/connect/instagram" className="btn btn-primary">
              Instagramni ulash →
            </Link>
            <a href="#mcp" className="btn btn-ghost">
              MCP manzilini ko&apos;rish
            </a>
          </div>
          <div className="rise mt-10 grid max-w-md grid-cols-3 gap-3" style={d(0.4)}>
            {[
              ["1 s", "javob tezligi"],
              ["24/7", "uyqusiz"],
              ["0", "parol so'ralmaydi"],
            ].map(([n, t]) => (
              <div key={t} className="glass rounded-2xl px-3 py-3 text-center">
                <p className="display text-2xl text-[var(--brand)]">{n}</p>
                <p className="text-xs text-[var(--muted)]">{t}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rise relative flex justify-center" style={d(0.25)}>
          <div className="absolute inset-10 -z-10 rounded-full bg-gradient-to-br from-sky-300/60 to-blue-500/40 blur-3xl" />
          <div className="phone float">
            <div className="p-4">
              <div className="flex items-center gap-2">
                <span className="h-8 w-8 rounded-full bg-gradient-to-br from-sky-400 to-blue-600" />
                <div>
                  <p className="text-xs font-semibold">yourbrand</p>
                  <p className="text-[10px] text-[var(--muted)]">Reels · Shahrisabz</p>
                </div>
              </div>
              <div className="mt-3 rounded-2xl bg-gradient-to-br from-sky-100 to-blue-100 p-4">
                <p className="text-sm font-semibold">Yangi kolleksiya ✨</p>
                <p className="mt-1 text-xs text-[var(--muted)]">«NARX» deb yozing — narxlarni Direct&apos;ga yuboramiz.</p>
              </div>
              <div className="mt-4 space-y-3">
                <div className="bubble rounded-2xl rounded-bl-md bg-white p-3 shadow-sm" style={d(0.9)}>
                  <p className="text-xs font-semibold text-[var(--brand)]">anna.k</p>
                  <p className="text-sm">NARX 🙏</p>
                </div>
                <div className="bubble ml-6 rounded-2xl rounded-br-md bg-gradient-to-br from-sky-400 to-blue-600 p-3 text-white shadow-md" style={d(1.6)}>
                  <p className="text-xs font-semibold opacity-80">yourbrand</p>
                  <p className="text-sm">Direct&apos;ga yubordik 📩</p>
                </div>
                <div className="bubble rounded-2xl border border-[var(--line)] bg-white/80 p-3" style={d(2.3)}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--mint)]">Direct · 1 soniya</p>
                  <p className="mt-1 text-sm">Anna, salom! Ko&apos;ylak — 390 000 so&apos;m. Buyurtma: yourbrand.uz/linen</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="avto" className="mx-auto max-w-6xl px-6 py-16">
        <div className="reveal">
          <span className="chip">Avto-javoblar</span>
          <h2 className="display mt-4 mb-3 text-4xl md:text-5xl">Kalit so&apos;zlar javob beradi</h2>
          <p className="mb-10 max-w-2xl text-[var(--muted)]">
            narx, havola, info, o&apos;lcham — har biriga nima ketishini belgilang. Bir marta sozlanadi, kechayu kunduz
            ishlaydi. «stop» — shu odam uchun avto-javob o&apos;chadi.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            ["💬", "Komment → Direct", "Post ostida so'z — Direct'da javob", "Ochiq javob ham chiqadi. Bitta post, bir nechtasi yoki hammasi. «Istalgan komment» rejimi ham bor."],
            ["⚡", "Direct xabarlari", "Narx, manzil, telefon — darhol", "Standart javob: birinchi xabarga, kuniga bir marta yoki har doim. Har bir yozishma jurnalda."],
            ["🎬", "Joylash", "Reels, post va Story", "Video yuklang — matn, lokatsiya va hamkorlar (collab) bilan bir bosishda joylanadi."],
          ].map(([icon, tag, title, text]) => (
            <article key={tag} className="reveal glass lift rounded-3xl p-7">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-sky-100 to-blue-200 text-2xl">{icon}</span>
              <p className="mt-5 text-sm font-semibold text-[var(--brand)]">{tag}</p>
              <h3 className="display mt-1 text-2xl">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="mcp" className="mx-auto max-w-6xl px-6 py-16">
        <div className="reveal">
          <span className="chip">AI-konnektor</span>
          <h2 className="display mt-4 mb-3 text-4xl md:text-5xl">Instagramni o&apos;z AI&apos;ingizdan so&apos;rang</h2>
          <p className="mb-8 max-w-2xl text-[var(--muted)]">
            Claude, ChatGPT yoki Gemini&apos;ga bitta MCP manzilini qo&apos;yasiz. U tahlil qiladi, Reels joylaydi,
            kommentga javob yozadi — siz ruxsat bergan doirada.
          </p>
        </div>
        <div className="reveal glass mb-8 overflow-x-auto rounded-3xl p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-8 w-8 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" />
            <p className="rounded-2xl bg-[var(--ice)] px-4 py-2 text-sm">«Bu oy qaysi Reels eng ko&apos;p ulashildi?»</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Video</th>
                <th>Ko&apos;rishlar</th>
                <th>Ulashish / qamrov</th>
                <th>O&apos;rt. ko&apos;rish</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Mikroto'lqinli pech qanday ishlaydi", "1.53M", "4.4%", "26 s"],
                ["Nega osmon ko'k", "412K", "3.1%", "21 s"],
                ["Yangi studiyamiz", "96K", "0.6%", "9 s"],
              ].map((r) => (
                <tr key={r[0]}>
                  {r.map((c) => (
                    <td key={c}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="grid gap-3 text-sm md:grid-cols-2">
          {[
            "Qamrov, ko'rishlar, ulashish, saqlash hisoboti",
            "Javobsiz kommentlar va tayyor javoblar",
            "Direct, ochiq javob, spamni yashirish",
            "Avto-javob qoidalarini yaratish va o'zgartirish",
            "Reels, post va Story joylash — lokatsiya va collab bilan",
            "Claude, ChatGPT, Gemini CLI, Cursor, VS Code, Claude Code",
          ].map((t) => (
            <li key={t} className="reveal glass flex items-center gap-3 rounded-2xl px-4 py-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-xs text-white">✓</span>
              {t}
            </li>
          ))}
        </ul>
      </section>

      <section id="qadam" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="reveal display mb-10 text-4xl md:text-5xl">Bir necha daqiqada</h2>
        <ol className="grid gap-5 md:grid-cols-4">
          {[
            ["1", "Akkaunt", "Email va parol — boshqa hech narsa."],
            ["2", "Instagram", "Rasmiy oyna. Business yoki Creator."],
            ["3", "Kalit so'zlar", "So'z va javob matnini yozing."],
            ["4", "AI ulash", "MCP manzilini Claude yoki ChatGPT'ga qo'ying."],
          ].map(([n, t, text]) => (
            <li key={n} className="reveal glass lift rounded-3xl p-6">
              <span className="display grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-lg text-white shadow-lg shadow-blue-500/30">
                {n}
              </span>
              <h3 className="display mt-4 text-xl">{t}</h3>
              <p className="mt-2 text-sm text-[var(--muted)]">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="reveal relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-sky-400 via-blue-600 to-indigo-600 p-10 text-center text-white shadow-2xl shadow-blue-500/30 md:p-14">
          <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-white/20 blur-3xl float" />
          <h2 className="display relative text-3xl md:text-5xl">Birinchi kalit so&apos;zni bugun sozlang</h2>
          <p className="relative mx-auto mt-4 max-w-lg text-white/85">
            Instagramga o&apos;ting, u yerda tasdiqlang — keyingi komment o&apos;zi javob oladi.
          </p>
          <Link href="/register" className="btn relative mt-8 bg-white text-[var(--brand)] shadow-xl hover:shadow-2xl">
            Bepul boshlash →
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--line)] px-6 py-8 text-sm text-[var(--muted)]">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4">
          <p>© {new Date().getFullYear()} Instagram Cloud.</p>
          <p>Faqat rasmiy API. Sovuq xabar yo&apos;q. «stop» bilan obunadan chiqish.</p>
          <Link href="/privacy" className="hover:text-[var(--brand)]">Maxfiylik siyosati</Link>
        </div>
      </footer>
    </div>
  );
}
