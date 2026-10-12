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

## «Invalid platform app» xatosi

Instagram login sahifasida `Invalid platform app` chiqsa — `.env` dagi `INSTAGRAM_APP_ID` noto‘g‘ri:
u yerga Meta (Facebook) App ID yozilgan. To‘g‘risi:

1. developers.facebook.com → ilovangiz → **Instagram** → **API setup with Instagram login**
2. **Instagram app ID** va **Instagram app secret** ni oling (bu raqam Meta App ID dan farq qiladi)
3. `.env`: `INSTAGRAM_OAUTH_MODE="instagram"`, `INSTAGRAM_APP_ID=<Instagram app ID>`, `INSTAGRAM_APP_SECRET=<Instagram app secret>`
4. Shu sahifadagi **Set up Instagram business login → Business login settings → OAuth redirect URIs** ga
   `INSTAGRAM_REDIRECT_URI` ni aynan bir xil qilib qo‘shing
5. Ilova Development rejimida bo‘lsa, Instagram akkauntingizni **App roles → Roles → Instagram Tester** qilib qo‘shing va
   Instagramda (Settings → Apps and websites → Tester invites) taklifni qabul qiling
6. `npm run dev` ni qayta ishga tushiring
