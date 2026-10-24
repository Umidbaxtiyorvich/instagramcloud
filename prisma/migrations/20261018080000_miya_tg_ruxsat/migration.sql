-- Miya faqat egasining raqamidan kelgan Telegram qo'ng'irog'ini ko'taradi (Telefon bo'limida o'zgartiriladi)
INSERT INTO "Sozlama" ("kalit", "qiymat", "yangilandi") VALUES ('miya_tg_ruxsat', '+998908970229', CURRENT_TIMESTAMP)
ON CONFLICT ("kalit") DO NOTHING;
