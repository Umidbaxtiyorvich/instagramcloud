"""«Qarz» kontragenti (YesPOS'dagi yetkazib beruvchi) uchun ikki sahifa:
- /qarz/<maxfiy-kalit>  — faqat ko'rish: akt sverka (sana, hujjat, summa, izoh, qoldiq), parolsiz, maxfiy havola bilan;
- /qarz-yozish          — to'lov yozish (summa, to'lov turi, sana, izoh), oddiy sayt kirishi (Telegram kodi) bilan.

Izoh YesPOS'ga ham yuboriladi, lekin oddiy to'lovda YesPOS uni saqlamasligi mumkin — shuning uchun har bir
yozilgan to'lov o'z jurnalimizda ham turadi (data/qarz_jurnal.json) va aktda shu yerdan ham olinadi.
"""
import json
import os
import secrets
from datetime import datetime, timedelta

from aiohttp import web

import analytics as an
import config
from yespos import YesPosError, api

KALIT_FAYL = os.path.join(config.DATA_DIR, "qarz_token.txt")
JURNAL_FAYL = os.path.join(config.DATA_DIR, "qarz_jurnal.json")
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
PREFIX = os.getenv("WEB_PREFIX", "").rstrip("/")

_ctx: dict = {}
_kontragent: dict | None = None


def kalit() -> str:
    try:
        with open(KALIT_FAYL, encoding="utf-8") as f:
            t = f.read().strip()
        if t:
            return t
    except FileNotFoundError:
        pass
    t = secrets.token_urlsafe(24)
    with open(KALIT_FAYL, "w", encoding="utf-8") as f:
        f.write(t)
    return t


async def kontragent() -> dict:
    """YesPOS'dagi «Qarz» yetkazib beruvchisi. QARZ_SUPPLIER_ID bilan aniq ko'rsatish ham mumkin."""
    global _kontragent
    if _kontragent:
        return _kontragent
    sid = os.getenv("QARZ_SUPPLIER_ID", "").strip()
    topilgan = await api.search_suppliers(os.getenv("QARZ_NOMI", "qarz"), 20)
    if sid:
        s = next((x for x in topilgan if str(x.get("id")) == sid), None)
        _kontragent = {"id": int(sid), "name": (s or {}).get("company_name") or "Qarz"}
    else:
        aniq = [x for x in topilgan if (x.get("company_name") or "").strip().lower() == "qarz"]
        s = (aniq or topilgan or [None])[0]
        if not s:
            raise YesPosError("YesPOS'da «Qarz» nomli yetkazib beruvchi topilmadi")
        _kontragent = {"id": int(s["id"]), "name": s.get("company_name") or "Qarz"}
    return _kontragent


def _jurnal() -> list[dict]:
    try:
        with open(JURNAL_FAYL, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return []


def _jurnalga(yozuv: dict):
    j = _jurnal()
    j.append(yozuv)
    with open(JURNAL_FAYL, "w", encoding="utf-8") as f:
        json.dump(j[-2000:], f, ensure_ascii=False)


def _davr(q) -> tuple[datetime, datetime]:
    try:
        frm = datetime.strptime(q["from"], "%Y-%m-%d").replace(tzinfo=config.TZ)
        to = datetime.strptime(q["to"], "%Y-%m-%d").replace(tzinfo=config.TZ, hour=23, minute=59, second=59)
    except (KeyError, ValueError):
        to = an.now()
        frm = datetime(2020, 1, 1, tzinfo=config.TZ)
    return frm, to


async def akt(frm: datetime, to: datetime) -> dict:
    k = await kontragent()
    a = await an.act_sverka(k["id"], frm, to)
    # izohlar: to'lovlarda — YesPOS to'lovi yoki o'z jurnalimiz; kirim hujjatlarida — hujjat izohi
    tolovlar = [p for p in await api.supplier_payments(frm - timedelta(days=1), to + timedelta(days=1), 2000)
                if p.get("supplier") == k["id"]]
    hujjatlar = {d.get("id"): d for d in await api.supplier_purchase_orders(k["id"])}
    jurnal = _jurnal()
    for r in a["rows"]:
        izoh = ""
        if r["kind"] == "pay":
            qiymat = r["debit"] or r["credit"]
            mos = [p for p in tolovlar if abs((p.get("value") or 0) - qiymat) < 0.5]
            if mos:
                p = min(mos, key=lambda p: abs((an.parse_dt(p["created_date"]) - r["date"]).total_seconds()))
                izoh = (p.get("comment") or "").strip()
            if not izoh:
                yaqin = [j for j in jurnal if abs(j["summa"] - qiymat) < 0.5
                         and abs((datetime.fromisoformat(j["vaqt"]) - r["date"]).total_seconds()) < 3 * 86400]
                if yaqin:
                    izoh = yaqin[-1]["izoh"]
        elif r.get("doc") in hujjatlar:
            d = hujjatlar[r["doc"]]
            izoh = (d.get("note") or d.get("comment") or "").strip()
        r["izoh"] = izoh
    return {"kontragent": k["name"], "from": frm, "to": to, **a}


def _html(nom: str):
    with open(os.path.join(STATIC, nom), encoding="utf-8") as f:
        html = f.read()
    if PREFIX:
        for q in ("'", '"', "`"):
            html = html.replace(q + "/api/", q + PREFIX + "/api/").replace(q + "/qarz", q + PREFIX + "/qarz")
    return web.Response(text=html, content_type="text/html", headers={"Cache-Control": "no-cache"})


def _kalit_togri(request) -> bool:
    return secrets.compare_digest(request.match_info.get("kalit", ""), kalit())


# ---------- ko'rish (parolsiz, maxfiy havola) ----------
async def korish_sahifa(request):
    if not _kalit_togri(request):
        raise web.HTTPNotFound()
    return _html("qarz.html")


async def korish_akt(request):
    if not _kalit_togri(request):
        raise web.HTTPNotFound()
    frm, to = _davr(request.query)
    return _ctx["jres"](await akt(frm, to))


# ---------- yozish (sayt kirishi bilan: /api/ ostida auth_mw tekshiradi) ----------
async def yozish_sahifa(request):
    return _html("qarz_yozish.html")


async def info(request):
    k = await kontragent()
    sayt = os.getenv("PUBLIC_URL", "").rstrip("/") or f"https://{request.host}"
    return _ctx["jres"]({"kontragent": k["name"], "korish": f"{sayt}/qarz/{kalit()}",
                         "turlar": await api.payment_types()})


async def akt_ichki(request):
    frm, to = _davr(request.query)
    return _ctx["jres"](await akt(frm, to))


def _summa(v) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        raise YesPosError("Summa noto'g'ri")
    if v <= 0:
        raise YesPosError("Summa 0 dan katta bo'lishi kerak")
    return round(v, 2)


async def tolov(request):
    b = await request.json()
    k = await kontragent()
    summa = _summa(b.get("summa"))
    tur = int(b.get("tur") or 0)
    if not tur:
        raise YesPosError("To'lov turini tanlang")
    izoh = str(b.get("izoh") or "").strip()[:300]
    sana = None
    if b.get("sana"):
        d = datetime.strptime(b["sana"], "%Y-%m-%d").date()
        if d > an.now().date():
            raise YesPosError("Kelajakdagi sana bo'lmaydi")
        if d != an.now().date():
            sana = datetime(d.year, d.month, d.day, 12, 0, tzinfo=config.TZ)
    if sana:
        await an.pay_dated(k["id"], summa, tur, sana, izoh or "Qarz sayti")
    else:
        await api.pay_to_supplier(k["id"], summa, tur, izoh)
    _jurnalga({"vaqt": (sana or an.now()).isoformat(), "summa": summa, "tur": tur, "izoh": izoh,
               "kim": (_ctx["sessiya"](request) or {}).get("device", "")})
    _ctx["drop"]("supdebts")
    await _ctx["broadcast"](_ctx["bot"], f"🧾 Qarz sayti: {k['name']} — {an.money(summa)} so'm to'lov"
                                         + (f", {sana:%d.%m.%Y}" if sana else "") + (f"\nIzoh: {izoh}" if izoh else ""))
    return _ctx["jres"]({"ok": True})


def setup(app: web.Application, **ctx):
    _ctx.update(ctx)
    kalit()
    r = app.router
    r.add_get("/qarz/{kalit}", korish_sahifa)
    r.add_get("/qarz/{kalit}/akt", korish_akt)
    r.add_get("/qarz-yozish", yozish_sahifa)
    r.add_get("/api/qarz/info", info)
    r.add_get("/api/qarz/akt", akt_ichki)
    r.add_post("/api/qarz/tolov", tolov)
