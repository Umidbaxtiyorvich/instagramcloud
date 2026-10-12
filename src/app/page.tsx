import Link from "next/link";

export default function Home() {
  return (
    <div>
      <header className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 glass">
        <Link href="/" className="display text-xl tracking-tight">
          instagram<span className="text-[var(--pink)]">cloud</span>
        </Link>
        <nav className="hidden gap-6 text-sm text-[var(--muted)] md:flex">
          <a href="#avto">Avto-javoblar</a>
          <a href="#mcp">AI-konnektor</a>
          <a href="#qadam">Qanday ishlaydi</a>
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

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:grid-cols-2 md:py-24">
        <div>
          <p className="mb-3 text-sm uppercase tracking-[0.2em] text-[var(--amber)]">Instagram orqali ulash</p>
          <h1 className="display mb-5 text-5xl leading-[1.05] md:text-6xl">O&apos;zi javob beradigan Instagram</h1>
          <p className="mb-8 max-w-xl text-lg text-[var(--muted)]">
            Odam kommentga kalit so&apos;z yozadi — bir soniyadan keyin Direct&apos;da havola yoki narxlar
            ro&apos;yxatini oladi. Sizning AI&apos;ingiz — Claude, ChatGPT yoki Gemini — MCP manzili orqali
            akkauntni boshqaradi: video, javob, qoidalar.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/connect/instagram" className="btn btn-primary">
              Instagramni ulash
            </Link>
            <a href="#mcp" className="btn btn-ghost">
              MCP manzilini ko&apos;rish
            </a>
          </div>
          <p className="mt-4 text-sm text-[var(--muted)]">
            Business yoki Creator akkaunt. Bank kartasi shart emas. Parolingizni biz ko&apos;rmaymiz.
          </p>
        </div>

        <div className="flex justify-center">
          <div className="phone">
            <div className="bg-gradient-to-b from-[#2b1524] to-[#120c16] p-4">
              <p className="text-xs text-[var(--muted)]">yourbrand · Reels</p>
              <p className="mt-2 text-sm">Yangi zig&apos;ir kolleksiyasi</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                «NARX» deb yozing — narxlarni Direct&apos;ga yuboramiz.
              </p>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl bg-white/5 p-3">
                  <p className="text-xs text-[var(--pink)]">anna.k</p>
                  <p className="text-sm">NARX 🙏</p>
                </div>
                <div className="rounded-2xl bg-white/8 p-3">
                  <p className="text-xs text-[var(--amber)]">yourbrand</p>
                  <p className="text-sm">Direct&apos;ga yubordik 📩</p>
                </div>
                <div className="rounded-2xl border border-[var(--line)] p-3">
                  <p className="text-[10px] uppercase text-[var(--mint)]">Direct · 1 soniya</p>
                  <p className="mt-1 text-sm">
                    Anna, salom! Ko&apos;ylak — 390 000 so&apos;m. Buyurtma: yourbrand.uz/linen
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="avto" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="display mb-3 text-4xl">Kalit so&apos;zlar javob beradi</h2>
        <p className="mb-10 max-w-2xl text-[var(--muted)]">
          narx, havola, info, o&apos;lcham — har biriga nima ketishini belgilang. Bir marta sozlanadi,
          kechayu kunduz ishlaydi. «stop» — shu odam uchun avto-javob o&apos;chadi.
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          <article className="glass rounded-3xl p-6">
            <p className="text-[var(--pink)]">Komment → Direct</p>
            <h3 className="display mt-2 text-2xl">Post ostida so&apos;z — Direct&apos;da javob</h3>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Ochiq javob ham chiqadi, boshqalar ham ko&apos;radi. Bitta post, bir nechtasi yoki hammasi.
              O&apos;yinlar uchun «istalgan komment» rejimi.
            </p>
          </article>
          <article className="glass rounded-3xl p-6">
            <p className="text-[var(--amber)]">Direct xabarlari</p>
            <h3 className="display mt-2 text-2xl">Narx, yetkazish, manzil — darhol</h3>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Standart javob: faqat birinchi xabar, kuniga bir marta yoki har doim. Jurnalda har bir
              yozishma. Instagram ilovasida qo&apos;lda javob berish odatdagidek qoladi.
            </p>
          </article>
        </div>
      </section>

      <section id="mcp" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="display mb-3 text-4xl">Instagramni o&apos;z AI&apos;ingizdan so&apos;rang</h2>
        <p className="mb-8 max-w-2xl text-[var(--muted)]">
          Claude, ChatGPT yoki Gemini&apos;ga bitta MCP manzilini qo&apos;yasiz. U tahlil qiladi, Reels
          joylaydi, kommentga javob yozadi — lekin faqat siz kabinetda «ha» degach.
        </p>
        <div className="glass mb-8 overflow-x-auto rounded-3xl p-6">
          <p className="mb-3 text-sm text-[var(--muted)]">
            «Bu oy qaysi Reels eng ko&apos;p ulashildi?»
          </p>
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
              <tr>
                <td>Mikroto&apos;lqinli pech qanday ishlaydi</td>
                <td>1.53M</td>
                <td>4.4%</td>
                <td>26 s</td>
              </tr>
              <tr>
                <td>Nega osmon ko&apos;k</td>
                <td>412K</td>
                <td>3.1%</td>
                <td>21 s</td>
              </tr>
              <tr>
                <td>Yangi studiyamiz</td>
                <td>96K</td>
                <td>0.6%</td>
                <td>9 s</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="grid gap-3 text-sm text-[var(--muted)] md:grid-cols-2">
          <li>• Qamrov, ko&apos;rishlar, ulashish, saqlash hisoboti</li>
          <li>• Javobsiz kommentlar va tayyor javoblar</li>
          <li>• Direct, ochiq javob, spamni yashirish — tasdiq bilan</li>
          <li>• Avto-javob qoidalarini yaratish va o&apos;zgartirish</li>
          <li>• Reels joylash (ommaviy video URL) — tasdiq bilan</li>
          <li>• Claude, ChatGPT, Gemini CLI, Cursor, VS Code, Claude Code</li>
        </ul>
      </section>

      <section id="qadam" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="display mb-8 text-4xl">Bir necha daqiqada</h2>
        <ol className="grid gap-4 md:grid-cols-4">
          {[
            ["1", "Akkaunt", "Email va parol — boshqa hech narsa."],
            ["2", "Instagram", "Rasmiy oyna. Business yoki Creator."],
            ["3", "Kalit so'zlar", "So'z va javob matnini yozing."],
            ["4", "AI ulash", "MCP manzilini Claude yoki ChatGPT'ga qo'ying."],
          ].map(([n, t, d]) => (
            <li key={n} className="glass rounded-3xl p-5">
              <span className="text-[var(--pink)]">{n}</span>
              <h3 className="display mt-2 text-xl">{t}</h3>
              <p className="mt-2 text-sm text-[var(--muted)]">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="glass rounded-3xl p-8 text-center">
          <h2 className="display text-3xl">Birinchi kalit so&apos;zni bugun sozlang</h2>
          <p className="mx-auto mt-3 max-w-lg text-[var(--muted)]">
            Instagramga o&apos;ting, u yerda tasdiqlang — keyingi komment o&apos;zi javob oladi.
          </p>
          <Link href="/register" className="btn btn-primary mt-6">
            Boshlash
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--line)] px-6 py-8 text-sm text-[var(--muted)]">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4">
          <p>© {new Date().getFullYear()} Instagram Cloud.</p>
          <p>Faqat rasmiy API. Sovuq xabar yo&apos;q. «stop» bilan obunadan chiqish.</p>
          <Link href="/privacy">Maxfiylik siyosati</Link>
        </div>
      </footer>
    </div>
  );
}
