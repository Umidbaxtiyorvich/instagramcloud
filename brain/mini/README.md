# mini — noldan yozilgan o'z miyamiz

Hech qanday kutubxona modeli, API yoki internet kerak emas. Faqat `numpy`.

- `brain.py` — neyron til modeli (Bengio 2003 uslubi): harflar -> embedding -> tanh qatlam -> keyingi harf. Backprop va Adam qo'lda yozilgan (gradientlar sonli tekshiruvdan o'tgan).
- `train.py [soniya]` — `data/*.txt` dagi matnlardan o'rganadi, `brain.npz` ga saqlaydi.
- `talk.py "matn"` — miya matnni davom ettiradi.

## Haqiqat
Hozirgi `data/uz.txt` juda kichik (~2 KB), shuning uchun model uni yod olib oladi (xato 0), yangi gap tuzolmaydi.
Miya aqlli bo'lishi faqat ikki narsaga bog'liq: **ko'p matn** (kamida megabaytlab, yaxshisi gigabaytlab o'zbekcha matn)
va **hisoblash quvvati**. `data/` ga o'z matnlaringizni (.txt) tashlang va qayta o'qiting.
Keyingi arxitektura bosqichi: attention (transformer) qatlamlari.
