# Instagram Cloud

[ai-xodim.uz](https://ai-xodim.uz/uz) kabi: Instagram avto-javoblar + Claude / ChatGPT uchun MCP konnektor.

## Nima qiladi

- Kalit so‘z: komment → Direct + ochiq javob
- Direct savollariga avto-javob, `stop` bilan o‘chirish
- Rasmiy Instagram Login (Business / Creator), parol so‘ralmaydi
- **Claude konnektori**: bitta URL, OAuth bilan kirish — token nusxalash shart emas
- AI vositalari: statistika, Reels hisoboti, kommentlar (javobsizlari ham), Direct, avto-javob qoidalari, Reels joylash
- Yozish harakatlari: AI chatda so‘raydi yoki (sozlamada) kabinetda «Ha» kutadi

## Internetga chiqarish (Render)

1. [render.com](https://render.com) da GitHub bilan kiring.
2. **New → Blueprint** → `instagramcloud` repo → branch → **Apply**. `render.yaml` sayt va PostgreSQL bazani o‘zi yaratadi, maxfiy kalitlarni o‘zi generatsiya qiladi.
3. `INSTAGRAM_APP_ID` va `INSTAGRAM_APP_SECRET` so‘ralganda hozircha bo‘sh qoldirsangiz bo‘ladi — demo bilan ishlaydi.
4. Deploy tugagach sayt `https://instagramcloud.onrender.com` (yoki shunga o‘xshash) manzilda ochiladi. Claude konnektori: shu manzil + `/mcp`.

Bepul tarifda: sayt 15 daqiqa ishlatilmasa uxlaydi (birinchi ochilish ~1 daqiqa), bepul baza 30 kundan keyin o‘chadi. Doimiy ishlashi uchun web service’ni **Starter**, bazani **Basic** tarifga o‘tkazing.

O‘z domeningiz bo‘lsa: Render → Settings → Custom Domains, keyin `APP_URL=https://domeningiz.uz` qo‘ying.

## Lokal ishga tushirish

```bash
npm install
cp .env.example .env      # DATABASE_URL (PostgreSQL), AUTH_SECRET, TOKEN_ENCRYPTION_KEY
npx prisma migrate deploy
npm run dev               # http://localhost:3001
```

claude.ai `localhost` ga ulana olmaydi — saytni internetga chiqaring:

```bash
cloudflared tunnel --url http://localhost:3001
```

va saytni tunnel bergan `https://….trycloudflare.com` manzil orqali oching (yoki uni `APP_URL` ga yozing).

## 1. Instagramni ulash

1. Ro‘yxatdan o‘ting → **Instagramni ulash**
2. Meta ilovasi hali bo‘lmasa — **Demo akkaunt ulash** (namuna ma’lumotlar, Instagramga hech narsa ketmaydi)

Haqiqiy akkaunt uchun [developers.facebook.com](https://developers.facebook.com) da ilova yarating:

- Use case: **Instagram API with Instagram Login**
- Ruxsatlar: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`, `instagram_business_content_publish`, `instagram_business_manage_insights`
- OAuth redirect: `https://SIZNING-DOMEN/api/instagram/callback`
- Privacy Policy URL: `https://SIZNING-DOMEN/privacy`, Data deletion: `https://SIZNING-DOMEN/privacy#delete`
- Webhook: `https://SIZNING-DOMEN/api/webhooks/instagram`, verify token = `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, maydonlar: `comments`, `messages`
- `.env`: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_OAUTH_MODE="instagram"`

Ilova «Development» rejimida bo‘lsa, Instagram akkauntingizni ilovaga **Instagram Tester** sifatida qo‘shing.

## 2. Claude’ga ulash

1. claude.ai → **Settings → Connectors → Add custom connector**
2. Name: `Instagram Cloud`, URL: `https://SIZNING-DOMEN/mcp`
3. **Connect** → sayt ochiladi → kirasiz → **Ruxsat berish**
4. Chatda: «Instagramimda bu oy qaysi Reels yaxshi ishladi?», «Javobsiz kommentlarni ko‘rsat va javob yozib ber»

Claude Code: `claude mcp add --transport http instagram-cloud https://SIZNING-DOMEN/mcp`

OAuth qo‘llamaydigan mijozlar (Cursor va h.k.) uchun kabinetdagi shaxsiy token:

```json
{
  "mcpServers": {
    "instagram-cloud": {
      "url": "https://SIZNING-DOMEN/mcp",
      "headers": { "Authorization": "Bearer ic_..." }
    }
  }
}
```

Ulangan AI ilovalarni kabinetdagi **AI-konnektor** bo‘limida ko‘rish va uzish mumkin.
