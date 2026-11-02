# YesPOS Telegram bot

app.yespos.uz dagi ma'lumotlarni kuzatib, Telegramga xabar beradigan va kirim/chiqim qila oladigan bot.

## Imkoniyatlar

| Bo'lim | Nima qiladi |
|---|---|
| 📊 Hisobotlar | Bugun / kecha / hafta / oy / o'tgan oy: tushum, foyda, cheklar, to'lov turlari. Top tovarlar |
| 💰 Mijozlar qarzi | Qarzdorlar, qarz necha kun cho'zilgani (7/15/30+), oxirgi to'lov sanasi, Excel |
| 📦 Tovar tahlili | Minus tovarlar, umuman sotilmayotganlar (muzlagan pul bilan), kam sotilayotganlar (soni bo'yicha), kam tushum keltirayotganlar (summa bo'yicha), Excel |
| 🚚 Yetkazib beruvchilar | Qarzlarimiz ro'yxati, **akt sverka** (davr tanlash + Excel fayl), oxirgi to'lovlar |
| 💵 Ta'minotchiga to'lov | Yetkazib beruvchiga bergan pulni YesPOS'ga kiritadi |
| ➕ Tovar kirim | Yetkazib beruvchidan prixod hujjati yaratadi va o'tkazadi |
| ➖ Tovar chiqim | Yo'qotish yoki buzilgan tovar sifatida hisobdan chiqaradi |

### Avtomatik xabarlar
- **Har soatda**: yangi minus tovarlar; qarzi 7, 15, 30 kundan oshgan mijozlar (har bosqichda bir marta).
- **Har kuni 09:00**: kechagi savdo, mijozlar qarzi, ta'minotchilarga qarz, minus tovarlar soni.
- **Har dushanba**: sotilmayotgan tovarlar Excel fayli.

Vaqt va chegaralar `.env` faylda o'zgartiriladi.

## O'rnatish (Windows)

1. Telegramda **@BotFather** → `/newbot` → bot tokenini oling.
2. **@userinfobot** ga yozib, o'z Telegram ID raqamingizni bilib oling.
3. `.env.example` faylidan nusxa olib, nomini `.env` qiling va to'ldiring:
   - `BOT_TOKEN`, `ADMIN_IDS`
   - `YESPOS_ORG_ID`, `YESPOS_LOGIN`, `YESPOS_PASSWORD` — YesPOS'ga kiradigan ma'lumotlaringiz
   - `ORG_NAME=Oazis Supermarket` (akt sverkada chiqadigan nom, ixtiyoriy)
4. `run.bat` ni ikki marta bosing. Bot to'xtab qolsa o'zi qayta ishga tushadi.
5. Telegramda botga `/start` yozing.

> Kompyuter o'chsa bot ham to'xtaydi. Avtomatik ishga tushishi uchun `run.bat` yorlig'ini
> `Win+R` → `shell:startup` papkasiga qo'ying.

## Eslatmalar
- Bot YesPOS'ga alohida sessiya ("TelegramBot") bilan kiradi — u "Sessiyalar" ro'yxatida ko'rinadi.
- Akt sverkada: **Kredit** = olingan tovar, **Debet** = biz to'lagan pul. Manfiy qoldiq = biz qarzdormiz.
- Kirim/chiqim/to'lov har doim tasdiqlash tugmasidan keyin bajariladi.
- Ma'lumotlar `data/` papkasida saqlanadi (sessiya, ogohlantirish holati).
