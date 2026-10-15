# Instagram Cloud

[ai-xodim.uz](https://ai-xodim.uz/uz) kabi Instagram avto-javoblar va Claude / ChatGPT / Gemini uchun MCP konnektor.

## Nima qiladi

- Kalit so‘z: komment → Direct + ochiq javob
- Direct savollariga avto-javob, `stop` bilan o‘chirish
- Rasmiy Instagram Login (Business / Creator)
- MCP URL: tahlil, qoidalar, komment/DM, Reels joylash
- Yozish harakatlari kabinetda **tasdiqlanmaguncha** yuborilmaydi

## Ishga tushirish

```bash
npm install
npx prisma migrate dev --name init
npm run dev
```

Brauzer: http://localhost:3000

1. Ro‘yxatdan o‘ting
2. **Instagramni ulash** — Instagram ochiladi, u yerda kirasiz
3. Qaytib **Ha, ulash** ni bosing
4. **AI-konnektor** dan MCP URL va tokenni oling

Sozlamalar: `AUTH_SECRET` va `TOKEN_ENCRYPTION_KEY` ni tasodifiy uzun qator qiling.

## Claude / ChatGPT / Cursor

MCP manzil: `https://sizning-domen/mcp`  
Authorization: `Bearer <kabinetdagi token>`

Cursor `mcp.json` misoli:

```json
{
  "mcpServers": {
    "instagram-cloud": {
      "url": "https://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer ic_..."
      }
    }
  }
}
```

AI video joylash, Direct yuborish yoki qoida o‘zgartirishni so‘rasa, kabinetdagi **Tasdiqlar** da «Ha» bosing.

## AI Ofis (`/ofis`)

Agentlar bilan ishlaydigan virtual 3D ofis (three.js / React Three Fiber) — to‘liq o‘zbek tilida. Odamlar haqiqiy 3D modellar: o‘tiradi, yozadi, yo‘laklarda yuradi; kamerani sichqoncha bilan aylantirish va yaqinlashtirish mumkin.

- 8 jamoa (Kreativ, Ijtimoiy tarmoq, Tadqiqot, Dasturlash, Savdo, Moliya, Mijozlar xizmati, Tahlil) va markazda umumiy **Miya** (xotira)
- Pastdagi qatorga vazifa yozing yoki 🎤 bosib ayting — dispetcher uni mos jamoaga beradi, mos agent bo‘lmasa **yangi agent yaratadi**
- Xonani bossangiz — jamoa paneli (vositalar, ko‘nikmalar, agentlar); agentni bossangiz — u bilan chat
- **Vazifalar** taxtasi: jarayonda / tasdiq kutmoqda / bajarildi; tashqariga chiqadigan ishlar tasdiqlanmaguncha bajarilmaydi
- `ANTHROPIC_API_KEY` berilsa va tizimga kirgan bo‘lsangiz, agentlar Claude bilan ishlaydi (vazifani bajarib, natija qaytaradi). Kalitsiz — kalit so‘zlar bo‘yicha lokal rejim
- **Instagram Cloud bilan ulangan:** agentlar haqiqiy akkaunt ma’lumotlari bilan ishlaydi — statistika va Reels hisoboti (Tahlil), kommentlar va avto-javob qoidalari (Ijtimoiy tarmoq), Direct mavzulari (Mijozlar xizmati). Javob, Direct, Reels, qoida kabi yozish harakatlari kabinetdagi tasdiq navbatiga tushadi va ofisdagi «Vazifalar» taxtasida ham tasdiqlanadi. AI-konnektor (Claude/ChatGPT) orqali kelgan tasdiqlar ham shu yerda ko‘rinadi; yangi avto-javoblar ofisda jonli ko‘rinib, «Miya»ga yoziladi
- **Moliya (Telegram bot + CloudShop):** «💰 Moliya» bo‘limida kirim-chiqim (kassa), tovarlar qoldig‘i, sotuv/qabul hujjatlari, xaridorlar qarzi va @claudeadminbot_bot guruhdan olgan to‘lov cheklari tarixi ko‘rinadi (bugun / kecha / 7 kun / 30 kun). Hisobchi agent shu ma’lumotlar bilan javob beradi, botga yangi chek kelsa ofisda jonli ko‘rinadi. Faqat o‘qish — CloudShop’ga yozish botning o‘zida. Sozlash: `.env.example` dagi `MOLIYA_ADMIN_EMAILS`, `CS_*`, `CLOUDSHOP_APP_KEY`, `TOLOV_BOT_URL`, `TOLOV_BOT_API_KEY`
- Ovoz: brauzerning Web Speech API (`uz-UZ`, Chrome’da eng yaxshi ishlaydi)
