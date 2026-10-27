# Instagram Cloud → Oracle Cloud (bepul, doimiy ishlaydigan server)

Nega Oracle: **Always Free** — 4 yadro, 24 GB RAM, 200 GB disk, umrbod bepul. Server hech qachon
«uxlamaydi» (Render'dagi kabi 15 daqiqadan keyin to'xtamaydi), baza 30 kundan keyin o'chmaydi.
Hammasi bitta serverda: sayt, Miya, Miya Telegram-boti, miya-tg (qo'ng'iroqlar), Postgres baza,
HTTPS va har kungi zaxira nusxa.

## 1. Oracle akkaunt (10 daqiqa, buni o'zingiz qilasiz)

1. https://signup.cloud.oracle.com — ro'yxatdan o'ting. Karta faqat tekshirish uchun so'raladi, pul yechilmaydi.
   **Home region**: `Germany Central (Frankfurt)` (keyin o'zgartirib bo'lmaydi).
2. **Muhim — «uchib qolmasligi» uchun:** Billing → *Upgrade to Pay As You Go*. Always Free resurslar
   baribir bepul qoladi, lekin Oracle endi «kam ishlatilyapti» deb serverni o'chirib qo'ymaydi.
   (Bepul hisobda 7 kun yuklama past bo'lsa server to'xtatilishi mumkin.)

## 2. Server yaratish

Compute → Instances → **Create instance**:
- Image: **Ubuntu 24.04**
- Shape: **Ampere → VM.Standard.A1.Flex**, 4 OCPU, 24 GB (hammasi bepul)
- «Out of capacity» desa — 2 OCPU / 12 GB tanlang yoki bir necha soatdan keyin qayta urining
- SSH key: *Generate* → ikkala kalitni yuklab oling
- Create → **Public IP** ni yozib oling

Networking → instansning Subnet → Security List → **Add Ingress Rules**:
Source `0.0.0.0/0`, TCP, port **80** va **443**.

## 3. Serverga o'rnatish

Kompyuterdan (PowerShell):

```bash
ssh -i yuklangan-kalit.key ubuntu@SERVER_IP
```

Serverda:

```bash
git clone -b claude/instagram-integration-site-msih8q https://github.com/Umidbaxtiyorvich/instagramcloud.git
cd instagramcloud
bash deploy/setup.sh
nano .env
```

`.env` ga Render → instagramcloud → **Environment** dagi barcha qiymatlarni ko'chiring.
`AUTH_SECRET` va `TOKEN_ENCRYPTION_KEY` **aynan o'sha** bo'lsin — aks holda Instagram ulanishlari
va Miya'ning Telegram sessiyasi ochilmaydi. Saqlash: `Ctrl+O`, `Enter`, `Ctrl+X`.

## 4. Bazani ko'chirish

Render → **instagramcloud-db** → Connect → **External Database URL** ni nusxalang:

```bash
bash deploy/kochirish.sh "postgresql://...frankfurt-postgres.render.com/instagramcloud"
```

Skript eski bazani `backups/` ga saqlaydi, yangisiga yozadi va saytni ishga tushiradi.
Sayt manzili oxirida chiqadi: `https://<ip>.sslip.io` (sertifikatni Caddy o'zi oladi, 1 daqiqa).

## 5. Manzilni hamma joyda almashtirish

Yangi manzil = `https://<ip>.sslip.io` (yoki o'z domeningiz — `.env` dagi `DOMAIN`).

- **Meta / Instagram app** (developers.facebook.com → app → Instagram → API setup):
  - OAuth redirect: `https://YANGI/api/instagram/callback`
  - Webhook callback: `https://YANGI/api/webhooks/instagram`, verify token — `.env` dagi `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`
- **Miya Telegram-boti**: yangi saytda AI Ofis → Miya → Telegram ulash havolasini bir marta
  oching — bot webhook'ni yangi manzilga o'zi o'tkazadi. Render ishlab tursa, u webhook'ni qaytarib
  olishi mumkin, shuning uchun Render'ni shu paytda **Suspend** qiling.
- **Claude / ChatGPT konnektori**: MCP manzil `https://YANGI/mcp`
- **To'lov boti (Railway)**: undagi sayt manzilini `https://YANGI` ga almashtiring.

Hammasi ishlaganini ko'rgach, Render'dagi servisni **Suspend** qiling (darhol o'chirmang — bir hafta zaxira bo'lib tursin).

## Kundalik buyruqlar (serverda, `instagramcloud` papkasida)

```bash
docker compose ps                 # holat
docker compose logs -f app        # sayt + miya-tg loglari
git pull && docker compose up -d --build   # yangi kodni chiqarish
ls backups/                       # kunlik baza nusxalari (14 kun saqlanadi)
```

Server qayta yuklansa, hammasi o'zi qayta ishga tushadi.
