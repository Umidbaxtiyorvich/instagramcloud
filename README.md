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
- **Miya’ning qoidalari:** Telegram’da, qo‘ng‘iroqda yoki ofisda «eslab qol: chegirmani 10% dan oshirma» desangiz, Miya buni doimiy qoida qilib saqlaydi va Reels yozganda, taklif berganda, telefonda shunga amal qiladi; «… ni unut» — o‘chiradi. Ro‘yxat: ofis → Miya → 📌 Qoidalarim
- **Reels joylashdan oldin so‘raydi:** Miya yasagan Reels videosi Telegram botga «✅ Joyla / ❌ Bekor» tugmalari bilan keladi va siz bosmaguningizcha Instagram’ga chiqmaydi (bot ulanmagan bo‘lsa — ofisdagi tasdiq navbatida turadi). O‘chirish: ofis → Miya → 🎬 Avtomatik Reels → «Joylashdan oldin so‘rasin»
- **Reels natijasidan o‘rganadi:** Miya o‘zi joylagan har bir Reels’ni 48 soatdan keyin akkauntdagi odatiy Reels’lar (mediana) bilan solishtiradi, natijani Telegram’ga yozadi va keyingi ssenariylarda yaxshi ishlagan mavzularga yaqinroq yozadi
- **Kunlik hisobot:** har kuni 21:00 dan keyin Telegram’ga kun yakuni keladi — savdo va kassa (moliya ruxsati bo‘lsa; dushanba kuni o‘tgan hafta oldingi hafta bilan), obunachilar o‘zgarishi, Miya bugun nima qildi, Reels natijalari va ertangi reja. Telefonda yoki botda «bugun nima bo‘ldi?» desangiz ham aytadi
- **Miya qo‘ng‘iroq qiladi — bepul:** Twilio sozlanmagan bo‘lsa, Miya Telegram’ga «📞 Miya sizga qo‘ng‘iroq qilyapti» havolasini yuboradi; uni bossangiz `/qongiroq` sahifasi qo‘ng‘iroq ekrani kabi ochiladi va Miya bilan telefon brauzerida ovoz orqali gaplashasiz (gapirib bo‘lgach jim tursangiz, o‘zi yuboradi). O‘zingiz ham istalgan payt `/qongiroq` dan chaqirasiz. Faqat `OPENAI_API_KEY` kerak
- **Miya Telegram boti:** @BotFather’da bot yarating va tokenini Render’ga `MIYA_BOT_TOKEN` qilib qo‘ying, keyin ofis → Miya → 📞 Telefon → «Telegram’ga ulash». Miya muhim gapda botga ovozli «📞 Miya sizga qo‘ng‘iroq qilyapti» xabarini «Javob berish» tugmasi bilan yuboradi (Telegram ichida qo‘ng‘iroq ekrani ochiladi); javob berilmasa, botda «📵 javob bermadingiz» bo‘lib qoladi va «Qayta qo‘ng‘iroq» bilan sababini so‘rash mumkin. Botdagi «📞 Miyaga qo‘ng‘iroq» va «🕘 Qo‘ng‘iroqlar tarixi» tugmalari; botga ovozli yoki oddiy xabar yozsangiz ham Miya ovoz bilan javob beradi. Webhook (`/api/telegram/miya`) o‘zi o‘rnatiladi
- **Haqiqiy Telegram qo‘ng‘irog‘i (bepul):** Miya’ga alohida Telegram akkaunt oching (masalan eSIM raqamiga), my.telegram.org’dan `api_id`/`api_hash` olib Render’ga `TG_API_ID`, `TG_API_HASH` qilib qo‘ying va ofis → Miya → 📞 Telefon’da akkauntga kiring (kod Telegram’ga keladi; sessiya bazada shifrlangan holda saqlanadi). Shundan keyin Miya muhim gapda egasining Telegram’iga haqiqiy qo‘ng‘iroq qiladi (telefon jiringlaydi), egasi Miya akkauntiga qo‘ng‘iroq qilsa — ko‘taradi; botdagi «📞 Miyaga qo‘ng‘iroq» va «Qayta qo‘ng‘iroq» Miya’ni darhol qo‘ng‘iroq qildiradi; ko‘tarilmasa, botda tarix qoladi. Suhbat OpenAI Realtime (`gpt-realtime`) orqali jonli bo‘ladi: Miya gap tugaganini o‘zi sezadi, darhol ovoz bilan javob beradi, gapini bo‘lsangiz to‘xtaydi; Instagram/kassa ma’lumoti kerak bo‘lsa saytdagi Miya’dan so‘raydi. `GEMINI_API_KEY` bo‘lsa, egasining gapini Gemini taniydi (o‘zbekchani OpenAI’dan yaxshi biladi) va Realtime’ga matn sifatida beradi — Realtime faqat javob beradi va gapiradi; brauzerdagi qo‘ng‘iroq va botdagi ovozli xabarlar ham Gemini bilan taniladi. Realtime ishlamasa — oddiy usulga (matnga o‘girish → javob → ovoz) o‘tadi; o‘chirish: `TELEFON_REALTIME=0`, model: `TELEFON_REALTIME_MODEL`. Bu `miya-tg/` dagi Python dasturi (py-tgcalls) sayt bilan bir serverda ishlaydi: build oxirida `.tgv` muhiti o‘rnatiladi, `npm start` uni yonida ishga tushiradi
- **Miya telefonda (Twilio):** muhim gap bo‘lsa Miya egasiga qo‘ng‘iroq qiladi (kunduzi 08:00–22:00, 30 daqiqada ko‘pi bilan bir marta), nima bo‘lganini aytadi va buyrug‘ini oladi; egasi ham Miya raqamiga qo‘ng‘iroq qilib, PIN terib gaplashadi. Gap OpenAI bilan matnga o‘giriladi (`gpt-4o-transcribe`), Miya vositalar bilan javob beradi, javob ovozga aylanadi (`gpt-4o-mini-tts`). Instagram’ga yozadigan ishlar telefonda «ha» deyilgandan keyingina bajariladi. Sozlash: Twilio’da raqam oling, Render’ga `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER` qo‘ying, keyin ofis → Miya → 📞 Telefon’da raqamingizni tasdiqlang va PIN o‘rnating. Kiruvchi qo‘ng‘iroq manzili (`/api/telefon/kiruvchi`) raqamga avtomatik yoziladi. Twilio konsolida Voice → Geo permissions’da O‘zbekiston yoqilgan bo‘lishi kerak
