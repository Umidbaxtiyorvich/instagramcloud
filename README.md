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
