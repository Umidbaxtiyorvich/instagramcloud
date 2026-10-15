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
- Ovoz: brauzerning Web Speech API (`uz-UZ`, Chrome’da eng yaxshi ishlaydi)
