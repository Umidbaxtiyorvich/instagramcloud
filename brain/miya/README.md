# Miya — o'qiydigan, eslab qoladigan va bog'laydigan shaxsiy miya

Hech qanday API, token yoki bulutli AI xizmati yo'q. Python (3.10+) va ixtiyoriy ravishda kompyuterdagi ochiq model (Ollama).

## Ishga tushirish
1. (Bir marta) `brain\miya_setup.bat` — Ollama va Qwen 2.5 (7B, ~4.7 GB) modelini o'rnatadi. Keyin model internetsiz ishlaydi.
2. Windows: `brain\miya.bat` ni ikki marta bosing.
- Mac/Linux: `cd brain && python3 -m miya.server`

Brauzerda `http://127.0.0.1:8765` ochiladi. Uchta bo'lim bor:

| Bo'lim | Nima qiladi |
|---|---|
| **Suhbat** | Savolga xotiradan javob beradi va «Fikr qadamlari»ni ko'rsatadi. «Eslab qol: ...» deb yozsangiz eslatma saqlaydi. Har bir suhbatni kunlik eslatmaga yozib qo'yadi. |
| **Graf** | Hamma eslatmalar va tushunchalar Obsidian'dagidek bog'langan graf ko'rinishida. Tugunni bosing — eslatma ochiladi. |
| **O'rganish** | Sayt qo'shing: miya sayt ichidagi sahifalarni o'qiydi va har N soatda o'zi qaytib, yangilarini o'rganadi. Kitob (txt, md, html, epub, pdf) tashlang — o'qib, bo'laklarga ajratib eslab qoladi. |

## Sayt havolasini tashlash
Suhbatga «shu saytni o'qib o'rgan https://...» deb yozing: miya saytga o'zi kiradi, sahifani o'qiydi, qisqacha aytib beradi,
saytning boshqa sahifalarini (15 tagacha) fonda o'qiydi va har kuni qaytib yangilarini o'rganadi.
Havola bilan birga savol ham yozish mumkin: «https://... bu yerda narxlar haqida nima deyilgan».

## Katta ochiq model
Ollama ishlayotgan bo'lsa, miya xotiradan topilgan eslatmalarni modelga beradi va model ulardan o'z so'zlari bilan javob tuzadi
(manbani [1] kabi belgilaydi). Model bo'lmasa ham miya ishlaydi — javobni o'qigan matnidan tayyor gaplar bilan beradi.
Boshqa model: `set MIYA_MODEL=llama3.1:8b`. LM Studio yoki llama.cpp server: `set MIYA_LLM_URL=http://127.0.0.1:1234`.
Kuchsizroq kompyuter uchun: `ollama pull qwen2.5:3b` va `set MIYA_MODEL=qwen2.5:3b`.

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

Model ulangan bo'lsa, 3-qadamda eslatmalar modelga beriladi va javobni model tuzadi. U ko'p o'qigan sari biladigan narsasi ko'payadi.
