import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Maxfiylik siyosati — Instagram Cloud" };

// Meta asks for a privacy policy URL and data deletion instructions before an app goes Live.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-[var(--muted)]">
      <Link href="/" className="display text-2xl text-[var(--fg)]">
        instagram<span className="gradient-text">cloud</span>
      </Link>
      <h1 className="display mt-8 text-4xl text-[var(--fg)]">Maxfiylik siyosati</h1>

      <h2 className="mt-8 text-lg text-[var(--fg)]">Qanday ma&apos;lumot olamiz</h2>
      <p className="mt-2">
        Siz Instagram akkauntingizni rasmiy Instagram Login orqali ulaganingizda biz akkaunt nomi, profil
        rasmi, obunachilar soni, postlar va ularning statistikasi, kommentlar va akkauntingizga kelgan Direct
        xabarlarni olamiz. Instagram parolingizni hech qachon ko&apos;rmaymiz va saqlamaymiz.
      </p>

      <h2 className="mt-8 text-lg text-[var(--fg)]">Nima uchun ishlatamiz</h2>
      <p className="mt-2">
        Faqat siz sozlagan avto-javoblarni yuborish, kabinetda statistika ko&apos;rsatish va siz ruxsat bergan AI
        yordamchi (masalan Claude) so&apos;rovlariga javob berish uchun. Ma&apos;lumotlaringizni sotmaymiz va
        reklama uchun uzatmaymiz.
      </p>

      <h2 className="mt-8 text-lg text-[var(--fg)]">Saqlash</h2>
      <p className="mt-2">
        Instagram kirish tokeni shifrlangan holda saqlanadi. Yozishmalar jurnali va qoidalar akkauntingiz
        ulanib turgan muddatda saqlanadi.
      </p>

      <h2 id="delete" className="mt-8 text-lg text-[var(--fg)]">Ma&apos;lumotlarni o&apos;chirish</h2>
      <p className="mt-2">
        Kabinetda «Akkauntni uzish» tugmasini bosing — shu Instagram akkauntiga tegishli token, qoidalar,
        jurnal va statistika darhol o&apos;chiriladi. Instagram ilovasida ham ruxsatni olib tashlashingiz mumkin:
        Sozlamalar → Veb-saytlar va ilovalar → Instagram Cloud → O&apos;chirish. Butun hisobingizni
        o&apos;chirish uchun ro&apos;yxatdan o&apos;tgan emailingizdan bizga yozing.
      </p>
    </main>
  );
}
