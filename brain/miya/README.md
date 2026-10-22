# Miya — o'qiydigan, eslab qoladigan va bog'laydigan shaxsiy miya

Hech qanday API, token yoki tashqi AI xizmati yo'q. Faqat Python (3.10+) standart kutubxonasi.

## Ishga tushirish
- Windows: `brain\miya.bat` ni ikki marta bosing.
- Mac/Linux: `cd brain && python3 -m miya.server`

Brauzerda `http://127.0.0.1:8765` ochiladi. Uchta bo'lim bor:

| Bo'lim | Nima qiladi |
|---|---|
| **Suhbat** | Savolga xotiradan javob beradi va «Fikr qadamlari»ni ko'rsatadi. «Eslab qol: ...» deb yozsangiz eslatma saqlaydi. Har bir suhbatni kunlik eslatmaga yozib qo'yadi. |
| **Graf** | Hamma eslatmalar va tushunchalar Obsidian'dagidek bog'langan graf ko'rinishida. Tugunni bosing — eslatma ochiladi. |
| **O'rganish** | Sayt qo'shing: miya sayt ichidagi sahifalarni o'qiydi va har N soatda o'zi qaytib, yangilarini o'rganadi. Kitob (txt, md, html, epub, pdf) tashlang — o'qib, bo'laklarga ajratib eslab qoladi. |

## Xotira = Obsidian vault
Hamma narsa `brain/vault/` papkasida oddiy `.md` fayllar bo'lib saqlanadi:
`manbalar/` (saytlar, kitoblar), `tushunchalar/` (avtomatik ajratilgan), `eslatmalar/` (sizniki), `suhbatlar/` (kunlik).
Bu papkani Obsidian'da «Open folder as vault» bilan oching — graf va havolalar u yerda ham ishlaydi.
Boshqa joyda saqlash: `MIYA_VAULT=D:\Miya` muhit o'zgaruvchisi.

PDF uchun: `pip install pypdf`.

## Qanday «fikrlaydi»
1. Savoldan asosiy so'zlarni ajratadi (o'zbekcha qo'shimchalarni olib tashlaydi: «shaharlardan» -> «shahar»).
2. Xotiradan BM25 usuli bilan eng mos eslatmalarni topadi.
3. Ulardan savolga eng mos gaplarni tanlab, javob tuzadi va manbasini ko'rsatadi.
4. Bilmasa — «bilmayman» deydi, o'ylab topmaydi.

Bu miya o'qigan narsasini aniq eslab qoladi va bog'laydi, lekin hali o'z so'zlari bilan yangi matn yozmaydi. U ko'p o'qigan sari biladigan narsasi ko'payadi.
