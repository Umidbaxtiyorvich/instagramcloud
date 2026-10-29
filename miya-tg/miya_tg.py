"""Miya'ning Telegram akkaunti: haqiqiy (jiringlaydigan) Telegram qo'ng'iroqlari.

Sayt (Next.js) bilan bir serverda yonma-yon ishlaydi:
- Sayt 127.0.0.1:MIYA_TG_PORT ga buyruq beradi: kirish kodi, kirish, «shu odamga qo'ng'iroq qil».
- Bu dastur saytning /api/telefon/ichki manziliga yozadi: kim qo'ng'iroq qildi, egasi nima dedi,
  qo'ng'iroq tugadi yoki ko'tarilmadi. Miya'ning o'ylashi (vositalar, xotira) saytda.
- Ovoz: egasining gapi (PCM) → OpenAI matnga o'giradi; Miya javobi → OpenAI ovozga (PCM) → qo'ng'iroqqa.

Muhit: TG_API_ID, TG_API_HASH (my.telegram.org), OPENAI_API_KEY, AUTH_SECRET, PORT (sayt porti).
"""

import array
import asyncio
import re
import hashlib
import io
import logging
import math
import os
import struct
import tempfile
import time
import wave

from aiohttp import ClientSession, ClientTimeout, FormData, web
from pyrogram import Client
from pyrogram.errors import SessionPasswordNeeded
from pytgcalls import PyTgCalls, filters
from pytgcalls.exceptions import CallBusy, CallDeclined, NotInCallError, TimedOutAnswer
from ntgcalls import MediaSource
from pytgcalls.types.raw import AudioParameters, AudioStream, Stream
from pytgcalls.types import (
    AudioQuality,
    CallConfig,
    ChatUpdate,
    Direction,
    RecordStream,
    StreamFrames,
)

logging.basicConfig(level=logging.INFO, format="miya-tg: %(message)s")
log = logging.getLogger("miya-tg")
logging.getLogger("pyrogram").setLevel(logging.WARNING)

API_ID = int(os.environ.get("TG_API_ID", "0") or 0)
API_HASH = os.environ.get("TG_API_HASH", "")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
TTS_MODEL = os.environ.get("TELEFON_TTS_MODEL", "gpt-4o-mini-tts")
STT_MODEL = os.environ.get("TELEFON_STT_MODEL", "gpt-4o-transcribe")
OVOZ = os.environ.get("TELEFON_OVOZ", "ash")  # erkak ovozi, jonli
SAYT = f"http://127.0.0.1:{os.environ.get('PORT', '3000')}"
PORT = int(os.environ.get("MIYA_TG_PORT", "8790"))
# sayt bilan umumiy kalit (src/lib/miya-tg.ts dagi ichkiKalit bilan bir xil)
KALIT = hashlib.sha256(f"{os.environ.get('AUTH_SECRET', 'dev-auth-secret-change-me-please')}:ichki".encode()).hexdigest()

# OpenAI «pcm» — 24 kHz, 16-bit, mono; qo'ng'iroq ham shunday sozlanadi, qayta namunalash kerak emas
TEZLIK = 24000
SIFAT = AudioQuality.LOW  # (24000, 1)

# Gemini — o'zbekcha nutqni OpenAI'dan yaxshi taniydi; kalit bo'lsa «quloq» shu bo'ladi
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_STT_MODEL", "gemini-2.5-flash")
GEMINI_URL = os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")

# OpenAI Realtime: eshitish, o'ylash va gapirish bitta jonli ulanishda (odamdek tez). O'chirish: TELEFON_REALTIME=0
JONLI = os.environ.get("TELEFON_REALTIME", "1") != "0"
JONLI_MODEL = os.environ.get("TELEFON_REALTIME_MODEL", "gpt-realtime")
JONLI_URL = OPENAI_URL.replace("https://", "wss://").replace("http://", "ws://") + "/realtime"

MAX_QONGIROQ = 10 * 60
JAVOB_KUTISH = 40  # chiquvchi qo'ng'iroq shuncha soniya jiringlaydi


class Holat:
    app: Client | None = None
    calls: PyTgCalls | None = None
    men: str = ""
    kirish: Client | None = None  # kod yuborilgan, hali kirilmagan
    kirish_tel: str = ""
    kirish_hash: str = ""
    suhbatlar: dict[int, "Suhbat"] = {}
    http: ClientSession | None = None
    kalit: str = ""  # saytdan olingan OpenAI kaliti
    kalit_vaqt: float = -1e9


H = Holat()


# ---------- sayt va OpenAI ----------


async def sayt(amal: str, **kw):
    async with H.http.post(f"{SAYT}/api/telefon/ichki", json={"amal": amal, **kw}, headers={"x-ichki": KALIT}) as r:
        j = await r.json(content_type=None)
        if r.status >= 400:
            raise RuntimeError(j.get("error") if isinstance(j, dict) else f"HTTP {r.status}")
        return j


async def openai_kalit() -> str:
    """Saytdagi «Ulanishlar»da almashtirilgan kalit (daqiqada bir so'raladi); sayt javob bermasa — oxirgisi yoki OPENAI_API_KEY."""
    if time.monotonic() - H.kalit_vaqt > 60:
        try:
            H.kalit = (await sayt("openai_kalit")).get("kalit") or OPENAI_KEY
            H.kalit_vaqt = time.monotonic()
        except Exception as e:
            log.warning("OpenAI kaliti saytdan olinmadi: %s", e)
    return H.kalit or OPENAI_KEY


async def izoh(q: str, matn: str):
    """Qo'ng'iroq tarixiga texnik qayd (saytdagi Telefon bo'limida ko'rinadi)."""
    log.info("[%s] %s", q[-6:], matn)
    try:
        await sayt("izoh", q=q, matn=matn[:300])
    except Exception:  # noqa: BLE001
        pass


def stereo48(pcm: bytes) -> bytes:
    """24 kHz mono → 48 kHz stereo (Telegram qo'ng'irog'ining o'z formati — ovoz tiniqroq chiqadi)."""
    a = array.array("h", pcm[: len(pcm) // 2 * 2])
    n = len(a)
    out = array.array("h", bytes(n * 8))
    for i in range(n):
        x = a[i]
        y = (x + a[i + 1]) // 2 if i + 1 < n else x
        j = i * 4
        out[j] = out[j + 1] = x
        out[j + 2] = out[j + 3] = y
    return out.tobytes()


def fayl_oqim(pcm: bytes) -> tuple[Stream, str]:
    """Ovozni (24 kHz mono PCM) 48 kHz stereo qilib vaqtinchalik faylga yozadi — qo'ng'iroq uni o'zi o'qiydi."""
    fd, yol = tempfile.mkstemp(prefix="miya-", suffix=".pcm")
    with os.fdopen(fd, "wb") as f:
        f.write(stereo48(pcm))
    return Stream(microphone=AudioStream(MediaSource.FILE, yol, AudioParameters(48000, 2))), yol


JIMLIK = b"\0" * (TEZLIK * 2)  # 1 soniya


async def ovoz(matn: str) -> bytes:
    async with H.http.post(
        f"{OPENAI_URL}/audio/speech",
        headers={"Authorization": f"Bearer {await openai_kalit()}"},
        json={
            "model": TTS_MODEL,
            "voice": OVOZ,
            "input": matn[:1500],
            "instructions": "Yosh erkak kishi ovozida, o'zbek tilida, Toshkent talaffuzida, jonli va quvnoq gapiring. Har bir so'zni aniq, ravon talaffuz qiling — telefonda gaplashgandek, shoshmasdan.",
            "response_format": "pcm",
        },
    ) as r:
        if r.status >= 400:
            raise RuntimeError(f"TTS: HTTP {r.status}")
        return await r.read()


def wav(pcm: bytes, tezlik: int = TEZLIK) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(tezlik)
        w.writeframes(pcm)
    return b.getvalue()


async def matnga(pcm: bytes, tezlik: int = TEZLIK) -> str:
    """Ovozni matnga o'giradi. OpenAI rad etsa (masalan, til yoki model qabul qilinmasa) —
    tilsiz, keyin whisper-1 bilan qayta urinadi."""
    global STT_BOSHI
    audio = wav(pcm, tezlik)
    if GEMINI_KEY:
        try:
            return await gemini_matn(audio)
        except Exception as e:  # noqa: BLE001
            log.info("Gemini tanimadi, OpenAI bilan: %s", e)
    xato = ""
    variantlar = ((STT_MODEL, "uz"), (STT_MODEL, None), ("whisper-1", "uz"), ("whisper-1", None))
    # oldin ishlagan variantdan boshlaymiz — har gapda rad etiladigan so'rovga vaqt ketmasin
    for k, (model, til) in list(enumerate(variantlar))[STT_BOSHI:] + list(enumerate(variantlar))[:STT_BOSHI]:
        f = FormData()
        f.add_field("file", audio, filename="gap.wav", content_type="audio/wav")
        f.add_field("model", model)
        if til:
            f.add_field("language", til)
        async with H.http.post(f"{OPENAI_URL}/audio/transcriptions", headers={"Authorization": f"Bearer {await openai_kalit()}"}, data=f) as r:
            j = await r.json(content_type=None)
            if r.status < 400:
                STT_BOSHI = k
                return str(j.get("text", "")).strip()
            xato = f"{model}{'/' + til if til else ''}: HTTP {r.status} {str((j.get('error') or {}).get('message', ''))[:160]}"
            log.info("STT rad etdi — %s", xato)
            if r.status != 400:
                break
    raise RuntimeError(f"STT: {xato}")


STT_BOSHI = 0

# Javob kechiksa aytiladigan qisqa gaplar (bir marta ovozga aylantirilib, xotirada turadi)
OYLASH = ["Hmm, bir soniya.", "Xo'p, hozir qarayman.", "Tushundim, bir daqiqa."]
oylash_ovoz: dict[str, bytes] = {}


async def oylash(i: int) -> bytes:
    m = OYLASH[i % len(OYLASH)]
    if m not in oylash_ovoz:
        oylash_ovoz[m] = await ovoz(m)
    return oylash_ovoz[m]


def gaplarga(matn: str) -> list[str]:
    """Javobni bo'laklarga: birinchi gap alohida (tezroq boshlanadi), qolgani birga."""
    gaplar = [g.strip() for g in re.split(r"(?<=[.!?…])\s+", matn.strip()) if g.strip()]
    if len(gaplar) <= 1:
        return gaplar or [matn]
    return [gaplar[0], " ".join(gaplar[1:])]


GEMINI_KORSATMA = (
    "Bu audio — o'zbek tilidagi telefon suhbatidan parcha (ba'zan ruscha so'zlar aralashgan). "
    "Aytilgan so'zlarni aynan o'zbek lotin yozuvida yozing. Tarjima qilmang, hech narsa qo'shmang, izoh bermang — faqat matnning o'zi. "
    "Nutq bo'lmasa yoki umuman tushunarsiz bo'lsa — hech narsa yozmang."
)


async def gemini_matn(audio: bytes, mime: str = "audio/wav") -> str:
    import base64

    body = {
        "contents": [{"parts": [{"text": GEMINI_KORSATMA}, {"inline_data": {"mime_type": mime, "data": base64.b64encode(audio).decode()}}]}],
        "generationConfig": {"temperature": 0, "thinkingConfig": {"thinkingBudget": 0}},
    }
    async with H.http.post(
        f"{GEMINI_URL}/models/{GEMINI_MODEL}:generateContent", headers={"x-goog-api-key": GEMINI_KEY}, json=body
    ) as r:
        j = await r.json(content_type=None)
        if r.status >= 400:
            raise RuntimeError(f"Gemini HTTP {r.status}: {str((j.get('error') or {}).get('message', ''))[:160]}")
    parts = (((j.get("candidates") or [{}])[0].get("content") or {}).get("parts")) or []
    return " ".join(p.get("text", "") for p in parts).strip()


def rms(pcm: bytes) -> float:
    n = len(pcm) // 2
    if not n:
        return 0.0
    s = 0
    for (x,) in struct.iter_unpack("<h", pcm[: n * 2]):
        s += x * x
    return math.sqrt(s / n) / 32768


# ---------- bitta qo'ng'iroq ----------


class Suhbat:
    def __init__(self, user_id: int, q: str, ochilish: str):
        self.user_id = user_id
        self.q = q
        self.ochilish = ochilish
        self.gapiryapti = False
        self.tugadi = asyncio.Event()
        self.bufer = bytearray()
        self.gapirdi = False
        self.oxirgi_ovoz = 0.0
        self.boshi = 0.0
        self.shovqin = 0.003
        self.gap_tayyor = asyncio.Event()
        self.kadr_soni = 0
        self.kadr_hajm = 0
        self.oylash_soni = -1

    @property
    def tezlik(self) -> int:
        # bitta kadr 10 ms; 16-bit mono deb hisoblab chastotani topamiz (kutilgani 24000 → 480 bayt)
        return self.kadr_hajm * 50 if self.kadr_hajm else TEZLIK

    def kadrlar(self, pcm: bytes):
        """Egasining ovozi (10 ms bo'laklar). Miya gapirayotganda eshitmaydi."""
        if not self.kadr_hajm and pcm:
            self.kadr_hajm = len(pcm)
            asyncio.create_task(izoh(self.q, f"🔧 ovozingiz kela boshladi: kadr {len(pcm)} bayt (~{self.tezlik} Hz)"))
        self.kadr_soni += 1
        if self.gapiryapti:
            return
        hozir = time.monotonic()
        if not self.boshi:
            self.boshi = hozir
        d = rms(pcm)
        chegara = max(0.01, self.shovqin * 3)
        if d < chegara:
            self.shovqin = self.shovqin * 0.97 + d * 0.03
        else:
            self.gapirdi = True
            self.oxirgi_ovoz = hozir
        if self.gapirdi:
            self.bufer += pcm
        if self.gapirdi and (hozir - self.oxirgi_ovoz > 0.9 or len(self.bufer) > self.tezlik * 2 * 40):
            self.gap_tayyor.set()

    def tingla_boshla(self):
        self.bufer = bytearray()
        self.gapirdi = False
        self.boshi = 0.0
        self.gap_tayyor.clear()

    async def gapir(self, matn: str):
        # bo'laklarning ovozi parallel tayyorlanadi; birinchisi tayyor bo'lishi bilan gapira boshlaydi
        vazifalar = [asyncio.create_task(ovoz(b)) for b in gaplarga(matn)]
        for v in vazifalar:
            if self.tugadi.is_set():
                v.cancel()
                continue
            await self.ijro(await v)

    async def ijro(self, pcm: bytes):
        oqim, yol = fayl_oqim(pcm)
        self.gapiryapti = True
        try:
            # qo'ng'iroq manbasini shu faylga almashtiramiz va u tugaguncha kutamiz
            await H.calls.play(self.user_id, oqim)
            davom = len(pcm) / (TEZLIK * 2)
            try:
                await asyncio.wait_for(self.tugadi.wait(), timeout=davom + 0.4)
            except asyncio.TimeoutError:
                pass
        finally:
            self.gapiryapti = False
            self.tingla_boshla()
            try:
                os.unlink(yol)
            except OSError:
                pass

    async def tushun(self, pcm: bytes):
        """Gapni matnga o'giradi va Miya'ning javobini oladi."""
        matn = await matnga(pcm, self.tezlik)
        if not matn:
            return "", {}
        return matn, await sayt("gap", q=self.q, matn=matn)

    async def ishla(self):
        try:
            await H.calls.record(self.user_id, RecordStream(audio=True, audio_parameters=SIFAT))
            await izoh(self.q, "🔧 ulandi, Miya gapirmoqda")
            for i in range(len(OYLASH)):
                asyncio.create_task(oylash(i))  # oldindan tayyorlab qo'yamiz
            await self.gapir(self.ochilish)
            jim = 0
            while not self.tugadi.is_set():
                self.tingla_boshla()
                try:
                    await asyncio.wait_for(self.gap_tayyor.wait(), timeout=20)
                except asyncio.TimeoutError:
                    jim += 1
                    if not self.kadr_soni:
                        await izoh(self.q, "🔧 sizning ovozingiz umuman kelmayapti (0 kadr)")
                    if jim >= 2:
                        await self.gapir("Eshitmayapman. Kerak bo'lsam, qayta qo'ng'iroq qiling. Xayr!")
                        break
                    await self.gapir("Eshityapsizmi? Gapiravering.")
                    continue
                jim = 0
                pcm = bytes(self.bufer)
                self.tingla_boshla()
                ish = asyncio.create_task(self.tushun(pcm))
                # javob tez tayyor bo'lmasa — odamdek «hmm, bir soniya» deydi, jim turib qolmaydi
                done, _ = await asyncio.wait({ish}, timeout=1.8)
                if not done:
                    self.oylash_soni += 1
                    await self.ijro(await oylash(self.oylash_soni))
                matn, j = await ish
                if not matn:
                    await izoh(self.q, f"🔧 {len(pcm) // (self.tezlik * 2)} soniyalik ovoz matnga o'girilmadi")
                    await self.gapir("Eshitolmadim, qaytadan ayting.")
                    continue
                await self.gapir(j.get("javob") or "Tushunmadim, qaytadan ayting.")
                if j.get("tugat"):
                    break
        except NotInCallError:
            pass
        except Exception as e:  # noqa: BLE001
            log.exception("suhbat: %s", e)
            await izoh(self.q, f"🔧 xato: {type(e).__name__}: {str(e)[:200]}")
        finally:
            await tugat(self.user_id)


# ---------- jonli (Realtime) suhbat ----------

JONLI_TIZIM = """Siz «Miya»siz — egasining biznesini (Instagram, CloudShop do'koni) kuzatib boradigan yordamchi. Hozir egasi bilan
TELEFONDA, jonli gaplashyapsiz. Xuddi tirik odamdek gapiring: o'zbek tilida (lotin talaffuzi, Toshkent shevasi), samimiy, jonli,
qisqa — 1-2 jumla. Umumiy gaplar yo'q, aniq javob bering. Egasi gapingizni bo'lsa — to'xtab, uni tinglang.
Egasi O'ZBEK tilida gapiradi (ba'zan ruscha so'zlar aralashadi). Gapini aniq tushunmasangiz — HECH QACHON taxmin qilmang va
boshqa mavzuda gapirmang: «Kechirasiz, yaxshi eshitmadim, qaytadan ayting» deng. Javob berishdan oldin uning savolini
o'zingizcha bir jumlada takrorlab tasdiqlashingiz mumkin («Kassadagi pulni so'rayapsizmi?»).
Biznes ma'lumoti (Instagram statistikasi, kommentlar, Direct, kassa, qarz, tovar) kerak bo'lsa yoki biror ish qilish kerak bo'lsa
(kommentga javob, qoida, tasdiqlash, Reels) — «miya» vositasini chaqiring, egasining so'rovini aniq yozing, natijasini qisqa ayting.
O'ylab topmang. Instagram'ga yozadigan ishni bajarishdan oldin nima qilinishini aytib, «ha» oling.
Egasi xayrlashsa — qisqa xayrlashing va «tugat» vositasini chaqiring."""

JONLI_VOSITALAR = [
    {
        "type": "function",
        "name": "miya",
        "description": "Biznes ma'lumotini olish yoki ish bajarish (Instagram, kassa, qarz, tovar, qoidalar, tasdiqlar). sorov — egasi nima so'ragani, aniq.",
        "parameters": {"type": "object", "properties": {"sorov": {"type": "string"}}, "required": ["sorov"]},
    },
    {"type": "function", "name": "tugat", "description": "Suhbat tugadi — go'shakni qo'yish.", "parameters": {"type": "object", "properties": {}}},
]


class Jonli:
    """OpenAI Realtime bilan jonli ovozli suhbat: egasining ovozi uzluksiz yuboriladi, model o'zi gap tugaganini
    sezadi va darhol ovoz bilan javob beradi; egasi gapini bo'lsa — Miya to'xtaydi."""

    def __init__(self, user_id: int, q: str, ochilish: str):
        self.user_id = user_id
        self.q = q
        self.ochilish = ochilish
        self.tugadi = asyncio.Event()
        self.ws = None
        self.kirish: asyncio.Queue[bytes] = asyncio.Queue()
        self.navbat: asyncio.Queue[bytes] = asyncio.Queue()
        self.bolak = bytearray()
        self.uzildi = asyncio.Event()
        self.gapiryapti = False
        self.yopilsin = False
        self.kadr_soni = 0
        self.kadr_bufer = bytearray()
        self.boshlandi = False
        self.salom_aytildi = False
        # Gemini rejimi: gap tugashini o'zimiz sezamiz, Gemini matnga o'giradi, Realtime'ga matn boradi
        self.gemini = bool(GEMINI_KEY)
        self.gaplar: asyncio.Queue[bytes] = asyncio.Queue()
        self.vad_bufer = bytearray()
        self.vad_gapirdi = False
        self.vad_oxirgi = 0.0
        self.vad_baland = 0
        self.shovqin = 0.003

    def vad(self, pcm: bytes):
        """Egasi qachon gapirib, qachon to'xtaganini sezish (Gemini rejimi)."""
        hozir = time.monotonic()
        d = rms(pcm)
        chegara = max(0.01, self.shovqin * 3)
        if d < chegara:
            self.shovqin = self.shovqin * 0.97 + d * 0.03
            self.vad_baland = 0
        else:
            self.vad_baland += 1
            self.vad_oxirgi = hozir
            # Miya gapirayotganda egasi 0.25 s gapirsa — Miyani to'xtatamiz
            if self.gapiryapti and self.vad_baland == 25:
                asyncio.create_task(self.uz())
            if not self.vad_gapirdi and self.vad_baland >= 3:
                self.vad_gapirdi = True
        if self.vad_gapirdi:
            self.vad_bufer += pcm
            if hozir - self.vad_oxirgi > 0.8 or len(self.vad_bufer) > TEZLIK * 2 * 30:
                self.gaplar.put_nowait(bytes(self.vad_bufer))
                self.vad_bufer = bytearray()
                self.vad_gapirdi = False

    async def eshit(self):
        """Gemini rejimi: har bir gapni matnga o'girib, Realtime'ga beradi — u ovoz bilan javob qaytaradi."""
        while not self.tugadi.is_set():
            pcm = await self.gaplar.get()
            if len(pcm) < TEZLIK * 2 * 0.3:
                continue
            try:
                matn = await matnga(pcm)
            except Exception as e:  # noqa: BLE001
                await izoh(self.q, f"🔧 ovoz tanilmadi: {str(e)[:150]}")
                matn = ""
            if not matn:
                await self.ws.send_json(
                    {"type": "response.create", "response": {"instructions": "Egasining gapi eshitilmadi. Qisqa qilib qaytadan aytishini so'rang."}}
                )
                continue
            try:
                await sayt("yoz", q=self.q, kim="men", matn=matn)
            except Exception:  # noqa: BLE001
                pass
            await self.ws.send_json(
                {"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": matn}]}}
            )
            await self.ws.send_json({"type": "response.create"})

    # Telegram'dan kelgan ovoz (10 ms kadrlar) — 100 ms dan yig'ib yuboriladi
    def kadrlar(self, pcm: bytes):
        if not self.kadr_soni:
            asyncio.create_task(izoh(self.q, f"🔧 ovozingiz kela boshladi: kadr {len(pcm)} bayt"))
        self.kadr_soni += 1
        if self.gemini:
            self.vad(pcm)
            return
        self.kadr_bufer += pcm
        if len(self.kadr_bufer) >= TEZLIK * 2 // 10:
            self.kirish.put_nowait(bytes(self.kadr_bufer))
            self.kadr_bufer = bytearray()

    async def yubor(self):
        import base64

        while not self.tugadi.is_set():
            pcm = await self.kirish.get()
            if self.ws is not None and not self.ws.closed:
                await self.ws.send_json({"type": "input_audio_buffer.append", "audio": base64.b64encode(pcm).decode()})

    # Miya ovozi: bo'laklar navbat bilan ijro etiladi
    async def ijrochi(self):
        while not self.tugadi.is_set():
            pcm = await self.navbat.get()
            oqim, yol = fayl_oqim(pcm)
            self.gapiryapti = True
            try:
                await H.calls.play(self.user_id, oqim)
                self.uzildi.clear()
                try:
                    await asyncio.wait_for(self.uzildi.wait(), timeout=len(pcm) / (TEZLIK * 2))
                except asyncio.TimeoutError:
                    pass
            finally:
                try:
                    os.unlink(yol)
                except OSError:
                    pass
                if self.navbat.empty():
                    self.gapiryapti = False

    def chiqar(self, hammasi: bool = False):
        # birinchi bo'lak tez chiqsin (0.6 s), keyingilari kattaroq
        chegara = TEZLIK * 2 * (0.6 if not self.gapiryapti and self.navbat.empty() else 2.0)
        if self.bolak and (hammasi or len(self.bolak) >= chegara):
            self.navbat.put_nowait(bytes(self.bolak))
            self.bolak = bytearray()

    async def uz(self):
        """Egasi gapira boshladi — Miya darhol jim bo'ladi."""
        self.bolak = bytearray()
        while not self.navbat.empty():
            self.navbat.get_nowait()
        if self.gapiryapti:
            self.uzildi.set()
            oqim, yol = fayl_oqim(b"\0" * 4800)
            try:
                await H.calls.play(self.user_id, oqim)
            finally:
                asyncio.get_running_loop().call_later(5, lambda: os.path.exists(yol) and os.unlink(yol))
            if self.ws is not None:
                await self.ws.send_json({"type": "response.cancel"})

    async def vosita(self, nom: str, call_id: str, argumentlar: str):
        import json

        if nom == "tugat":
            natija = "ok"
        else:
            try:
                sorov = json.loads(argumentlar or "{}").get("sorov", "")
                await izoh(self.q, f"🔧 ma'lumot so'radi: {sorov[:120]}")
                natija = (await sayt("jonli_ish", q=self.q, sorov=sorov)).get("javob", "")
            except Exception as e:  # noqa: BLE001
                natija = f"Xatolik: {e}"
        await self.ws.send_json({"type": "conversation.item.create", "item": {"type": "function_call_output", "call_id": call_id, "output": natija[:4000]}})
        if nom != "tugat":
            await self.ws.send_json({"type": "response.create"})

    def sessiya(self, kontekst: str, ga: bool):
        ko = f"{JONLI_TIZIM}\n\n{kontekst}"
        if ga:
            return {
                "type": "session.update",
                "session": {
                    "type": "realtime",
                    "model": JONLI_MODEL,
                    "instructions": ko,
                    "audio": {
                        "input": (
                            {"format": {"type": "audio/pcm", "rate": TEZLIK}, "turn_detection": None}
                            if self.gemini
                            else {
                                "format": {"type": "audio/pcm", "rate": TEZLIK},
                                "turn_detection": {"type": "server_vad", "silence_duration_ms": 550, "prefix_padding_ms": 300},
                                "transcription": {"model": "gpt-4o-transcribe"},
                                "noise_reduction": {"type": "near_field"},
                            }
                        ),
                        "output": {"format": {"type": "audio/pcm", "rate": TEZLIK}, "voice": OVOZ},
                    },
                    "tools": JONLI_VOSITALAR,
                    "tool_choice": "auto",
                },
            }
        return {
            "type": "session.update",
            "session": {
                "modalities": ["audio", "text"],
                "instructions": ko,
                "voice": OVOZ,
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "input_audio_transcription": None if self.gemini else {"model": "whisper-1"},
                "turn_detection": None if self.gemini else {"type": "server_vad", "silence_duration_ms": 550},
                "tools": JONLI_VOSITALAR,
                "tool_choice": "auto",
            },
        }

    async def ishla(self):
        import base64

        vazifalar = []
        try:
            kontekst = (await sayt("jonli_boshla", q=self.q)).get("kontekst", "")
            self.ws = await H.http.ws_connect(
                f"{JONLI_URL}?model={JONLI_MODEL}", headers={"Authorization": f"Bearer {await openai_kalit()}"}, heartbeat=20, max_msg_size=0
            )
            ga = True
            await self.ws.send_json(self.sessiya(kontekst, ga))
            await H.calls.record(self.user_id, RecordStream(audio=True, audio_parameters=SIFAT))
            vazifalar = [asyncio.create_task(self.eshit() if self.gemini else self.yubor()), asyncio.create_task(self.ijrochi())]
            await izoh(self.q, f"🔧 jonli suhbat ({JONLI_MODEL}{', quloq: Gemini' if self.gemini else ''}) ulandi")
            await self.ws.send_json(
                {"type": "response.create", "response": {"instructions": f"Egasiga aynan shu so'zlar bilan, jonli ohangda salom bering: {self.ochilish}"}}
            )
            async for msg in self.ws:
                if self.tugadi.is_set():
                    break
                if msg.type != 1:  # TEXT
                    if msg.type in (8, 256, 257, 258):  # CLOSE / CLOSING / CLOSED / ERROR
                        break
                    continue
                e = msg.json()
                t = e.get("type", "")
                if t == "session.updated":
                    self.boshlandi = True
                elif t == "error":
                    xabar = str((e.get("error") or {}).get("message", e))[:200]
                    await izoh(self.q, f"🔧 Realtime: {xabar}")
                    # yangi (GA) format qabul qilinmasa — eski (beta) formatda qayta
                    if ga and not self.boshlandi:
                        ga = False
                        await self.ws.send_json(self.sessiya(kontekst, ga))
                elif t == "input_audio_buffer.speech_started":
                    await self.uz()
                elif t in ("response.output_audio.delta", "response.audio.delta"):
                    self.bolak += base64.b64decode(e.get("delta", ""))
                    self.chiqar()
                elif t in ("response.output_audio.done", "response.audio.done"):
                    self.chiqar(hammasi=True)
                elif t == "conversation.item.input_audio_transcription.completed":
                    asyncio.create_task(sayt("yoz", q=self.q, kim="men", matn=e.get("transcript", "")))
                elif t in ("response.output_audio_transcript.done", "response.audio_transcript.done"):
                    # salom qo'ng'iroq yaratilganda yozilgan — takrorlamaymiz
                    if self.salom_aytildi:
                        asyncio.create_task(sayt("yoz", q=self.q, kim="miya", matn=e.get("transcript", "")))
                    self.salom_aytildi = True
                elif t == "response.function_call_arguments.done":
                    if e.get("name") == "tugat":
                        self.yopilsin = True  # shu javob tugashi bilan go'shakni qo'yamiz
                    asyncio.create_task(self.vosita(e.get("name", ""), e.get("call_id", ""), e.get("arguments", "")))
                elif t == "response.done" and self.yopilsin:
                    self.chiqar(hammasi=True)
                    while self.gapiryapti or not self.navbat.empty():
                        await asyncio.sleep(0.2)
                    break
        except NotInCallError:
            pass
        except Exception as e:  # noqa: BLE001
            log.exception("jonli: %s", e)
            await izoh(self.q, f"🔧 jonli xato: {type(e).__name__}: {str(e)[:200]}")
            if not self.boshlandi and not self.tugadi.is_set():
                # Realtime ishlamadi — oddiy usulda davom etamiz
                for v in vazifalar:
                    v.cancel()
                s = Suhbat(self.user_id, self.q, self.ochilish)
                s.tugadi = self.tugadi
                H.suhbatlar[self.user_id] = s
                await s.ishla()
                return
        finally:
            for v in vazifalar:
                v.cancel()
            if self.ws is not None and not self.ws.closed:
                await self.ws.close()
        await tugat(self.user_id)


async def tugat(user_id: int):
    s = H.suhbatlar.pop(user_id, None)
    if not s:
        return
    s.tugadi.set()
    try:
        await H.calls.leave_call(user_id)
    except Exception:  # noqa: BLE001
        pass
    await sayt("tugadi", q=s.q)


async def ulan(user_id: int, s, chiquvchi: bool):
    """Qo'ng'iroqni ulaydi (chiquvchida — jiringlatib kutadi), keyin suhbatni boshlaydi."""
    H.suhbatlar[user_id] = s
    oqim, yol = fayl_oqim(JIMLIK)
    try:
        await H.calls.play(
            user_id,
            oqim,
            CallConfig(timeout=JAVOB_KUTISH) if chiquvchi else CallConfig(),
        )
    except (TimedOutAnswer, CallDeclined, CallBusy) as e:
        H.suhbatlar.pop(user_id, None)
        log.info("ko'tarilmadi: %s", type(e).__name__)
        await sayt("javobsiz", q=s.q)
        return
    except Exception as e:  # noqa: BLE001
        H.suhbatlar.pop(user_id, None)
        log.exception("ulanmadi: %s", e)
        await sayt("javobsiz", q=s.q, xato=str(e)[:200])
        return
    finally:
        asyncio.get_running_loop().call_later(30, lambda: os.path.exists(yol) and os.unlink(yol))
    asyncio.create_task(s.ishla())
    asyncio.create_task(muddat(user_id, s))


def yangi_suhbat(user_id: int, q: str, ochilish: str):
    return Jonli(user_id, q, ochilish) if JONLI else Suhbat(user_id, q, ochilish)


async def muddat(user_id: int, s):
    try:
        await asyncio.wait_for(s.tugadi.wait(), timeout=MAX_QONGIROQ)
    except asyncio.TimeoutError:
        await tugat(user_id)


# ---------- Telegram ----------


def raqam(s: str | None) -> str:
    return "".join(ch for ch in (s or "") if ch.isdigit())


async def telefoni(user_id: int) -> str:
    """Qo'ng'iroq qilganning telefon raqami. Yashirin bo'lsa — ruxsat etilgan raqamni kontaktga qo'shib bilib olamiz."""
    try:
        u = await H.app.get_users(user_id)
        if u.phone_number:
            return raqam(u.phone_number)
        ruxsat = (await sayt("ruxsat")).get("telefon")
        if ruxsat:
            from pyrogram.types import InputPhoneContact

            await H.app.import_contacts([InputPhoneContact(f"+{raqam(ruxsat)}", "Egasi")])
            u = await H.app.get_users(user_id)
            return raqam(u.phone_number)
    except Exception as e:  # noqa: BLE001
        log.info("raqam aniqlanmadi (%s): %s", user_id, e)
    return ""


async def ishga_tushir(sessiya: str):
    app = Client("miya", api_id=API_ID, api_hash=API_HASH, session_string=sessiya, in_memory=True, no_updates=False)
    calls = PyTgCalls(app)

    @calls.on_update(filters.chat_update(ChatUpdate.Status.INCOMING_CALL))
    async def kiruvchi(_, u: ChatUpdate):
        user_id = u.chat_id
        if user_id in H.suhbatlar:
            return
        try:
            j = await sayt("kiruvchi", tgId=str(user_id), telefon=await telefoni(user_id))
        except Exception as e:  # noqa: BLE001
            # begona odam: ko'tarmaymiz va rad ham etmaymiz — Miya akkaunti ochilgan telefonda oddiy jiringlaydi
            log.info("begona qo'ng'iroq (%s): %s", user_id, e)
            ism = str(user_id)
            try:
                u2 = await H.app.get_users(user_id)
                ism = " ".join(x for x in [u2.first_name, u2.last_name] if x) + (f" (@{u2.username})" if u2.username else "")
                ism += f", {u2.phone_number}" if getattr(u2, "phone_number", None) else ""
            except Exception:  # noqa: BLE001
                pass
            try:
                await sayt("begona", ism=ism.strip() or str(user_id))
            except Exception:  # noqa: BLE001
                pass
            return
        await ulan(user_id, yangi_suhbat(user_id, j["q"], j["salom"]), chiquvchi=False)

    @calls.on_update(filters.chat_update(ChatUpdate.Status.LEFT_CALL))
    async def tashladi(_, u: ChatUpdate):
        if u.chat_id in H.suhbatlar:
            await tugat(u.chat_id)

    @calls.on_update(filters.stream_frame(Direction.INCOMING))
    async def kadr(_, u: StreamFrames):
        s = H.suhbatlar.get(u.chat_id)
        if s:
            for f in u.frames:
                if not f.info.width:  # video kadrlar emas
                    s.kadrlar(f.frame)

    await calls.start()
    me = await app.get_me()
    H.app, H.calls = app, calls
    H.men = f"@{me.username}" if me.username else (me.first_name or str(me.id))
    log.info("Miya akkaunti ulandi: %s", H.men)


# ---------- ichki HTTP (faqat sayt) ----------


def ruxsat(req: web.Request):
    if req.headers.get("x-ichki") != KALIT:
        raise web.HTTPUnauthorized()


async def holat(req: web.Request):
    ruxsat(req)
    return web.json_response({"ulangan": H.calls is not None, "men": H.men, "kodKutilmoqda": H.kirish is not None, "band": len(H.suhbatlar)})


async def kod(req: web.Request):
    ruxsat(req)
    b = await req.json()
    if H.kirish:
        await H.kirish.disconnect()
    c = Client("miya-kirish", api_id=API_ID, api_hash=API_HASH, in_memory=True)
    try:
        await c.connect()
        sent = await c.send_code(b["telefon"])
    except Exception as e:  # noqa: BLE001
        log.exception("kod: %s", e)
        try:
            await c.disconnect()
        except Exception:  # noqa: BLE001
            pass
        return web.json_response({"error": f"Telegram: {e or type(e).__name__}"}, status=400)
    H.kirish, H.kirish_tel, H.kirish_hash = c, b["telefon"], sent.phone_code_hash
    return web.json_response({"ok": True})


async def kirish(req: web.Request):
    ruxsat(req)
    b = await req.json()
    c = H.kirish
    if not c:
        return web.json_response({"error": "Avval kod so'rang"}, status=400)
    try:
        try:
            await c.sign_in(H.kirish_tel, H.kirish_hash, b.get("kod", ""))
        except SessionPasswordNeeded:
            if not b.get("parol"):
                return web.json_response({"error": "Ikki bosqichli parol kerak", "parolKerak": True}, status=400)
            await c.check_password(b["parol"])
        sessiya = await c.export_session_string()
    except Exception as e:  # noqa: BLE001
        return web.json_response({"error": str(e)}, status=400)
    await c.disconnect()
    H.kirish = None
    await sayt("sessiya_saqla", sessiya=sessiya)
    if H.calls is None:
        await ishga_tushir(sessiya)
    return web.json_response({"ok": True, "men": H.men})


async def qongiroq(req: web.Request):
    ruxsat(req)
    b = await req.json()
    if H.calls is None:
        return web.json_response({"error": "Miya akkaunti ulanmagan"}, status=400)
    user_id = int(b["tgId"])
    if user_id in H.suhbatlar:
        return web.json_response({"error": "Hozir gaplashyapti"}, status=409)
    try:
        await H.app.resolve_peer(user_id)
    except Exception:  # noqa: BLE001
        return web.json_response(
            {"error": "Miya akkaunti sizni hali tanimaydi — asosiy akkauntingizdan Miya akkauntiga bitta xabar yozing"},
            status=400,
        )
    asyncio.create_task(ulan(user_id, yangi_suhbat(user_id, b["q"], b["matn"]), chiquvchi=True))
    return web.json_response({"ok": True})


async def main():
    if not API_ID or not API_HASH:
        log.info("TG_API_ID / TG_API_HASH yo'q — ishlamayman")
        return
    H.http = ClientSession(timeout=ClientTimeout(total=120))
    srv = web.Application()
    srv.add_routes([web.get("/holat", holat), web.post("/kod", kod), web.post("/kirish", kirish), web.post("/qongiroq", qongiroq)])
    runner = web.AppRunner(srv)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", PORT).start()
    log.info("ichki port %s", PORT)

    # sayt ishga tushguncha kutib, saqlangan sessiyani olamiz
    for _ in range(60):
        try:
            j = await sayt("sessiya_ol")
            if j.get("sessiya"):
                await ishga_tushir(j["sessiya"])
            break
        except Exception as e:  # noqa: BLE001
            log.info("sayt hali tayyor emas: %s", e)
            await asyncio.sleep(5)
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
