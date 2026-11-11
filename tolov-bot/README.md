# To'lov boti (@claudeadminbot_bot)

Guruhga tashlangan to'lov cheklarini (rasm/matn) AI bilan o'qiydi, CloudShop'dagi mijozni topadi va
admin ✅ bossa (yoki ishonch yetarli bo'lsa avtomatik) CloudShop'ga kirim qiladi. Hisobotlar
(qarzlar, akt sverka), kassa/tovar kiritish va sverka — Telegram Web App orqali.

Avval Railway'da edi; Railway sinov puli tugagach o'chdi. Endi `instagramcloud` Render xizmati
ichida sayt bilan yonma-yon ishlaydi (`scripts/start.mjs`), qo'shimcha server kerak emas.

## Qanday ishlaydi
- Render build oxirida `scripts/tg-orna.mjs` Python muhitini (`.tlv`) o'rnatadi.
- `scripts/start.mjs` botni 8792-portda ishga tushiradi; yiqilsa o'zi qayta ishga tushiradi.
- Cheklar va rasmlar (`tolov-bot/data`) Neon bazasidagi `BotFayl` jadvalida saqlanadi
  (`scripts/fayl-saqla.mjs`), Render diski tozalansa ham yo'qolmaydi.
- Hisobotlar oynasi va to'g'rilash jadvali: `https://instagramcloud.onrender.com/tolov/app`,
  `/tolov/fix/<id>` (`next.config.ts` → 127.0.0.1:8792).
- Sayt cheklar tarixini shu botning o'zidan oladi (`TOLOV_BOT_URL` avtomatik qo'yiladi).
- 60 kundan eski cheklarning rasmlari o'chiriladi, yozuvlari qoladi (`PHOTO_KEEP_DAYS`).

## Sozlash (Render → instagramcloud → Environment)
Bitta o'zgaruvchi: **`TOLOV_ENV`** — qiymatiga Railway → tolov-bot → Variables → **Raw Editor**
dagi matnni to'liq qo'ying. Yoki har birini `TL_` bilan: `TL_BOT_TOKEN`, `TL_ADMIN_IDS`, ...

Kerakli kalitlar: `BOT_TOKEN`, `ADMIN_IDS`, `API_KEY`, `CS_EMAIL`, `CS_PASSWORD`,
`GEMINI_API_KEY` (yoki `ANTHROPIC_API_KEY`). Ixtiyoriy: `ALLOWED_CHATS`, `CS_ACCOUNT_ID`,
`CS_COMPANY_ID`, `AUTO_ENTER`, `AUTO_CONF`, `RIVAL_CONF`, `VERIFY_CONF`, `MAX_AGE_DAYS`, `AUTO_MAX`,
`GEMINI_MODEL`. `PORT`, `PUBLIC_URL`, `DATA_DIR` ni server o'zi qo'yadi.

Bitta token bilan faqat bitta joyda ishlatish mumkin — botni lokal kompyuterda haqiqiy token bilan
ishga tushirmang.
