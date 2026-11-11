"""Chek rasmini / xabarni Claude orqali o'qish va CloudShop mijozini topish."""
import asyncio
import base64
import json
import os
from datetime import datetime, timedelta, timezone


MODEL = "claude-opus-5-5"
# GEMINI_API_KEY berilsa bepul Gemini ishlatiladi, aks holda Claude
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")

SYSTEM = """Sen ulgurji savdo firmasining buxgalteri yordamchisisan. Telegram guruhga mijozlardan (do'konlardan)
olingan pullar haqida ma'lumot tashlanadi. Uch xil bo'ladi:
  a) "receipt" - to'lov cheki: Click, Payme, Uzum, bank ilovasi skrinshoti, terminal cheki;
  b) "ledger" - qo'lda yozilgan daftar sahifasi: tepada mijoz nomi/joyi va telefoni, pastda qatorma-qator
     "SANA ... N ming/mln олдим (oldim)" - bu kuni mijozdan shu pul OLINGAN degani. "ост." / "остаток" / "қолди"
     yozuvlari - qarz QOLDIG'I, ular to'lov EMAS, ularni payments ga qo'shma. Chizib tashlangan qoldiqlar ham to'lov emas.
     Sana va summa ba'zan bir qatorda, ba'zan summa sananing biroz tepasida/pastida yozilgan - mantiqan juftla.
  c) "text" - "Sardor aka 500 ming tashladi" kabi yozuv.

Vazifang:
1. is_payment: yuqoridagilardan biri bo'lsa true. Reklama, savol, narx, buyurtma, faqat qarz qoldig'i - false.
2. payments: rasmdagi/matndagi HAR BIR olingan pulni alohida yoz (daftarda - har bir "oldim" qatori, chekda - bitta).
   amount - so'mda butun son ("1 250 000,00 сум" -> 1250000; "500 ming" -> 500000; "3 mln" -> 3000000;
   "1 mln 205 ming" -> 1205000). Komissiyani qo'shma.
   date - "YYYY-MM-DD HH:MM" (vaqt bo'lmasa "YYYY-MM-DD"), Toshkent vaqti; sana o'qilmasa bo'sh.
   line - rasmdagi asl yozuv qisqacha (masalan "12.10.2026 2 млн олдим").
   sure - shu yozuvning sanasi VA summasi aniq o'qildimi. Quyidagi hollarda sure=false qo'y va doubt ga
   sababini yoz: raqam xira/chizilgan/ikki xil o'qiladi; summa qaysi sanaga tegishli ekani noaniq (summa
   sanalar orasida yozilgan); bir qatorda ikki summa; sana kelajakda yoki mantiqsiz (masalan qolgan yozuvlar
   oktyabrda tugasa-yu, bu "13.12" bo'lsa - oy xato yozilgan bo'lishi mumkin). Bot faqat sure=true yozuvlarni
   o'zi kiritadi, qolganini odamga so'raydi - shuning uchun ENG KICHIK shubha bo'lsa ham false qo'y.
   Faqat har bir raqam 100% aniq ko'rinib tursa true bo'ladi.
   doubt_fields - aynan qaysi maydon noaniq: ["date"], ["amount"] yoki ikkalasi; aniq bo'lsa [].
3. To'lovchi/mijoz ismi, telefon raqami, karta raqamining oxirgi 4 xonasini ol (bo'lsa).
4. Quyidagi CloudShop mijozlar ro'yxatidan kim ekanini top. Ismlar noto'g'ri yozilgan, lotin/kirill
   aralash, qisqartirilgan bo'lishi mumkin ("Ирода опа", "Детский больница Бектошака" -> joy nomi ham mijoz nomida
   bo'lishi mumkin). Telefon raqami mos kelsa - eng kuchli dalil (daftarda "97-312-77-72" kabi qisqa yozilgan
   bo'lishi mumkin - oxirgi 7 raqamni solishtir). Telegram yuboruvchi va izoh ham yordam beradi.
   "Oldingi bog'lanish" berilgan bo'lsa - u avval tasdiqlangan.
   Eng ehtimolli 1-4 nomzodni ishonch bo'yicha kamayish tartibida ber. Hech kim mos kelmasa - bo'sh ro'yxat.
5. Izohni (note) o'zbekcha, qisqa yoz: nimaga shu mijozni tanlaganing, qaysi yozuv noaniq o'qildi."""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["is_payment", "doc_type", "payments", "payer_name", "phone", "card_last4",
                 "candidates", "note"],
    "properties": {
        "is_payment": {"type": "boolean"},
        "doc_type": {"type": "string", "enum": ["receipt", "ledger", "text", "other"]},
        "payments": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["date", "amount", "line", "sure", "doubt", "doubt_fields"],
                "properties": {
                    "doubt_fields": {"type": "array", "items": {"type": "string", "enum": ["date", "amount"]},
                                     "description": "qaysi maydon noaniq: sana, summa yoki ikkalasi"},
                    "date": {"type": "string", "description": "YYYY-MM-DD HH:MM, YYYY-MM-DD yoki bo'sh"},
                    "amount": {"type": "integer", "description": "so'mda"},
                    "line": {"type": "string"},
                    "sure": {"type": "boolean"},
                    "doubt": {"type": "string", "description": "sure=false bo'lsa - nimasi noaniq, qisqa"},
                },
            },
        },
        "payer_name": {"type": "string"},
        "phone": {"type": "string"},
        "card_last4": {"type": "string"},
        "candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["client_id", "confidence", "reason"],
                "properties": {
                    "client_id": {"type": "string"},
                    "confidence": {"type": "integer", "description": "0-100"},
                    "reason": {"type": "string"},
                },
            },
        },
        "note": {"type": "string"},
    },
}

_client = None  # anthropic.AsyncAnthropic — faqat kerak bo'lganda yuklanadi (~40 MB xotira)


def get_client():
    global _client
    if _client is None:
        # ANTHROPIC_API_KEY muhitdan olinadi. Workspace'ga bog'lanmagan kalit (sk-ant-usr-...)
        # uchun ANTHROPIC_WORKSPACE_ID (wrkspc_...) ham kerak.
        ws = os.getenv("ANTHROPIC_WORKSPACE_ID")
        import anthropic

        _client = anthropic.AsyncAnthropic(default_headers={"anthropic-workspace-id": ws} if ws else None)
    return _client


def clients_block(clients: list[dict]) -> str:
    lines = [f'{c["_id"]} | {c["name"]} | {", ".join(c.get("phones") or [])}' for c in clients]
    return "CloudShop mijozlar ro'yxati (id | nomi | telefonlar):\n" + "\n".join(lines)


async def analyze(meta: dict, photo: bytes | None, clients: list[dict], linked: list[str]) -> dict:
    by_id = {c["_id"]: c["name"] for c in clients}
    hint = ", ".join(f"{by_id[i]} ({i})" for i in linked if i in by_id) or "yo'q"
    prompt = (
        f"Guruh: {meta.get('chat_title')}\n"
        f"Yuboruvchi (Telegram): {meta.get('full_name')} @{meta.get('username')}\n"
        f"Forward qilingan: {meta.get('forwarded_from') or '-'}\n"
        f"Xabar vaqti: {meta.get('date')}\n"
        f"Xabar/izoh matni: {meta.get('text') or '-'}\n"
        f"Javob berilgan xabar: {meta.get('reply_to_text') or '-'}\n"
        f"Oldingi bog'lanish (bu Telegram foydalanuvchisi avval shu mijoz(lar) uchun to'lagan): {hint}"
    )
    if os.getenv("GEMINI_API_KEY"):
        result = await _gemini(prompt, photo, clients)
    else:
        result = await _claude(prompt, photo, clients)
    result["candidates"] = [c for c in result["candidates"] if c["client_id"] in by_id][:4]
    return result


VERIFY_SYSTEM = """Sen qattiq tekshiruvchisan. Rasmda/matnda mijozdan olingan pul yozuvi bor (to'lov cheki yoki qo'lda
yozilgan daftar sahifasi, "N ming/mln олдим" qatorlari; "ост." - qarz qoldig'i, to'lov EMAS).
FAQAT ENG OXIRGI (sahifada eng pastdagi, chekda - yagona) olingan pul yozuvini o'qi: sanasi, summasi va
qaysi mijozdan ekanini (quyidagi ro'yxatdan client_id). Har bir raqamni alohida, diqqat bilan o'qi.
Har bir maydon uchun 0-100 ishonch ber. Raqam xira, chizilgan, ikki xil o'qilishi mumkin, summa qaysi sanaga
tegishli ekani noaniq, sana mantiqsiz (kelajakda, oy xato) bo'lsa - ishonchni past qo'y. Taxmin qilma."""

VERIFY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["client_id", "client_conf", "date", "date_conf", "amount", "amount_conf", "comment"],
    "properties": {
        "client_id": {"type": "string", "description": "ro'yxatdagi id yoki bo'sh"},
        "client_conf": {"type": "integer"},
        "date": {"type": "string", "description": "YYYY-MM-DD yoki bo'sh"},
        "date_conf": {"type": "integer"},
        "amount": {"type": "integer", "description": "so'mda"},
        "amount_conf": {"type": "integer"},
        "comment": {"type": "string", "description": "nima noaniq, o'zbekcha qisqa"},
    },
}


STATEMENT_SYSTEM = """Sen buxgalter yordamchisisan. Xaridor (do'kon) o'zi yuritgan hisob-kitob (akt sverka) rasmlari
yoki matnini berdi: daftar sahifalari, Excel/1C akt sverka skrinshoti, qo'lda yozilgan ro'yxat. Bir nechta rasm - bitta
sverkaning davomi bo'lishi mumkin. Har bir harakatni ALOHIDA qator qilib chiqar:
  kind = "sale"    - bizdan tovar (yuk) olgan: "yuk", "tovar", "olindi tovar", "приход товара", "отгрузка", "накладная";
         "payment" - bizga pul to'lagan: "to'landi", "berildi pul", "олдим/оldim" (bizning daftarda), "оплата", "перечислено";
         "return"  - tovar qaytargan; "other" - turi aniq emas.
  Diqqat: kimning nuqtai nazaridan yozilganini aniqlang. Xaridor daftarida "tovar keldi" = biz yuk berdik (sale),
  "pul berdim/to'ladim" = biz pul oldik (payment).
  date - "YYYY-MM-DD"; amount - so'mda butun son ("1 250 000" -> 1250000, "500 ming" -> 500000, "3 mln" -> 3000000);
  doc_no - hujjat/nakladnoy raqami (bo'lsa); note - qatordagi asl yozuv qisqa; sure - raqam va sana aniq o'qildimi.
"Ост." / "qoldiq" / "сальдо" qatorlari harakat EMAS - ularni opening_balance (boshidagi) yoki closing_balance (oxiridagi)
ga yoz (xaridor bizga qarzdor bo'lsa musbat) va has_opening/has_closing = true; bo'lmasa false va 0. Jami/itogo qatorlarini harakat qilib yozma. Taxmin qilma."""

STATEMENT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["rows", "has_opening", "opening_balance", "has_closing", "closing_balance", "note"],
    "properties": {
        "rows": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["date", "kind", "amount", "doc_no", "note", "sure"],
            "properties": {
                "date": {"type": "string"}, "kind": {"type": "string", "enum": ["sale", "payment", "return", "other"]},
                "amount": {"type": "integer"}, "doc_no": {"type": "string"}, "note": {"type": "string"},
                "sure": {"type": "boolean"},
            }}},
        "has_opening": {"type": "boolean"}, "opening_balance": {"type": "integer"},
        "has_closing": {"type": "boolean"}, "closing_balance": {"type": "integer"},
        "note": {"type": "string", "description": "o'zbekcha: nima o'qilmadi yoki shubhali"},
    },
}


async def extract_statement(images: list[bytes], text: str, client_name: str) -> dict:
    """Xaridor bergan sverkani (rasmlar va/yoki matn) qatorlarga ajratish."""
    prompt = (f"Xaridor: {client_name}\nBugun: {datetime.now(timezone(timedelta(hours=5))).strftime('%Y-%m-%d')}\n"
              f"Rasmlar soni: {len(images)}\n" + (f"Xaridor yozib bergan matn:\n{text}" if text else ""))
    if os.getenv("GEMINI_API_KEY"):
        return await _gemini(prompt, images, [], STATEMENT_SYSTEM, STATEMENT_SCHEMA)
    return await _claude(prompt, images, [], STATEMENT_SYSTEM, STATEMENT_SCHEMA)


async def verify(meta: dict, photo: bytes | None, clients: list[dict]) -> dict:
    """Ikkinchi, mustaqil o'qish: faqat oxirgi yozuv. Birinchi o'qish natijasi bu yerga berilmaydi."""
    prompt = (f"Yuboruvchi (Telegram): {meta.get('full_name')}\n"
              f"Xabar vaqti: {meta.get('date')}\n"
              f"Xabar/izoh matni: {meta.get('text') or '-'}")
    if os.getenv("GEMINI_API_KEY"):
        return await _gemini(prompt, photo, clients, VERIFY_SYSTEM, VERIFY_SCHEMA)
    return await _claude(prompt, photo, clients, VERIFY_SYSTEM, VERIFY_SCHEMA)


async def _gemini(prompt: str, photo: bytes | None, clients: list[dict], system: str = None, schema: dict = None) -> dict:
    """Bepul variant: Google Gemini (aistudio.google.com dan olingan GEMINI_API_KEY)."""
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types

    gclient = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    photos = photo if isinstance(photo, list) else ([photo] if photo else [])
    parts = [types.Part.from_bytes(data=p, mime_type="image/jpeg") for p in photos]
    parts.append(prompt)
    config = types.GenerateContentConfig(
        system_instruction=(system or SYSTEM) + "\n\n" + clients_block(clients),
        response_mime_type="application/json",
        response_json_schema=schema or SCHEMA,
        temperature=0,
    )
    # Bepul tarifda model tez-tez band bo'ladi (503) yoki limitga uriladi (429):
    # navbatdagi flash modelga o'tamiz, hammasi band bo'lsa - kutib qaytadan
    models = await _gemini_models(gclient)
    last_err = None
    for delay in (0, 20, 60):
        await asyncio.sleep(delay)
        for model in models:
            try:
                response = await gclient.aio.models.generate_content(model=model, contents=parts, config=config)
                if not response.text:
                    raise RuntimeError(f"Gemini bo'sh javob qaytardi: {response.prompt_feedback}")
                return json.loads(response.text)
            except genai_errors.APIError as e:
                if e.code not in (404, 429, 500, 503):
                    raise
                print(f"Gemini {model}: {e.code}, keyingisiga o'tilmoqda")
                last_err = e
    raise last_err


_models_cache: list[str] = []


async def _gemini_models(gclient) -> list[str]:
    """GEMINI_MODEL birinchi, keyin shu kalit bilan mavjud boshqa flash modellar (yangisidan eskisiga)."""
    global _models_cache
    if not _models_cache:
        names = []
        try:
            async for m in await gclient.aio.models.list():
                name = (m.name or "").removeprefix("models/")
                if ("flash" in name and "generateContent" in (m.supported_actions or [])
                        and not any(x in name for x in ("image", "tts", "live", "audio", "embedding"))):
                    names.append(name)
        except Exception as e:
            print("Gemini modellar ro'yxatini olib bo'lmadi:", e)
        names.sort(reverse=True)
        _models_cache = [GEMINI_MODEL] + [n for n in names if n != GEMINI_MODEL][:5]
        print("Gemini modellar navbati:", _models_cache)
    return _models_cache


async def _claude(prompt: str, photo: bytes | None, clients: list[dict], system: str = None, schema: dict = None) -> dict:
    content = []
    for p in (photo if isinstance(photo, list) else ([photo] if photo else [])):
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                    "data": base64.standard_b64encode(p).decode()}})
    content.append({"type": "text", "text": prompt})

    response = await get_client().beta.messages.create(
        model=MODEL,
        max_tokens=4000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": schema or SCHEMA}},
        system=[
            {"type": "text", "text": system or SYSTEM},
            # mijozlar ro'yxati har chekda bir xil - keshlanadi (arzonroq va tezroq)
            {"type": "text", "text": clients_block(clients), "cache_control": {"type": "ephemeral", "ttl": "1h"}},
        ],
        messages=[{"role": "user", "content": content}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("Claude bu chekni tahlil qilishdan bosh tortdi")
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)
