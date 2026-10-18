"""Miya'ning Telegram akkaunti: haqiqiy (jiringlaydigan) Telegram qo'ng'iroqlari.

Sayt (Next.js) bilan bir serverda yonma-yon ishlaydi:
- Sayt 127.0.0.1:MIYA_TG_PORT ga buyruq beradi: kirish kodi, kirish, «shu odamga qo'ng'iroq qil».
- Bu dastur saytning /api/telefon/ichki manziliga yozadi: kim qo'ng'iroq qildi, egasi nima dedi,
  qo'ng'iroq tugadi yoki ko'tarilmadi. Miya'ning o'ylashi (vositalar, xotira) saytda.
- Ovoz: egasining gapi (PCM) → OpenAI matnga o'giradi; Miya javobi → OpenAI ovozga (PCM) → qo'ng'iroqqa.

Muhit: TG_API_ID, TG_API_HASH (my.telegram.org), OPENAI_API_KEY, AUTH_SECRET, PORT (sayt porti).
"""

import asyncio
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
OVOZ = os.environ.get("TELEFON_OVOZ", "coral")
SAYT = f"http://127.0.0.1:{os.environ.get('PORT', '3000')}"
PORT = int(os.environ.get("MIYA_TG_PORT", "8790"))
# sayt bilan umumiy kalit (src/lib/miya-tg.ts dagi ichkiKalit bilan bir xil)
KALIT = hashlib.sha256(f"{os.environ.get('AUTH_SECRET', 'dev-auth-secret-change-me-please')}:ichki".encode()).hexdigest()

# OpenAI «pcm» — 24 kHz, 16-bit, mono; qo'ng'iroq ham shunday sozlanadi, qayta namunalash kerak emas
TEZLIK = 24000
SIFAT = AudioQuality.LOW  # (24000, 1)

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


H = Holat()


# ---------- sayt va OpenAI ----------


async def sayt(amal: str, **kw):
    async with H.http.post(f"{SAYT}/api/telefon/ichki", json={"amal": amal, **kw}, headers={"x-ichki": KALIT}) as r:
        j = await r.json(content_type=None)
        if r.status >= 400:
            raise RuntimeError(j.get("error") if isinstance(j, dict) else f"HTTP {r.status}")
        return j


async def izoh(q: str, matn: str):
    """Qo'ng'iroq tarixiga texnik qayd (saytdagi Telefon bo'limida ko'rinadi)."""
    log.info("[%s] %s", q[-6:], matn)
    try:
        await sayt("izoh", q=q, matn=matn[:300])
    except Exception:  # noqa: BLE001
        pass


def fayl_oqim(pcm: bytes) -> tuple[Stream, str]:
    """Ovozni (24 kHz mono PCM) vaqtinchalik faylga yozadi — qo'ng'iroq uni o'zi o'qiydi."""
    fd, yol = tempfile.mkstemp(prefix="miya-", suffix=".pcm")
    with os.fdopen(fd, "wb") as f:
        f.write(pcm)
    return Stream(microphone=AudioStream(MediaSource.FILE, yol, AudioParameters(TEZLIK, 1))), yol


JIMLIK = b"\0" * (TEZLIK * 2)  # 1 soniya


async def ovoz(matn: str) -> bytes:
    async with H.http.post(
        f"{OPENAI_URL}/audio/speech",
        headers={"Authorization": f"Bearer {OPENAI_KEY}"},
        json={
            "model": TTS_MODEL,
            "voice": OVOZ,
            "input": matn[:1500],
            "instructions": "O'zbek tilida, Toshkent talaffuzida gapiring. Samimiy, xotirjam va aniq — telefonda gaplashgandek.",
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
    f = FormData()
    f.add_field("file", wav(pcm, tezlik), filename="gap.wav", content_type="audio/wav")
    f.add_field("model", STT_MODEL)
    f.add_field("language", "uz")
    async with H.http.post(f"{OPENAI_URL}/audio/transcriptions", headers={"Authorization": f"Bearer {OPENAI_KEY}"}, data=f) as r:
        j = await r.json(content_type=None)
        if r.status >= 400:
            raise RuntimeError(f"STT: HTTP {r.status}")
        return str(j.get("text", "")).strip()


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
        if self.gapirdi and (hozir - self.oxirgi_ovoz > 1.2 or len(self.bufer) > self.tezlik * 2 * 40):
            self.gap_tayyor.set()

    def tingla_boshla(self):
        self.bufer = bytearray()
        self.gapirdi = False
        self.boshi = 0.0
        self.gap_tayyor.clear()

    async def gapir(self, matn: str):
        pcm = await ovoz(matn)
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

    async def ishla(self):
        try:
            await H.calls.record(self.user_id, RecordStream(audio=True, audio_parameters=SIFAT))
            await izoh(self.q, "🔧 ulandi, Miya gapirmoqda")
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
                matn = await matnga(pcm, self.tezlik)
                if not matn:
                    await izoh(self.q, f"🔧 {len(pcm) // (self.tezlik * 2)} soniyalik ovoz matnga o'girilmadi")
                    await self.gapir("Eshitolmadim, qaytadan ayting.")
                    continue
                j = await sayt("gap", q=self.q, matn=matn)
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


async def ulan(user_id: int, s: "Suhbat", chiquvchi: bool):
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


async def muddat(user_id: int, s: Suhbat):
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
        await ulan(user_id, Suhbat(user_id, j["q"], j["salom"]), chiquvchi=False)

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
    asyncio.create_task(ulan(user_id, Suhbat(user_id, b["q"], b["matn"]), chiquvchi=True))
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
