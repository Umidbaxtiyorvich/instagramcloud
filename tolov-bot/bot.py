"""
Guruhga tashlangan to'lovlarni (chek, qo'lda yozilgan daftar sahifasi, matn) CloudShop'ga kirim qiluvchi bot.

Jarayon:
  1. Guruhga rasm yoki "500 ming tashladim" kabi xabar tushadi -> inbox/<id>/ ga saqlanadi.
  2. AI (Gemini yoki Claude) o'qiydi: har bir olingan pul (sana + summa), mijoz ismi, telefon;
     CloudShop mijozlari ichidan kimligini topadi.
  3. Bot shu mijozning CloudShop'dagi to'lovlari bilan solishtiradi: qaysi yozuv allaqachon kiritilgan (☑️),
     qaysi biri oxirgi kiritilgan to'lovdan keyingi yangi yozuv (🆕).
  4. Adminga kartochka boradi: har bir yozuv uchun [➕] tugmasi, [➕ Hammasini], boshqa mijozlar, [❌ Yopish].
     Kartochkaga javob (reply): "2 1500000" - 2-qator summasini o'zgartirish; ism/telefon - mijozni qidirish.

HTTP API (X-Api-Key bilan): GET /items, GET /items/<id>/photo, POST /items/<id>/status
"""
import asyncio
import difflib
import hashlib
import hmac
import html
import json
import os
import re
import time
import traceback
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import parse_qsl

from aiogram import Bot, Dispatcher, F
from aiogram.types import (BotCommand, BufferedInputFile, CallbackQuery, FSInputFile, InlineKeyboardButton,
                           InlineKeyboardMarkup, MenuButtonWebApp, Message, WebAppInfo)
from aiohttp import ClientSession, ClientTimeout, web
from dotenv import load_dotenv

BASE = Path(__file__).parent
load_dotenv(BASE / ".env", encoding="utf-8-sig")

import ai  # noqa: E402  (kalitlar .env dan yuklangandan keyin)
import recon  # noqa: E402
import reports  # noqa: E402
from cloudshop import CloudShop, CloudShopError  # noqa: E402

DATA = Path(os.getenv("DATA_DIR") or BASE)
INBOX = DATA / "inbox"
INBOX.mkdir(parents=True, exist_ok=True)
LINKS = DATA / "links.json"  # telegram user_id -> tasdiqlangan mijoz id lari
API_KEY = os.getenv("API_KEY")
PORT = int(os.getenv("PORT", "8080"))
# Sayt orqali /tolov ostida ochilganda (instagramcloud: scripts/start.mjs) — sahifa havolalari shu prefiks bilan
PREFIX = os.getenv("WEB_PREFIX", "").rstrip("/")

TOKEN = os.getenv("BOT_TOKEN")
# Faqat shu guruh(lar)dan qabul qilish (bo'sh bo'lsa - hammasidan). Vergul bilan: -100123,-100456
ALLOWED = {int(x) for x in os.getenv("ALLOWED_CHATS", "").replace(" ", "").split(",") if x}
# Tasdiqlash xabarlari boradigan va tugma bosa oladigan odamlar (Telegram user id)
ADMINS = {int(x) for x in os.getenv("ADMIN_IDS", "").replace(" ", "").split(",") if x}

CS = CloudShop(os.getenv("CS_EMAIL", ""), os.getenv("CS_PASSWORD", ""),
               account_id=os.getenv("CS_ACCOUNT_ID") or None, company=os.getenv("CS_COMPANY_ID") or None)
AI_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
READY = bool(ADMINS and os.getenv("CS_EMAIL") and os.getenv("CS_PASSWORD") and AI_KEY)

TASHKENT = timezone(timedelta(hours=5))
MONEY_RE = re.compile(r"\d[\d\s.,]{2,}")  # kamida 3 xonali son - pul bo'lishi mumkin
DAY = 86400
PENDING = ("new", "old", "future")  # hali hal qilinmagan yozuv holatlari
# Avtomatik kiritish: mijoz ishonchi >= AUTO_CONF, yozuv aniq o'qilgan, yangi va summa <= AUTO_MAX bo'lsa
AUTO_ENTER = os.getenv("AUTO_ENTER", "1") == "1"
AUTO_CONF = int(os.getenv("AUTO_CONF", "95"))     # mijoz ishonchi kamida shuncha bo'lsin
RIVAL_CONF = int(os.getenv("RIVAL_CONF", "30"))   # ikkinchi nomzod bundan past bo'lsin
VERIFY_CONF = int(os.getenv("VERIFY_CONF", "90"))  # ikkinchi o'qishda har bir maydon ishonchi
MAX_AGE_DAYS = int(os.getenv("MAX_AGE_DAYS", "60"))  # bundan eski sana - shubhali
AUTO_MAX = int(os.getenv("AUTO_MAX", "50000000"))

# To'g'rilash jadvali (Telegram Web App) shu ochiq manzildan ochiladi
PUBLIC_URL = (os.getenv("PUBLIC_URL") or (f"https://{os.environ['RAILWAY_PUBLIC_DOMAIN']}"
                                          if os.getenv("RAILWAY_PUBLIC_DOMAIN") else "")).rstrip("/")
# Instagram Cloud saytidagi AI Ofis «Miya»: bot uni har 10 daqiqada uyg'otadi (Render bepul serveri
# uxlab qolmasin) va Miya topgan ogohlantirishlarni adminlarga yuboradi. Kalit — shu API_KEY.
MIYA_URL = (os.getenv("MIYA_URL") or "https://instagramcloud.onrender.com").rstrip("/")
MIYA_INTERVAL = int(os.getenv("MIYA_INTERVAL", "600"))
FIX_HTML = (BASE / "fix.html").read_text("utf-8") if (BASE / "fix.html").exists() else ""
APP_HTML = (BASE / "app.html").read_text("utf-8") if (BASE / "app.html").exists() else ""

dp = Dispatcher()
locks: dict[str, asyncio.Lock] = {}
BOT: Bot | None = None  # HTTP (jadval) orqali kiritilganda kartochkani yangilash uchun


# ---------- saqlash ----------

def load(item_id: str) -> dict:
    return json.loads((INBOX / item_id / "meta.json").read_text("utf-8-sig"))


def store(meta: dict):
    (INBOX / meta["id"] / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def all_items():
    for f in INBOX.glob("*/meta.json"):
        try:
            yield json.loads(f.read_text("utf-8-sig"))
        except Exception:
            pass


def links() -> dict:
    return json.loads(LINKS.read_text("utf-8")) if LINKS.exists() else {}


def add_link(user_id, client_id):
    d = links()
    ids = [client_id] + [i for i in d.get(str(user_id), []) if i != client_id]
    d[str(user_id)] = ids[:5]
    LINKS.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")


def save(m: Message, kind: str, file_uid: str | None = None) -> Path:
    item_id = f"{m.chat.id}_{m.message_id}"
    folder = INBOX / item_id
    folder.mkdir(exist_ok=True)
    u, fwd = m.from_user, m.forward_origin
    store({
        "id": item_id, "kind": kind, "chat_id": m.chat.id, "chat_title": m.chat.title,
        "message_id": m.message_id, "media_group_id": m.media_group_id, "file_uid": file_uid,
        "date": m.date.astimezone(TASHKENT).isoformat(),
        "text": m.text or m.caption or "",
        "reply_to_text": (m.reply_to_message.text or m.reply_to_message.caption) if m.reply_to_message else None,
        "user_id": u.id if u else None, "username": u.username if u else None,
        "full_name": u.full_name if u else None,
        "forwarded_from": getattr(getattr(fwd, "sender_user", None), "full_name", None)
        or getattr(fwd, "sender_user_name", None),
        "status": "pending",
    })
    return folder


# ---------- yordamchi ----------

def money(n) -> str:
    return f"{int(n):,}".replace(",", " ")


def day_fmt(ts) -> str:
    return datetime.fromtimestamp(ts, TASHKENT).strftime("%d.%m.%Y")


def msg_ts(meta) -> int:
    return int(datetime.fromisoformat(meta["date"]).timestamp())


def parse_date(raw: str) -> int | None:
    raw = (raw or "").strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            d = datetime.strptime(raw, fmt)
            if fmt == "%Y-%m-%d":
                d = d.replace(hour=12)
            return int(d.replace(tzinfo=TASHKENT).timestamp())
        except ValueError:
            pass
    return None


def make_entries(meta: dict, payments: list[dict]) -> list[dict]:
    entries = []
    for p in payments:
        if p.get("amount", 0) <= 0:
            continue
        ts = parse_date(p.get("date"))
        entries.append({"ts": ts or msg_ts(meta), "date_ok": ts is not None, "amount": int(p["amount"]),
                        "line": p.get("line", ""), "state": "new",
                        "sure": bool(p.get("sure", True)) and ts is not None, "doubt": p.get("doubt", ""),
                        "doubt_fields": list(p.get("doubt_fields") or []) + ([] if ts else ["date"])})
    # Faqat eng oxirgi yozuv kiritiladi; oldingilari - tarix. "Oxirgi" sahifadagi tartib bo'yicha
    # (daftar yuqoridan pastga yoziladi), chunki xato yozilgan sana (13.12 kabi) tartibni buzishi mumkin.
    for en in entries[:-1]:
        en["state"] = "history"
    return entries


def suggest_date(ts: int) -> int:
    """Kelajakdagi sana uchun ehtimolli to'g'ri sana: shu kun, joriy (yoki o'tgan) oy."""
    d, now = datetime.fromtimestamp(ts, TASHKENT), datetime.now(TASHKENT)
    for back in range(0, 13):
        y, mth = now.year, now.month - back
        while mth <= 0:
            y, mth = y - 1, mth + 12
        try:
            cand = d.replace(year=y, month=mth)
        except ValueError:
            continue
        if cand <= now:
            return int(cand.timestamp())
    return int(now.timestamp())


def client_sure(meta) -> bool:
    """Mijoz ishonchli: admin tasdiqlagan yoki AI yuqori ishonch bilan topgan va raqobatchi nomzod yo'q."""
    if meta.get("client_confirmed"):
        return True
    c = meta.get("candidates") or []
    if not c or meta.get("sel", 0) != 0 or meta.get("client_doubt"):
        return False
    return c[0]["confidence"] >= AUTO_CONF and (len(c) == 1 or c[1]["confidence"] < RIVAL_CONF)


def doubt(en: dict, field: str, why: str):
    en["sure"] = False
    en["doubt_fields"] = sorted(set((en.get("doubt_fields") or []) + [field]))
    en["doubt"] = "; ".join(x for x in [en.get("doubt"), why] if x)


async def strict_check(meta: dict, photo: bytes | None, clients: list[dict]):
    """Eng qattiq tekshiruv: oxirgi yozuvni ikkinchi marta mustaqil o'qib solishtirish + qo'shimcha qoidalar.
    Ozgina ham mos kelmasa - yozuv "noaniq" bo'ladi va adminga to'g'rilash jadvali bilan boradi."""
    pend = [en for en in meta.get("entries") or [] if en["state"] in PENDING]
    if not pend:
        return
    en = pend[-1]
    cand = selected(meta)
    by_id = {c["_id"]: c for c in clients}

    # 1) ikkinchi mustaqil o'qish
    try:
        v = await ai.verify(meta, photo, clients)
        meta["verify"] = v
    except Exception as e:
        doubt(en, "amount", f"ikkinchi tekshiruv bajarilmadi ({type(e).__name__})")
        return
    v_ts = parse_date(v.get("date") or "")
    if not v_ts or day_fmt(v_ts) != day_fmt(en["ts"]):
        doubt(en, "date", f"ikkinchi o'qishda sana: {day_fmt(v_ts) if v_ts else 'topilmadi'}")
    elif v.get("date_conf", 0) < VERIFY_CONF:
        doubt(en, "date", f"sana ishonchi past ({v.get('date_conf')}%)")
    if v.get("amount") != en["amount"]:
        doubt(en, "amount", f"ikkinchi o'qishda summa: {money(v.get('amount') or 0)}")
    elif v.get("amount_conf", 0) < VERIFY_CONF:
        doubt(en, "amount", f"summa ishonchi past ({v.get('amount_conf')}%)")
    if not cand or v.get("client_id") != cand["client_id"]:
        other = by_id.get(v.get("client_id"), {}).get("name", "topilmadi")
        meta["client_doubt"] = f"ikkinchi o'qishda mijoz: {other}"
    elif v.get("client_conf", 0) < VERIFY_CONF:
        meta["client_doubt"] = f"mijoz ishonchi past ({v.get('client_conf')}%)"
    if v.get("comment") and not en.get("sure", True):
        en["doubt"] = f"{en['doubt']} ({v['comment'][:120]})"

    # 2) qo'shimcha qoidalar
    if en["amount"] % 1000:
        doubt(en, "amount", "summa mingga yaxlit emas")
    if en["ts"] < msg_ts(meta) - MAX_AGE_DAYS * DAY:
        doubt(en, "date", f"sana {MAX_AGE_DAYS} kundan eski")
    phone = re.sub(r"\D", "", (meta.get("ai") or {}).get("phone") or "")
    if cand and len(phone) >= 7:
        phones = [re.sub(r"\D", "", p) for p in (by_id.get(cand["client_id"], {}).get("phones") or [])]
        if phones and not any(phone[-7:] in p for p in phones):
            meta["client_doubt"] = meta.get("client_doubt") or "rasmdagi telefon mijoznikiga mos emas"


def check_reason(en: dict) -> str | None:
    """Nega bu yozuvni odam tekshirishi kerak (None - aniq)."""
    if en["state"] == "future":
        return "sana kelajakda — oy xato yozilgan bo'lishi mumkin"
    if en["state"] == "old":
        return "CloudShop'da bundan keyingi kirim bor, lekin aynan shu summa topilmadi — kiritilganmi?"
    if not en["date_ok"]:
        return "sana o'qilmadi"
    if en.get("undone"):
        return "avval kiritilib, bekor qilingan"
    if not en.get("sure", True):
        return en.get("doubt") or "noaniq o'qildi"
    if en["amount"] > AUTO_MAX:
        return "summa juda katta"
    return None


def selected(meta) -> dict | None:
    c = meta.get("candidates") or []
    i = meta.get("sel", 0)
    return c[i] if i < len(c) else None


async def compare(meta: dict):
    """Tanlangan mijozning CloudShop to'lovlari bilan solishtirib, har bir yozuv holatini belgilash."""
    cand = selected(meta)
    meta["last_cs"] = None
    paid = []
    if cand:
        try:
            paid = [p for p in await CS.last_payments(cand["client_id"], 30) if p.get("sum")]
        except CloudShopError as e:
            meta["last_cs"] = f"xato: {e}"
    last_ts = max((p["date"] for p in paid), default=0)
    if paid:
        last = max(paid, key=lambda p: p["date"])
        meta["last_cs"] = f"{money(last['sum'])} so'm ({day_fmt(last['date'])})"
    elif cand and not meta["last_cs"]:
        meta["last_cs"] = "to'lov yo'q"
    now = datetime.now(TASHKENT).timestamp()
    for e in meta.get("entries", []):
        if e["state"] in ("done", "skipped", "history"):
            continue
        window = 3 * DAY if e["date_ok"] else 30 * DAY
        if any(p["sum"] == e["amount"] and abs(p["date"] - e["ts"]) <= window for p in paid):
            e["state"] = "exists"
        elif e["ts"] > now + DAY:
            e["state"] = "future"
        elif e["date_ok"] and e["ts"] <= last_ts:
            e["state"] = "old"
        else:
            e["state"] = "new"


def finish_if_resolved(meta):
    entries = meta.get("entries") or []
    if entries and not any(e["state"] in PENDING for e in entries):
        meta["status"] = "done" if any(e["state"] == "done" for e in entries) else "skipped"


def fix_token(item_id: str) -> str:
    """Jadval havolasi uchun imzo - begona odam boshqa kartochka manzilini taxmin qila olmasin."""
    return hmac.new((TOKEN or "").encode(), f"fix:{item_id}".encode(), hashlib.sha256).hexdigest()[:24]


def fix_url(item_id: str, k: int) -> str:
    return f"{PUBLIC_URL}/fix/{item_id}?k={k}&t={fix_token(item_id)}"


def fix_reasons(meta: dict, en: dict) -> dict:
    """Jadvalda qaysi maydon xato/noaniq ekanini ko'rsatish: {client, date, amount} -> sabab yoki None."""
    cand = selected(meta)
    why = {"client": None, "date": None, "amount": None}
    if not cand:
        why["client"] = "mijoz topilmadi"
    elif not client_sure(meta):
        cands = meta.get("candidates") or []
        rival = next((c for c in cands if c is not cand and c["confidence"] >= RIVAL_CONF), None)
        why["client"] = (meta.get("client_doubt")
                         or (f"o'xshash boshqa mijoz ham bor: {rival['name']} ({rival['confidence']}%)" if rival else None)
                         or f"ishonch past ({cand['confidence']}%, kerak: {AUTO_CONF}%)")
    fields = en.get("doubt_fields") or []
    doubt = en.get("doubt") or "noaniq o'qildi"
    if en["state"] == "future":
        why["date"] = "sana kelajakda — oy xato yozilgan bo'lishi mumkin"
    elif "date" in fields or not en.get("date_ok", True):
        why["date"] = doubt if en.get("date_ok", True) else "sana o'qilmadi"
    elif en["state"] == "old":
        why["date"] = "CloudShop'da bundan keyingi kirim bor, bu summa topilmadi"
    if "amount" in fields:
        why["amount"] = doubt
    elif en["amount"] > AUTO_MAX:
        why["amount"] = "summa juda katta"
    if not en.get("sure", True) and not fields and en["state"] != "future":
        why["date"] = why["date"] or doubt
        why["amount"] = why["amount"] or doubt
    if en.get("undone"):
        why["amount"] = why["amount"] or "avval kiritilib, bekor qilingan"
    return why


def check_init_data(init_data: str) -> int | None:
    """Telegram Web App initData imzosini tekshirib, foydalanuvchi id sini qaytaradi."""
    try:
        params = dict(parse_qsl(init_data, strict_parsing=True))
        received = params.pop("hash")
        check = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))
        secret = hmac.new(b"WebAppData", (TOKEN or "").encode(), hashlib.sha256).digest()
        calc = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calc, received) or time.time() - int(params.get("auth_date", 0)) > DAY:
            return None
        return int(json.loads(params["user"])["id"])
    except Exception:
        return None


ICONS = {"new": "🆕", "old": "⚠️", "future": "🔮", "exists": "☑️", "done": "✅", "skipped": "✖️", "history": "📜"}
HINTS = {"new": "yangi", "old": "CloudShop'da topilmadi — tekshiring", "future": "sana kelajakda — tekshiring",
         "exists": "CloudShop'da allaqachon bor — kiritilmaydi", "skipped": "o'tkazildi", "history": "tarix"}


def card(meta: dict) -> tuple[str, InlineKeyboardMarkup | None]:
    a = meta.get("ai") or {}
    e_ = lambda s: html.escape(s, quote=False)
    lines = [f"👤 Yubordi: {e_(meta.get('full_name') or '')}"
             + (f" (@{e_(meta['username'])})" if meta.get("username") else "")
             + f" · {e_(meta.get('chat_title') or '')}"]
    found = " · ".join(x for x in [a.get("payer_name"), a.get("phone"),
                                   a.get("card_last4") and "*" + a["card_last4"]] if x)
    if found:
        lines.append(f"🧾 Rasmda: {e_(found)}")
    if meta.get("text"):
        lines.append(f"✏️ «{e_(meta['text'][:150])}»")

    cand = selected(meta)
    sure_client = client_sure(meta)
    if cand:
        lines.append(f"\n🏪 Mijoz: <b>{e_(cand['name'])}</b> ({cand['confidence']}%)"
                     + ("" if sure_client else " — ❓ <b>aniq emas, tasdiqlang</b>"
                        + (f" <i>({e_(meta['client_doubt'])})</i>" if meta.get("client_doubt") else "")))
        lines.append(f"💳 CloudShop'dagi oxirgi kirim: {e_(meta.get('last_cs') or '?')}")
    else:
        lines.append("\n❓ <b>Mijoz topilmadi</b> — javob qilib mijoz nomi yoki telefonini yozing.")

    entries = meta.get("entries") or []
    history = [en for en in entries if en["state"] == "history"]
    if entries:
        lines.append("")
    if history:
        last_h = history[-1]
        lines.append(f"📜 Daftardagi oldingi {len(history)} ta yozuv — tarix, kiritilmaydi "
                     f"(oxirgisi: {day_fmt(last_h['ts'])}, {money(last_h['amount'])})")
    for k, en in enumerate(entries, 1):
        if en["state"] == "history":
            continue
        if en["state"] == "done":
            extra = f"kirim #{en['order']}" + (" · avtomatik" if en.get("auto") else "")
        else:
            extra = HINTS.get(en["state"], "")
        when = day_fmt(en["ts"]) if en["date_ok"] else "sanasiz"
        lines.append(f"{k}. {ICONS[en['state']]} {when} — <b>{money(en['amount'])}</b> <i>({e_(extra)})</i>")
    if not entries:
        lines.append("\n💬 Summa topilmadi. Javob qilib yozing: <code>1 | dd.mm.yyyy | summa</code>")
    if meta.get("dup_photo"):
        lines.append("⚠️ <b>Bu rasm avval ham yuborilgan!</b>")
    if a.get("note"):
        lines.append(f"\n🤖 {e_(a['note'][:300])}")

    pending = meta["status"] == "pending"
    # Tekshirish kerak bo'lganlar - to'g'rilash ustuni bilan
    checks = [(k, en, check_reason(en)) for k, en in enumerate(entries)
              if pending and en["state"] in PENDING and check_reason(en)]
    if checks:
        lines.append("\n❓ <b>Tekshirish kerak:</b>")
        for k, en, why in checks:
            lines.append(f"{k + 1}-qator: {e_(why)}")
        lines.append("\n👇 <b>✏️ tugmasini bosing</b> — jadvalda xato maydon qizil bo'ladi, to'g'risini yozib "
                     "«Tasdiqlash»ni bossangiz bot shu ma'lumot bilan kiritadi.\n"
                     "Yoki ustunni nusxalab, to'g'rilab, shu xabarga <u>javob qilib</u> yuboring:")
        rows = []
        for k, en, _ in checks:
            ts = suggest_date(en["ts"]) if en["state"] == "future" else en["ts"]
            rows.append(f"{k + 1} | {day_fmt(ts)} | {en['amount']}")
        lines.append("<code>" + "\n".join(rows) + "</code>")
    if pending and cand and not sure_client:
        lines.append("\n👆 Mijoz to'g'ri bo'lsa «✅ Mijoz to'g'ri» ni bosing — aniq yozuvlar o'zi kiritiladi. "
                     "Boshqa mijoz bo'lsa, javob qilib nomini yoki telefonini yozing.")

    kb = []
    if pending and PUBLIC_URL:
        # xato/noaniq yozuvlar uchun jadval: qaysi maydon xatoligi ko'rinadi, to'g'risini yozib tasdiqlanadi
        fix_rows = [k for k, en, _ in checks]
        if not sure_client:
            fix_rows += [k for k, en in enumerate(entries) if en["state"] in PENDING and k not in fix_rows]
        if not entries:
            fix_rows = [0]
        for k in fix_rows[:3]:
            kb.append([InlineKeyboardButton(text=f"✏️ {k + 1}-qatorni jadvalda to'g'rilash va kiritish",
                                            web_app=WebAppInfo(url=fix_url(meta["id"], k)))])
    if pending:
        if cand and not sure_client:
            kb.append([InlineKeyboardButton(text=f"✅ Mijoz to'g'ri: {cand['name'][:30]}",
                                            callback_data=f"cc:{meta['id']}")])
        pend = [(k, en) for k, en in enumerate(entries) if en["state"] in PENDING]
        if cand:
            for k, en in pend[:10]:
                when = datetime.fromtimestamp(en["ts"], TASHKENT).strftime("%d.%m") if en["date_ok"] else "bugun"
                kb.append([InlineKeyboardButton(text=f"➕ {k + 1}. {when} — {money(en['amount'])} {ICONS[en['state']]}",
                                                callback_data=f"e:{meta['id']}:{k}")])
        for i, c in enumerate(meta.get("candidates") or []):
            if i != meta.get("sel", 0):
                kb.append([InlineKeyboardButton(text=f"👤 {c['name'][:40]}", callback_data=f"c:{meta['id']}:{i}")])
    for k, en in enumerate(entries):
        if en["state"] == "done" and en.get("order_id"):
            kb.append([InlineKeyboardButton(text=f"↩️ Bekor qilish: {k + 1}. #{en['order']} — {money(en['amount'])}",
                                            callback_data=f"u:{meta['id']}:{k}")])
    if pending:
        kb.append([InlineKeyboardButton(text="❌ Yopish (qolganini o'tkazib yuborish)",
                                        callback_data=f"no:{meta['id']}")])
    else:
        lines.append("\n✅ <b>Yopildi</b>" + (f" ({e_(meta.get('decided_by', ''))})" if meta.get("decided_by") else ""))
    return "\n".join(lines)[:4000], InlineKeyboardMarkup(inline_keyboard=kb) if kb else None


async def show(bot: Bot, meta: dict):
    """Adminlarga kartochka yuborish yoki mavjudini yangilash."""
    text, kb = card(meta)
    if meta.get("cards"):
        for chat_id, msg_id in meta["cards"]:
            try:
                await bot.edit_message_text(text, chat_id=chat_id, message_id=msg_id, parse_mode="HTML",
                                            reply_markup=kb)
            except Exception as e:
                if "not modified" not in str(e):
                    print("edit xato:", e)
        return
    meta["cards"] = []
    photo = INBOX / meta["id"] / "photo.jpg"
    for admin in ADMINS:
        try:
            reply_to = None
            if meta["kind"] == "photo" and photo.exists():
                reply_to = (await bot.send_photo(admin, FSInputFile(photo))).message_id
            msg = await bot.send_message(admin, text, parse_mode="HTML", reply_markup=kb,
                                         reply_to_message_id=reply_to)
            meta["cards"].append([admin, msg.message_id])
        except Exception as e:
            print(f"admin {admin} ga yuborib bo'lmadi:", e)
    store(meta)


async def notify_error(bot: Bot, meta: dict, err: str):
    for admin in ADMINS:
        try:
            await bot.send_message(admin, f"⚠️ {meta.get('full_name')} ({meta.get('chat_title')}) xabarini "
                                          f"tahlil qilib bo'lmadi:\n{err[:500]}\n\nQayta urinish: /qayta")
        except Exception:
            pass


# ---------- asosiy ishlov ----------

async def process(bot: Bot, item_id: str):
    if not READY:
        return
    async with locks.setdefault(item_id, asyncio.Lock()):
        meta = load(item_id)
        if meta["status"] != "pending" or meta.get("ai"):
            return
        photo = INBOX / item_id / "photo.jpg"
        try:
            clients = await CS.clients()
            result = await ai.analyze(meta, photo.read_bytes() if photo.exists() else None, clients,
                                      links().get(str(meta.get("user_id")), []))
        except Exception as e:
            traceback.print_exc()
            await notify_error(bot, meta, f"{type(e).__name__}: {e}")
            return
        meta["ai"] = result
        meta["entries"] = make_entries(meta, result.get("payments") or [])
        # matnli xabar to'lov bo'lmasa - jim o'tkazamiz; rasmni esa baribir adminga ko'rsatamiz
        if meta["kind"] == "text" and (not result["is_payment"] or not meta["entries"]):
            meta["status"], meta["note"] = "skipped", "to'lov emas (avtomatik)"
            store(meta)
            print(f"[o'tkazildi] {item_id}: {result.get('note')}")
            return
        by_id = {c["_id"]: c for c in clients}
        meta["candidates"] = [{"client_id": c["client_id"], "name": by_id[c["client_id"]]["name"],
                               "confidence": c["confidence"]} for c in result["candidates"]]
        meta["sel"] = 0
        if meta.get("file_uid"):
            meta["dup_photo"] = any(m.get("file_uid") == meta["file_uid"] and m["id"] != item_id
                                    for m in all_items())
        await compare(meta)
        await strict_check(meta, photo.read_bytes() if photo.exists() else None, clients)
        n = await auto_enter(meta)
        store(meta)
        await show(bot, meta)
        print(f"[kartochka] {item_id}: {len(meta['entries'])} yozuv, {n} tasi avtomatik kiritildi, "
              f"mijoz: {(selected(meta) or {}).get('name')}")


async def auto_enter(meta: dict) -> int:
    """Aniq yozuvlarni (mijoz ishonchli, sana/summa aniq, CloudShop'dagi oxirgi kirimdan keyin) o'zi kiritadi."""
    if not AUTO_ENTER or not client_sure(meta) or meta.get("dup_photo"):
        finish_if_resolved(meta)  # masalan, oxirgi yozuv CloudShop'da allaqachon bor - yopamiz
        return 0
    n = 0
    for k, en in enumerate(meta.get("entries") or []):
        if en["state"] == "new" and not check_reason(en) and not en.get("undone"):
            err = await enter(meta, k, "avtomatik", auto=True)
            if err:
                en["doubt"], en["sure"] = f"avtomatik kiritishda xato: {err}", False
            else:
                n += 1
    finish_if_resolved(meta)
    return n


async def enter(meta: dict, k: int, who: str, auto: bool = False) -> str | None:
    """k-yozuvni CloudShop'ga kiritish. Xato bo'lsa matnini qaytaradi."""
    en = meta["entries"][k]
    if en["state"] not in PENDING:
        return None
    if en["ts"] > datetime.now(TASHKENT).timestamp() + DAY:
        return "sana kelajakda — to'g'rilash ustuni bilan sanani tuzating"
    cand = selected(meta)
    client = next((c for c in await CS.clients() if c["_id"] == cand["client_id"]), None) if cand else None
    if not client:
        return "Mijoz CloudShop'da topilmadi"
    comment = f"Telegram: {meta.get('full_name')}, {meta.get('chat_title')}"
    if en.get("line") or meta.get("text"):
        comment += f" — {(en.get('line') or meta.get('text'))[:100]}"
    try:
        order = await CS.create_income(
            client=client, amount=en["amount"], date_ts=en["ts"], comment=comment,
            uuid=str(uuid.uuid5(uuid.NAMESPACE_URL,
                                f"tolov-bot/{meta['id']}/{k}/{client['_id']}/{en['amount']}/{en['ts']}")))
    except CloudShopError as e:
        return str(e)
    en["state"], en["order"], en["order_id"], en["auto"] = "done", order.get("number", "?"), order.get("_id"), auto
    en.pop("undone", None)
    if not auto:
        meta["decided_by"] = who
    if meta.get("user_id"):
        add_link(meta["user_id"], client["_id"])
    return None


def is_admin(user_id) -> bool:
    return user_id in ADMINS


def find_by_card(chat_id: int, msg_id: int) -> dict | None:
    return next((m for m in all_items() if [chat_id, msg_id] in (m.get("cards") or [])), None)


# ---------- guruh xabarlari ----------

def allowed(m: Message) -> bool:
    return not ALLOWED or m.chat.id in ALLOWED


@dp.message(F.chat.type.in_({"group", "supergroup"}), F.photo)
async def on_photo(m: Message, bot: Bot):
    if not allowed(m):
        return
    folder = save(m, "photo", m.photo[-1].file_unique_id)
    await bot.download(m.photo[-1], destination=folder / "photo.jpg")
    print(f"[rasm] {m.from_user.full_name}: {m.caption or ''}")
    asyncio.create_task(process(bot, folder.name))


@dp.message(F.chat.type.in_({"group", "supergroup"}), F.document.mime_type.startswith("image/"))
async def on_image_doc(m: Message, bot: Bot):
    if not allowed(m):
        return
    folder = save(m, "photo", m.document.file_unique_id)
    await bot.download(m.document, destination=folder / "photo.jpg")
    print(f"[rasm-fayl] {m.from_user.full_name}")
    asyncio.create_task(process(bot, folder.name))


@dp.message(F.chat.type.in_({"group", "supergroup"}), F.text.startswith("/id"))
async def on_id(m: Message):
    await m.reply(f"Guruh id: {m.chat.id}")


@dp.message(F.chat.type.in_({"group", "supergroup"}), F.text)
async def on_text(m: Message, bot: Bot):
    if not allowed(m) or not MONEY_RE.search(m.text):
        return  # pulga aloqasi yo'q matnlarni o'tkazib yuboramiz
    folder = save(m, "text")
    print(f"[matn] {m.from_user.full_name}: {m.text}")
    asyncio.create_task(process(bot, folder.name))


# ---------- admin: tugmalar va javoblar ----------

async def guarded(q: CallbackQuery) -> tuple[str, list[str]] | None:
    if not is_admin(q.from_user.id):
        await q.answer("Ruxsat yo'q", show_alert=True)
        return None
    _, item_id, *rest = q.data.split(":")
    return item_id, rest


@dp.callback_query(F.data.startswith("e:"))
async def on_entry(q: CallbackQuery, bot: Bot):
    if not (g := await guarded(q)):
        return
    item_id, (k,) = g
    async with locks.setdefault(item_id, asyncio.Lock()):
        meta = load(item_id)
        err = await enter(meta, int(k), q.from_user.full_name)
        finish_if_resolved(meta)
        store(meta)
    await q.answer(f"Xato: {err}"[:190] if err else "✅ Kiritildi", show_alert=bool(err))
    await show(bot, meta)


@dp.callback_query(F.data.startswith("all:"))
async def on_all(q: CallbackQuery, bot: Bot):
    if not (g := await guarded(q)):
        return
    item_id, _ = g
    errors = []
    async with locks.setdefault(item_id, asyncio.Lock()):
        meta = load(item_id)
        for k, en in enumerate(meta["entries"]):
            if en["state"] == "new" and (err := await enter(meta, k, q.from_user.full_name)):
                errors.append(f"{k + 1}: {err}")
        finish_if_resolved(meta)
        store(meta)
    await q.answer(("Xato: " + "; ".join(errors))[:190] if errors else "✅ Hammasi kiritildi", show_alert=bool(errors))
    await show(bot, meta)


@dp.callback_query(F.data.startswith("c:"))
async def on_choose_client(q: CallbackQuery, bot: Bot):
    if not (g := await guarded(q)):
        return
    item_id, (i,) = g
    async with locks.setdefault(item_id, asyncio.Lock()):
        meta = load(item_id)
        meta["sel"], meta["client_confirmed"] = int(i), True
        await compare(meta)
        n = await auto_enter(meta)
        store(meta)
    await q.answer("Mijoz tanlandi" + (f", {n} ta yozuv kiritildi" if n else ""))
    await show(bot, meta)


@dp.callback_query(F.data.startswith("cc:"))
async def on_confirm_client(q: CallbackQuery, bot: Bot):
    if not (g := await guarded(q)):
        return
    item_id, _ = g
    async with locks.setdefault(item_id, asyncio.Lock()):
        meta = load(item_id)
        meta["client_confirmed"] = True
        await compare(meta)
        n = await auto_enter(meta)
        store(meta)
    await q.answer(f"✅ Tasdiqlandi, {n} ta aniq yozuv kiritildi")
    await show(bot, meta)


@dp.callback_query(F.data.startswith("u:"))
async def on_undo(q: CallbackQuery, bot: Bot):
    if not (g := await guarded(q)):
        return
    item_id, (k,) = g
    async with locks.setdefault(item_id, asyncio.Lock()):
        meta = load(item_id)
        en = meta["entries"][int(k)]
        if en["state"] != "done" or not en.get("order_id"):
            return await q.answer("Bu yozuv kiritilmagan")
        try:
            await CS.delete_income(en["order_id"])
        except CloudShopError as e:
            return await q.answer(f"Xato: {e}"[:190], show_alert=True)
        en.update(state="new", undone=True, order=None, order_id=None, auto=False)
        meta["status"] = "pending"
        store(meta)
    await q.answer(f"↩️ #{en.get('order') or ''} o'chirildi")
    await show(bot, meta)


@dp.callback_query(F.data.startswith("no:"))
async def on_no(q: CallbackQuery, bot: Bot):
    if not (g := await guarded(q)):
        return
    item_id, _ = g
    async with locks.setdefault(item_id, asyncio.Lock()):
        meta = load(item_id)
        for en in meta.get("entries") or []:
            if en["state"] in PENDING:
                en["state"] = "skipped"
        meta["status"] = "done" if any(e["state"] == "done" for e in meta.get("entries") or []) else "skipped"
        meta["decided_by"] = q.from_user.full_name
        store(meta)
    await q.answer("Yopildi")
    await show(bot, meta)


DATE_RE = re.compile(r"(\d{1,2})[./](\d{1,2})[./](\d{2,4})")


def parse_fix_line(line: str) -> tuple[int, int | None, int | None] | None:
    """«5 | 13.10.2026 | 116000», «5 116000 13.10.2026», «5 13.10.2026» -> (qator, sana_ts, summa)."""
    m = re.match(r"\s*(\d{1,2})(?:\s*[|;:)\-.]\s*|\s+)(.*)", line)
    if not m:
        return None
    k, rest = int(m.group(1)), m.group(2)
    ts = None
    if d := DATE_RE.search(rest):
        y = int(d.group(3)) + (2000 if len(d.group(3)) == 2 else 0)
        ts = parse_date(f"{y}-{int(d.group(2)):02d}-{int(d.group(1)):02d}")
        rest = rest[:d.start()] + " " + rest[d.end():]
    digits = re.sub(r"\D", "", rest)
    amount = int(digits) if digits else None
    if ts is None and amount is None:
        return None
    return k, ts, amount


@dp.message(F.chat.type == "private", F.reply_to_message, F.text)
async def on_admin_reply(m: Message, bot: Bot):
    """Kartochkaga javob: to'g'rilash ustuni qatorlari -> tuzatib darhol kiritadi; matn -> mijozni qidirish."""
    if not is_admin(m.from_user.id):
        return
    meta = find_by_card(m.chat.id, m.reply_to_message.message_id)
    if not meta:
        return await m.reply("Bu kartochka topilmadi. Kartochka xabariga javob qilib yozing.")
    async with locks.setdefault(meta["id"], asyncio.Lock()):
        meta = load(meta["id"])
        text = m.text.strip()
        entries = meta.setdefault("entries", [])
        fixes = [f for f in (parse_fix_line(x) for x in text.splitlines() if x.strip()) if f]
        single = re.sub(r"[\s.,]", "", text)
        report = []
        if not fixes and single.isdigit():
            # faqat summa: yozuv yo'q bo'lsa - yangisini yaratamiz (xabar sanasi bilan)
            if entries:
                return await m.reply("Qaysi qator? Masalan: <code>2 | 13.10.2026 | 1500000</code>", parse_mode="HTML")
            fixes = [(1, msg_ts(meta), int(single))]
        if fixes:
            changed = []
            for k, ts, amount in fixes:
                if k == len(entries) + 1:  # yangi qator qo'shish
                    entries.append({"ts": ts or msg_ts(meta), "date_ok": ts is not None, "amount": amount or 0,
                                    "line": "qo'lda", "state": "new"})
                if not 1 <= k <= len(entries):
                    report.append(f"{k}-qator yo'q")
                    continue
                en = entries[k - 1]
                if en["state"] == "done":
                    report.append(f"{k}-qator allaqachon kiritilgan (#{en['order']}) — avval ↩️ bekor qiling")
                    continue
                if ts:
                    en["ts"], en["date_ok"] = ts, True
                if amount:
                    en["amount"] = amount
                en.update(state="new", sure=True, doubt="")
                en.pop("undone", None)
                changed.append(k - 1)
            if changed:
                meta["status"] = "pending"
            # admin shu mijoz kartochkasida tuzatdi - mijozni ham tasdiqlagan hisoblaymiz
            if selected(meta):
                meta["client_confirmed"] = True
            await compare(meta)
            for i in changed:
                en = entries[i]
                if en["state"] == "exists":
                    report.append(f"{i + 1}-qator: CloudShop'da allaqachon bor — kiritilmadi")
                    continue
                if not selected(meta):
                    report.append(f"{i + 1}-qator saqlandi, lekin mijoz tanlanmagan")
                    continue
                err = await enter(meta, i, m.from_user.full_name)
                report.append(f"{i + 1}-qator: " + (f"xato — {err}" if err else
                              f"✅ kiritildi #{en['order']} ({day_fmt(en['ts'])}, {money(en['amount'])})"))
            await auto_enter(meta)
            finish_if_resolved(meta)
        else:
            clients = await CS.clients()
            q = text.lower()
            phone = re.sub(r"\D", "", text)
            scored = []
            for c in clients:
                name = c["name"].lower()
                s = difflib.SequenceMatcher(None, q, name).ratio() + (0.5 if q in name else 0)
                if len(phone) >= 7 and any(phone[-7:] in re.sub(r"\D", "", p) for p in c.get("phones") or []):
                    s += 1
                scored.append((s, c))
            scored = sorted(scored, key=lambda x: -x[0])[:4]
            top = [(s, c) for s, c in scored if s > 0.35]
            if not top:
                return await m.reply("Bunday mijoz topilmadi. Boshqacha yozib ko'ring yoki telefonini yozing.")
            meta["candidates"] = [{"client_id": c["_id"], "name": c["name"], "confidence": min(100, int(s * 100))}
                                  for s, c in top]
            meta.pop("client_doubt", None)
            meta["sel"] = 0
            # bitta aniq natija bo'lsa (yoki telefon mos kelsa) - tasdiqlangan
            meta["client_confirmed"] = top[0][0] >= 1 or len(top) == 1 or top[0][0] - top[1][0] > 0.3
            await compare(meta)
            n = await auto_enter(meta)
            report.append(f"Mijoz: {top[0][1]['name']}"
                          + (f" — {n} ta aniq yozuv kiritildi" if n else "")
                          + ("" if meta["client_confirmed"] else " (aniq emas — kartochkadan tanlang)"))
        store(meta)
    await m.reply("\n".join(report) or "Saqlandi")
    await show(bot, meta)


# ---------- qarzlar va akt sverka ----------

_ext_cache: dict = {"at": 0.0, "rows": []}


async def clients_ext(max_age: int = 60) -> list[dict]:
    if time.time() - _ext_cache["at"] > max_age:
        _ext_cache["rows"], _ext_cache["at"] = await CS.clients_extended(), time.time()
    return _ext_cache["rows"]


def period(start: str | None, end: str | None) -> tuple[int, int]:
    """'YYYY-MM-DD' -> kun boshi/oxiri (Toshkent). Bo'sh bo'lsa: yil boshidan bugungacha."""
    now = datetime.now(TASHKENT)
    s = datetime.strptime(start, "%Y-%m-%d") if start else datetime(now.year, 1, 1)
    e = datetime.strptime(end, "%Y-%m-%d") if end else now
    s = s.replace(hour=0, minute=0, second=0, tzinfo=TASHKENT)
    e = e.replace(hour=23, minute=59, second=59, tzinfo=TASHKENT)
    return int(s.timestamp()), int(e.timestamp())


async def build_akt(client_id: str, start: str | None, end: str | None) -> dict:
    client = next((c for c in await clients_ext() if c["_id"] == client_id), None)
    if not client:
        raise CloudShopError("Xaridor topilmadi")
    s, e = period(start, end)
    far = int(time.time()) + 400 * DAY  # yakuniy (joriy) qarz uchun keyingi harakatlar ham kerak
    docs, money_rows = await asyncio.gather(CS.client_docs(client_id, far), CS.client_money(client_id, far))
    return reports.akt(client, docs, money_rows, s, e)


def safe_name(s: str) -> str:
    return re.sub(r"[^\w\-]+", "_", s, flags=re.UNICODE).strip("_")[:40] or "xaridor"


async def send_debts(bot: Bot, chat_id: int):
    rows = reports.debts(await clients_ext(0))
    owing = [r for r in rows if r["debt"] > 0]
    top = "\n".join(f"{i}. {html.escape(r['name'])} — <b>{money(r['debt'])}</b>" for i, r in enumerate(owing[:15], 1))
    await bot.send_message(chat_id, f"💰 <b>Xaridorlar qarzi</b> ({datetime.now(TASHKENT).strftime('%d.%m.%Y %H:%M')})\n"
                                    f"Qarzdorlar: {len(owing)} ta · Jami: <b>{money(sum(r['debt'] for r in owing))} so'm</b>\n\n"
                                    f"{top}" + (f"\n… va yana {len(owing) - 15} ta — to'liq ro'yxat Excel'da" if len(owing) > 15 else ""),
                           parse_mode="HTML")
    fname = f"qarzlar_{datetime.now(TASHKENT).strftime('%Y-%m-%d')}.xlsx"
    await bot.send_document(chat_id, BufferedInputFile(reports.debts_xlsx(rows), filename=fname))


async def send_akt(bot: Bot, chat_id: int, client_id: str, start: str | None = None, end: str | None = None):
    a = await build_akt(client_id, start, end)
    lines = [f"📄 <b>Akt sverka</b>: {html.escape(a['client']['name'])}",
             f"Davr: {a['start']} — {a['end']}",
             f"Boshlang'ich qoldiq: <b>{money(a['opening'])}</b>"]
    shown = a["rows"][-15:]
    if len(a["rows"]) > len(shown):
        lines.append(f"… oldingi {len(a['rows']) - len(shown)} ta harakat Excel'da")
    for r in shown:
        sign = f"➕ {money(r['plus'])}" if r["plus"] else f"➖ {money(r['minus'])}"
        lines.append(f"{r['date']} · {html.escape(r['what'])} · {sign} → {money(r['balance'])}")
    who = "xaridor bizga" if a["closing"] >= 0 else "biz xaridorga"
    lines += ["", f"Jami yuk berildi: {money(a['total_plus'])} · Jami olindi: {money(a['total_minus'])}",
              f"<b>{a['end']} holatiga {who} {money(abs(a['closing']))} so'm qarzdor.</b>"]
    await bot.send_message(chat_id, "\n".join(lines), parse_mode="HTML")
    fname = f"akt_{safe_name(a['client']['name'])}_{datetime.now(TASHKENT).strftime('%Y-%m-%d')}.xlsx"
    await bot.send_document(chat_id, BufferedInputFile(reports.akt_xlsx(a), filename=fname))


def app_button() -> InlineKeyboardMarkup | None:
    if not PUBLIC_URL:
        return None
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
        text="📊 Hisobotlar oynasini ochish", web_app=WebAppInfo(url=f"{PUBLIC_URL}/app"))]])


@dp.message(F.chat.type == "private", F.text.startswith("/qarzlar"))
async def on_debts(m: Message, bot: Bot):
    if not is_admin(m.from_user.id):
        return
    await m.answer("⏳ Qarzlar yig'ilmoqda…")
    try:
        await send_debts(bot, m.chat.id)
    except CloudShopError as e:
        await m.answer(f"Xato: {e}")


@dp.message(F.chat.type == "private", F.text.startswith("/akt"))
async def on_akt(m: Message, bot: Bot):
    """/akt <ism yoki telefon> - akt sverka. Ism bo'lmasa - hisobotlar oynasini taklif qiladi."""
    if not is_admin(m.from_user.id):
        return
    q = m.text.partition(" ")[2].strip().lower()
    if not q:
        return await m.answer("Xaridorni yozing: <code>/akt Ism</code>\nyoki oynada tanlang:",
                              parse_mode="HTML", reply_markup=app_button())
    phone = re.sub(r"\D", "", q)
    rows = await clients_ext()
    found = [c for c in rows if q in c["name"].lower()
             or (len(phone) >= 5 and any(phone in re.sub(r"\D", "", p) for p in c.get("phones") or []))]
    if not found:
        found = sorted(rows, key=lambda c: -difflib.SequenceMatcher(None, q, c["name"].lower()).ratio())[:5]
    if len(found) == 1:
        await m.answer("⏳ Akt sverka tayyorlanmoqda…")
        return await send_akt(bot, m.chat.id, found[0]["_id"])
    kb = [[InlineKeyboardButton(text=c["name"][:60], callback_data=f"akt:{c['_id']}")] for c in found[:8]]
    await m.answer("Qaysi xaridor?", reply_markup=InlineKeyboardMarkup(inline_keyboard=kb))


@dp.callback_query(F.data.startswith("akt:"))
async def on_akt_pick(q: CallbackQuery, bot: Bot):
    if not is_admin(q.from_user.id):
        return await q.answer("Ruxsat yo'q", show_alert=True)
    await q.answer("Tayyorlanmoqda…")
    try:
        await send_akt(bot, q.message.chat.id, q.data.split(":", 1)[1])
    except CloudShopError as e:
        await bot.send_message(q.message.chat.id, f"Xato: {e}")


@dp.message(F.chat.type == "private", F.text.startswith("/hisobot"))
async def on_reports(m: Message):
    if is_admin(m.from_user.id):
        await m.answer("📊 Qarzlar va akt sverka:", reply_markup=app_button())


@dp.message(F.chat.type == "private", F.text == "/qayta")
async def on_retry(m: Message, bot: Bot):
    if not is_admin(m.from_user.id):
        return
    pending = [x["id"] for x in all_items() if x["status"] == "pending" and not x.get("ai")]
    await m.answer(f"{len(pending)} ta xabar qayta tahlil qilinmoqda...")
    for item_id in pending:
        await process(bot, item_id)


@dp.message(F.chat.type == "private")
async def on_private(m: Message):
    print(f"[private] {m.from_user.full_name} id={m.from_user.id}")
    role = "Siz adminsiz ✅" if is_admin(m.from_user.id) else "Siz admin emassiz."
    missing = [n for n, v in [("ADMIN_IDS", ADMINS), ("CS_EMAIL", os.getenv("CS_EMAIL")),
                              ("CS_PASSWORD", os.getenv("CS_PASSWORD")),
                              ("GEMINI_API_KEY yoki ANTHROPIC_API_KEY", AI_KEY)] if not v]
    await m.answer(f"Bot ishlayapti. Sizning Telegram id: <code>{m.from_user.id}</code>\n{role}"
                   + (f"\n\nSozlanmagan: {', '.join(missing)}" if missing else ""), parse_mode="HTML")


# ---------- HTTP API ----------

def item_folder(request: web.Request) -> Path:
    item_id = request.match_info["id"]
    folder = INBOX / item_id
    if "/" in item_id or "\\" in item_id or ".." in item_id or not (folder / "meta.json").exists():
        raise web.HTTPNotFound()
    return folder


async def api_dryrun(request):
    """Quruq yurish: rasmni qaytadan to'liq tekshiradi (AI + CloudShop solishtirish + qattiq tekshiruv),
    lekin hech narsa KIRITMAYDI va saqlamaydi - natijani qaytaradi xolos."""
    folder = item_folder(request)
    meta = load(folder.name)
    photo = folder / "photo.jpg"
    photo_bytes = photo.read_bytes() if photo.exists() else None
    clients = await CS.clients()
    result = await ai.analyze(meta, photo_bytes, clients, links().get(str(meta.get("user_id")), []))
    by_id = {c["_id"]: c for c in clients}
    m = {k: v for k, v in meta.items() if k not in ("entries", "candidates", "client_doubt", "client_confirmed")}
    m.update(ai=result, entries=make_entries(meta, result.get("payments") or []), sel=0,
             candidates=[{"client_id": c["client_id"], "name": by_id[c["client_id"]]["name"],
                          "confidence": c["confidence"]} for c in result["candidates"]])
    if request.query.get("ignore_cs") != "1":  # ignore_cs=1 - qattiq tekshiruvni "yangi" yozuv deb sinash
        await compare(m)
    await strict_check(m, photo_bytes, clients)
    latest = [en for en in m["entries"] if en["state"] != "history"]
    would_auto = (AUTO_ENTER and client_sure(m) and not m.get("dup_photo")
                  and any(en["state"] == "new" and not check_reason(en) for en in latest))
    return web.json_response({
        "client": selected(m), "client_sure": client_sure(m), "client_doubt": m.get("client_doubt"),
        "last_cs": m.get("last_cs"), "verify": m.get("verify"),
        "latest": [{"date": day_fmt(en["ts"]), "amount": en["amount"], "state": en["state"], "line": en.get("line"),
                    "sure": en.get("sure"), "doubt_fields": en.get("doubt_fields"), "doubt": en.get("doubt"),
                    "why": fix_reasons(m, en)} for en in latest],
        "would_auto_enter": bool(would_auto),
    })


def fix_item(request: web.Request) -> tuple[dict, int]:
    """/fix/<id>?k=..&t=.. - imzo to'g'ri bo'lsa kartochka va qator raqamini qaytaradi."""
    folder = item_folder(request)
    if not hmac.compare_digest(request.query.get("t", ""), fix_token(folder.name)):
        raise web.HTTPForbidden()
    return load(folder.name), int(request.query.get("k", "0"))


async def fix_page(request):
    meta, k = fix_item(request)
    entries = meta.get("entries") or []
    en = entries[k] if k < len(entries) else {"ts": msg_ts(meta), "date_ok": False, "amount": 0, "line": "",
                                               "state": "new", "sure": False}
    cand = selected(meta)
    why = fix_reasons(meta, en)
    if k >= len(entries):
        why["amount"] = "summa topilmadi"
    date_value = suggest_date(en["ts"]) if en["state"] == "future" else en["ts"]
    photo = INBOX / meta["id"] / "photo.jpg"
    data = {
        "k": k, "sender": meta.get("full_name") or "", "chat": meta.get("chat_title") or "",
        "line": en.get("line") or meta.get("text") or "",
        "photo": f"{PREFIX}/fix/{meta['id']}/photo?t={fix_token(meta['id'])}" if photo.exists() else None,
        "client_read": ((meta.get("ai") or {}).get("payer_name") or "") + (f" → {cand['name']}" if cand else ""),
        "client_name": cand["name"] if cand else "",
        "date_read": day_fmt(en["ts"]) if en.get("date_ok") else "o'qilmadi",
        "date_value": datetime.fromtimestamp(date_value, TASHKENT).strftime("%Y-%m-%d"),
        "amount": en["amount"], "why": why,
        "clients": [{"id": c["_id"], "name": c["name"]} for c in await CS.clients()],
    }
    # </script> ichida JSON xavfsiz turishi uchun "<" ni escape qilamiz
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    return web.Response(text=FIX_HTML.replace("__DATA__", payload), content_type="text/html")


async def fix_photo(request):
    folder = item_folder(request)
    if not hmac.compare_digest(request.query.get("t", ""), fix_token(folder.name)):
        raise web.HTTPForbidden()
    if not (folder / "photo.jpg").exists():
        raise web.HTTPNotFound()
    return web.FileResponse(folder / "photo.jpg")


async def fix_submit(request):
    meta, k = fix_item(request)
    body = await request.json()
    user_id = check_init_data(body.get("initData", ""))
    if not is_admin(user_id):
        return web.json_response({"ok": False, "message": "Ruxsat yo'q — jadvalni Telegram ichida, admin ochishi kerak"})
    try:
        ts = parse_date(body["date"])
        amount = int(body["amount"])
        client = next((c for c in await CS.clients() if c["_id"] == body["client_id"]), None)
    except (KeyError, ValueError, TypeError):
        ts = client = None
        amount = 0
    if not ts or amount <= 0 or not client:
        return web.json_response({"ok": False, "message": "Mijoz, sana va summani to'g'ri kiriting"})
    if ts > datetime.now(TASHKENT).timestamp() + DAY:
        return web.json_response({"ok": False, "message": "Sana kelajakda bo'lishi mumkin emas"})
    async with locks.setdefault(meta["id"], asyncio.Lock()):
        meta = load(meta["id"])
        entries = meta.setdefault("entries", [])
        if k >= len(entries):
            k = len(entries)
            entries.append({"ts": ts, "date_ok": True, "amount": amount, "line": "qo'lda", "state": "new"})
        en = entries[k]
        if en["state"] == "done":
            return web.json_response({"ok": False, "message": f"Bu qator allaqachon kiritilgan (#{en['order']})"})
        en.update(ts=ts, date_ok=True, amount=amount, state="new", sure=True, doubt="", doubt_fields=[])
        en.pop("undone", None)
        cands = meta.setdefault("candidates", [])
        idx = next((i for i, c in enumerate(cands) if c["client_id"] == client["_id"]), None)
        if idx is None:
            cands.insert(0, {"client_id": client["_id"], "name": client["name"], "confidence": 100})
            idx = 0
        meta["sel"], meta["client_confirmed"], meta["status"] = idx, True, "pending"
        await compare(meta)
        if en["state"] == "exists":
            finish_if_resolved(meta)
            store(meta)
            ok, message = False, f"☑️ CloudShop'da bu kirim allaqachon bor ({client['name']}, {day_fmt(ts)}, " \
                                 f"{money(amount)}) — qayta kiritilmadi"
        else:
            err = await enter(meta, k, "admin (jadval orqali)")
            finish_if_resolved(meta)
            store(meta)
            ok = err is None
            message = (f"✅ Kiritildi #{en['order']}: {client['name']}, {day_fmt(ts)}, {money(amount)} so'm"
                       if ok else f"Xato: {err}")
    if BOT:
        await show(BOT, meta)
    return web.json_response({"ok": ok, "message": message})


async def api_report(request):
    """X-Api-Key bilan: GET /report/debts  yoki  /report/akt?client=<id>&start=YYYY-MM-DD&end=YYYY-MM-DD (JSON)."""
    try:
        if request.match_info["what"] == "recon":  # sinov: inbox rasmini sverka deb solishtirish (hech narsa yozmaydi)
            client = next(c for c in await clients_ext() if c["_id"] == request.query["client"])
            photo = INBOX / request.query["item"] / "photo.jpg"
            extracted = await ai.extract_statement([photo.read_bytes()], "", client["name"])
            rid = str(uuid.uuid4())
            RECON[rid] = {"client_id": client["_id"], "client_name": client["name"], "extracted": extracted, "at": time.time()}
            return web.json_response({**await recon_result(rid), "extracted": extracted})
        if request.match_info["what"] == "debts":
            rows = reports.debts(await clients_ext())
            owing = [r for r in rows if r["debt"] > 0]
            return web.json_response({"count": len(owing), "total": sum(r["debt"] for r in owing), "top": owing[:20]})
        a = await build_akt(request.query["client"], request.query.get("start"), request.query.get("end"))
        return web.json_response(a)
    except (CloudShopError, KeyError) as e:
        return web.json_response({"error": str(e)}, status=400)


_refs_cache: dict = {"at": 0.0, "data": None}
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
MAX_SUM = 10_000_000_000  # 10 mlrd - aqlga sig'maydigan summa xato hisoblanadi


async def refs(max_age: int = 60) -> dict:
    if not _refs_cache["data"] or time.time() - _refs_cache["at"] > max_age:
        _refs_cache["data"], _refs_cache["at"] = await CS.refs(), time.time()
    return _refs_cache["data"]


def form_ts(date: str | None) -> int:
    """Formadagi sana: bugun bo'lsa - hozirgi vaqt, boshqa kun bo'lsa - o'sha kun 12:00. Kelajak - xato."""
    now = datetime.now(TASHKENT)
    if not date or date == now.strftime("%Y-%m-%d"):
        return int(now.timestamp())
    ts = parse_date(date)
    if not ts or ts > now.timestamp():
        raise ValueError("sana noto'g'ri yoki kelajakda")
    return ts


async def find_contragent(cid: str, kind: str) -> dict:
    if kind == "clients":
        c = next((x for x in await clients_ext() if x["_id"] == cid), None)
    else:
        c = next(({"_id": s["id"], "name": s["name"]} for s in (await refs())["suppliers"] if s["id"] == cid), None)
    if not c:
        raise ValueError("kontragent topilmadi")
    return {"_id": c["_id"], "name": c["name"], "type": kind}


async def manual_money(b: dict, who: int) -> str:
    kind = b.get("kind")
    if kind not in ("debit", "credit"):
        raise ValueError("kirim yoki chiqimni tanlang")
    r = await refs()
    account = next((a for a in r["accounts"] if a["id"] == b.get("account")), None)
    source = next((s for s in r["sources"] if s["id"] == int(b.get("source") or -1) and s["type"] == kind), None)
    if not account or not source:
        raise ValueError("hisob yoki toifa noto'g'ri")
    amount = int(b.get("amount") or 0)
    if not 0 < amount <= MAX_SUM:
        raise ValueError("summa noto'g'ri")
    ctype = b.get("contragent_type")
    if ctype not in ("clients", "suppliers"):
        raise ValueError("kontragentni tanlang")
    contragent = await find_contragent(b.get("contragent_id", ""), ctype)
    uid = b.get("uuid") if UUID_RE.match(str(b.get("uuid", ""))) else str(uuid.uuid4())
    order = await CS.create_money(kind=kind, account=account, source=source["id"], contragent=contragent,
                                  amount=amount, date_ts=form_ts(b.get("date")),
                                  comment=(b.get("comment") or "")[:300], uuid=uid)
    _ext_cache["at"] = 0  # qarzlar yangilansin
    word = "Kirim" if kind == "debit" else "Chiqim"
    return (f"{'💵' if kind == 'debit' else '💸'} {word} #{order.get('number', '?')}: {contragent['name']}, "
            f"{money(amount)} so'm · {source['title']} · {account['name']}")


async def manual_doc(b: dict, who: int) -> str:
    kind = b.get("kind")
    if kind not in ("sales", "purchases"):
        raise ValueError("sotish yoki qabulni tanlang")
    r = await refs()
    catalog = {p["id"]: p for p in r["catalog"]}
    items = []
    for it in b.get("items") or []:
        qty, price = float(it.get("qty") or 0), int(it.get("price") or 0)
        if it.get("id") not in catalog or not 0 < qty <= 1_000_000 or not 0 <= price <= MAX_SUM:
            raise ValueError("tovar, miqdor yoki narx noto'g'ri")
        items.append({"id": it["id"], "qty": qty, "price": price})
    if not items:
        raise ValueError("kamida bitta tovar qo'shing")
    total = sum(round(i["qty"] * i["price"]) for i in items)
    if not 0 < total <= MAX_SUM:
        raise ValueError("jami summa noto'g'ri")
    store = next((a for a in r["accounts"] if a["id"] == b.get("store")), None) \
        or next(a for a in r["accounts"] if a["default"])
    contragent = await find_contragent(b.get("contragent_id", ""), "clients" if kind == "sales" else "suppliers")
    uid = b.get("uuid") if UUID_RE.match(str(b.get("uuid", ""))) else str(uuid.uuid4())
    ts = form_ts(b.get("date"))
    doc = await CS.create_doc(kind=kind, store=store, contragent=contragent, items=items, catalog=catalog,
                              date_ts=ts, comment=(b.get("comment") or "")[:300], uuid=uid)
    word = "Sotuv (yuk berildi)" if kind == "sales" else "Tovar qabul qilindi"
    msg = f"📦 {word} №{doc.get('number', '?')}: {contragent['name']}, {len(items)} xil tovar, {money(total)} so'm"
    paid = int(b.get("paid") or 0)
    if kind == "sales" and paid > 0:  # sotuv bilan birga olingan pul - hujjatga bog'langan kirim
        pay_uid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"pay/{uid}"))
        order = await CS.create_money(kind="debit", account=store, source=100, contragent=contragent,
                                      amount=min(paid, MAX_SUM), date_ts=ts, comment=f"Sotuv №{doc.get('number')}",
                                      uuid=pay_uid, doc_id=doc.get("_id"))
        msg += f"\n💵 To'lov olindi #{order.get('number', '?')}: {money(paid)} so'm"
    _ext_cache["at"] = 0
    _refs_cache["at"] = 0  # ombor qoldig'i o'zgardi
    return msg


# ---------- xaridor sverkasini solishtirish ----------

RECON: dict[str, dict] = {}  # recon_id -> {client_id, extracted, at} (AI'ni qayta chaqirmaslik uchun)
MAX_IMAGES, MAX_IMAGE_BYTES = 15, 6 * 1024 * 1024


def decode_images(items: list) -> list[bytes]:
    import base64 as b64
    out = []
    for s in (items or [])[:MAX_IMAGES]:
        s = str(s)
        raw = b64.b64decode(s.split(",", 1)[1] if s.startswith("data:") else s, validate=False)
        if not raw or len(raw) > MAX_IMAGE_BYTES:
            raise ValueError("rasm juda katta yoki bo'sh")
        out.append(raw)
    return out


async def recon_result(rid: str) -> dict:
    st = RECON[rid]
    far = int(time.time()) + 400 * DAY
    docs, money_rows = await asyncio.gather(CS.client_docs(st["client_id"], far), CS.client_money(st["client_id"], far))
    moves = reports.movements(docs, money_rows)
    res = recon.compare(st["extracted"].get("rows") or [], moves)
    ex = st["extracted"]
    if res["summary"]:
        last = max(recon._ts(r["date"]) or 0 for r in ex.get("rows") or [])
        res["summary"]["ours_balance"] = sum(m["plus"] - m["minus"] for m in moves if m["ts"] <= last + DAY)
        res["summary"]["theirs_balance"] = ex.get("closing_balance") if ex.get("has_closing") else None
    return {"ok": True, "recon_id": rid, "client": st["client_name"], "note": ex.get("note") or "",
            "rows_read": len(ex.get("rows") or []), **res}


def same_client(record: dict, client_id: str) -> bool:
    for k in ("contragent", "to", "from"):
        if isinstance(record.get(k), dict) and record[k].get("_id") == client_id:
            return True
    return False


async def recon_fix(b: dict) -> str:
    st = RECON.get(b.get("recon_id", ""))
    if not st:
        raise ValueError("solishtirish eskirgan — qaytadan solishtiring")
    cid, action = st["client_id"], b.get("action")
    ts = form_ts(b["date"]) if b.get("date") else None
    amount = int(b.get("amount") or 0)
    if action in ("edit_money", "delete_money"):
        rec = await CS.get_money(b["id"])
        if not same_client(rec, cid):
            raise ValueError("bu yozuv boshqa xaridorniki")
        if action == "delete_money":
            await CS.delete_income(b["id"])
            return f"🗑 Kirim #{rec.get('number')} ({money(rec.get('sum', 0))}) bazadan o'chirildi"
        changes = {}
        if amount:
            if not 0 < amount <= MAX_SUM:
                raise ValueError("summa noto'g'ri")
            changes["sum"] = amount
        if ts and day_fmt(ts) != day_fmt(rec["date"]):  # sana faqat boshqa kun bo'lsa o'zgaradi
            changes["date"] = ts
        if not changes or changes.get("sum") == rec.get("sum") and "date" not in changes:
            raise ValueError("o'zgartirish yo'q — bazadagi bilan bir xil")
        new = await CS.update_money(b["id"], **changes)
        return f"✏️ Kirim #{new.get('number')} tuzatildi: {day_fmt(new['date'])}, {money(new['sum'])} so'm"
    if action == "add_money":
        if not 0 < amount <= MAX_SUM or not ts:
            raise ValueError("sana va summani kiriting")
        r = await refs()
        store = next(a for a in r["accounts"] if a["default"])
        contragent = await find_contragent(cid, "clients")
        order = await CS.create_money(kind="debit", account=store, source=100, contragent=contragent, amount=amount,
                                      date_ts=ts, comment=(b.get("comment") or "Sverka bo'yicha")[:200],
                                      uuid=str(uuid.uuid5(uuid.NAMESPACE_URL, f"recon/{b['recon_id']}/{b.get('key')}")))
        return f"➕ Kirim #{order.get('number')} qo'shildi: {day_fmt(ts)}, {money(amount)} so'm"
    raise ValueError("noma'lum amal")


async def app_page(request):
    return web.Response(text=APP_HTML, content_type="text/html")


async def app_api(request):
    """Hisobotlar oynasi API: debts | akt | send. Faqat admin (Telegram initData imzosi bilan)."""
    body = await request.json()
    user_id = check_init_data(body.get("initData", ""))
    if not is_admin(user_id):
        return web.json_response({"ok": False, "message": "Ruxsat yo'q — oynani Telegram ichida, admin ochishi kerak"})
    what = request.match_info["what"]
    try:
        if what == "debts":
            rows = reports.debts(await clients_ext())
            return web.json_response({"ok": True, "debts": [{k: r[k] for k in ("id", "name", "phones", "debt")}
                                                            for r in rows]})
        if what == "akt":
            a = await build_akt(body["client_id"], body.get("start"), body.get("end"))
            return web.json_response({"ok": True, "akt": a})
        if what == "refs":
            r = await refs()
            clients = [{"id": c["_id"], "name": c["name"], "phones": ", ".join(c.get("phones") or [])}
                       for c in await clients_ext()]
            return web.json_response({"ok": True, **r, "clients": clients})
        if what == "recon":
            client = next((c for c in await clients_ext() if c["_id"] == body.get("client_id")), None)
            if not client:
                raise ValueError("xaridorni tanlang")
            images, text = decode_images(body.get("images")), (body.get("text") or "")[:20000]
            if not images and not text.strip():
                raise ValueError("rasm yuklang yoki matn yozing")
            extracted = await ai.extract_statement(images, text, client["name"])
            rid = str(uuid.uuid4())
            RECON[rid] = {"client_id": client["_id"], "client_name": client["name"], "extracted": extracted,
                          "at": time.time()}
            for k in [k for k, v in RECON.items() if time.time() - v["at"] > 6 * 3600]:
                RECON.pop(k, None)
            return web.json_response(await recon_result(rid))
        if what == "recon_fix":
            msg = await recon_fix(body)
            _ext_cache["at"] = 0
            if BOT:
                await BOT.send_message(user_id, f"{msg}\n(sverka: {RECON[body['recon_id']]['client_name']})")
            return web.json_response({**await recon_result(body["recon_id"]), "message": msg})
        if what in ("money", "doc"):
            msg = await (manual_money if what == "money" else manual_doc)(body, user_id)
            if BOT:
                await BOT.send_message(user_id, "✅ " + msg)  # chatda ham iz qolsin
            return web.json_response({"ok": True, "message": msg})
        if what == "send":
            if body.get("kind") == "akt":
                await send_akt(BOT, user_id, body["client_id"], body.get("start"), body.get("end"))
                return web.json_response({"ok": True, "message": "Akt sverka chatga yuborildi"})
            await send_debts(BOT, user_id)
            return web.json_response({"ok": True, "message": "Qarzlar ro'yxati chatga yuborildi"})
    except (CloudShopError, KeyError, ValueError) as e:
        return web.json_response({"ok": False, "message": f"Xato: {e}"})
    raise web.HTTPNotFound()


@web.middleware
async def auth(request, handler):
    if request.path == "/":
        return web.Response(text="ok")  # hosting "tirikmi?" tekshiruvi uchun
    if request.path.startswith("/fix/") or request.path == "/app" or request.path.startswith("/app/"):
        return await handler(request)  # imzo (t=) / Telegram initData bilan himoyalangan
    if not API_KEY or request.headers.get("X-Api-Key") != API_KEY:
        raise web.HTTPUnauthorized()
    return await handler(request)


async def api_list(request):
    status = request.query.get("status")
    items = [m | {"has_photo": (INBOX / m["id"] / "photo.jpg").exists()}
             for m in all_items() if not status or m["status"] == status]
    return web.json_response(sorted(items, key=lambda m: m["date"]))


async def api_photo(request):
    photo = item_folder(request) / "photo.jpg"
    if not photo.exists():
        raise web.HTTPNotFound()
    return web.FileResponse(photo)


async def api_status(request):
    folder = item_folder(request)
    body = await request.json()
    meta = load(folder.name)
    meta["status"], meta["note"] = body["status"], body.get("note", "")
    store(meta)
    return web.json_response(meta)


async def start_api():
    app = web.Application(middlewares=[auth], client_max_size=40 * 1024 * 1024)  # sverka rasmlari uchun
    app.router.add_get("/", lambda r: web.Response(text="ok"))
    app.router.add_get("/items", api_list)
    app.router.add_get("/items/{id}/photo", api_photo)
    app.router.add_post("/items/{id}/status", api_status)
    app.router.add_post("/items/{id}/dryrun", api_dryrun)
    app.router.add_get("/report/{what}", api_report)
    app.router.add_get("/app", app_page)
    app.router.add_post("/app/api/{what}", app_api)
    app.router.add_get("/fix/{id}", fix_page)
    app.router.add_post("/fix/{id}", fix_submit)
    app.router.add_get("/fix/{id}/photo", fix_photo)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    print(f"API: port {PORT}")


async def prune_loop():
    """Eski cheklarning rasmlarini o'chiradi (yozuvi qoladi) — bepul bazadagi joy to'lib qolmasin."""
    keep_days = int(os.getenv("PHOTO_KEEP_DAYS", "60"))
    while True:
        cutoff = datetime.now(TASHKENT) - timedelta(days=keep_days)
        removed = 0
        for m in list(all_items()):
            photo = INBOX / m["id"] / "photo.jpg"
            try:
                if photo.exists() and datetime.fromisoformat(m["date"]) < cutoff:
                    photo.unlink()
                    removed += 1
            except Exception as e:
                print("rasm o'chirilmadi:", m.get("id"), e)
        if removed:
            print(f"{removed} ta eski rasm o'chirildi ({keep_days} kundan eski)")
        await asyncio.sleep(DAY)


async def miya_loop(bot: Bot):
    if not (API_KEY and MIYA_URL):
        return
    await asyncio.sleep(30)
    while True:
        try:
            async with ClientSession(timeout=ClientTimeout(total=600)) as s:
                async with s.get(f"{MIYA_URL}/api/miya/tick", headers={"X-Api-Key": API_KEY}) as r:
                    data = await r.json(content_type=None) if r.status == 200 else {}
                    if r.status != 200:
                        print(f"miya tick: HTTP {r.status}")
            for matn in (data.get("xabarlar") or [])[:20]:
                for admin in ADMINS:
                    try:
                        await bot.send_message(admin, str(matn)[:4000])
                    except Exception as e:
                        print("miya xabari yuborilmadi:", e)
        except Exception as e:
            print("miya tick xato:", repr(e))
        await asyncio.sleep(MIYA_INTERVAL)


async def main():
    if not TOKEN:
        raise SystemExit("BOT_TOKEN berilmagan")
    global BOT
    bot = BOT = Bot(TOKEN)
    me = await bot.get_me()
    print(f"@{me.username} ishga tushdi. Xabarlar: {INBOX}. Avtomat rejim: {'HA' if READY else 'YOQ (sozlamalar yetishmaydi)'}")
    await start_api()
    # adminlar chatida: buyruqlar ro'yxati va pastdagi "📊 Hisobotlar" menyu tugmasi
    try:
        await bot.set_my_commands([BotCommand(command="qarzlar", description="Hamma xaridorlar qarzi (Excel)"),
                                   BotCommand(command="akt", description="Akt sverka: /akt ism"),
                                   BotCommand(command="hisobot", description="Hisobotlar oynasi"),
                                   BotCommand(command="qayta", description="Tahlil qilinmaganlarni qayta")])
        if PUBLIC_URL:
            for admin in ADMINS:
                await bot.set_chat_menu_button(chat_id=admin, menu_button=MenuButtonWebApp(
                    text="📊 Hisobotlar", web_app=WebAppInfo(url=f"{PUBLIC_URL}/app")))
    except Exception as e:
        print("menyu sozlab bo'lmadi:", e)
    if READY:
        try:
            await CS.login()
            print(f"CloudShop: kirildi, {len(await CS.clients())} ta mijoz")
        except Exception as e:
            print("CloudShop login xato:", e)
        # oxirgi 2 kunda tahlil qilinmay qolgan yoki adminga hali ko'rsatilmagan rasmlar
        cutoff = datetime.now(TASHKENT) - timedelta(days=2)
        for m in all_items():
            if datetime.fromisoformat(m["date"]) < cutoff or m.get("decided_by"):
                continue
            stale_photo = m["kind"] == "photo" and not m.get("cards") and (m.get("ai") or m["status"] != "pending")
            # eski formatdagi (yozuvlarda "sure" yo'q) hal qilinmagan kartochkalar - yangi qoida bilan qayta;
            # kartochka o'sha xabarning o'zida yangilanadi
            old_format = bool(m.get("entries")) and "sure" not in m["entries"][0]
            if stale_photo or old_format or (m["status"] == "pending" and not m.get("ai")):
                m.pop("ai", None)
                m["status"] = "pending"
                store(m)
                asyncio.create_task(process(bot, m["id"]))
            elif m["status"] == "pending" and m.get("cards"):
                asyncio.create_task(show(bot, m))  # ochiq kartochkalarni yangi tugmalar bilan yangilash
    asyncio.create_task(miya_loop(bot))
    asyncio.create_task(prune_loop())
    await dp.start_polling(bot, allowed_updates=["message", "callback_query"])


if __name__ == "__main__":
    asyncio.run(main())
