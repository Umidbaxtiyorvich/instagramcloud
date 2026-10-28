"""Veb-sayt: bot bilan bitta jarayonda ishlaydi. Kirish — Telegram'ga yuborilgan bir martalik kod orqali."""
import hashlib
import json
import logging
import os
import secrets
import time
from datetime import datetime

from aiohttp import web

import analytics as an
import config
import excel
import exports
from analytics import money, now
from yespos import YesPosError, api

log = logging.getLogger("web")
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
COOKIE = "yp_session"
COOKIE_AGE = 400 * 86400                # brauzerlar ruxsat beradigan eng uzoq muddat; har kirishda yangilanadi
SESSIONS_FILE = os.path.join(config.DATA_DIR, "web_sessions.json")

_codes: dict[str, float] = {}           # kod -> amal qilish muddati
_fails: list[float] = []                # noto'g'ri urinishlar vaqti
_ctx: dict = {}                         # bot, cached, period, broadcast


# ---------- qurilmalar (sessiyalar) — diskda saqlanadi, muddatsiz ----------
def _load_sessions() -> dict:
    try:
        with open(SESSIONS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


_sessions: dict[str, dict] = _load_sessions()   # sha256(token) -> {id, device, ip, created, last_seen}


def _save_sessions():
    tmp = SESSIONS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(_sessions, f, ensure_ascii=False)
    os.replace(tmp, SESSIONS_FILE)


def _hash(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


def _session(request):
    tok = request.cookies.get(COOKIE)
    return _sessions.get(_hash(tok)) if tok else None


def device_name(ua: str) -> str:
    ua = ua or ""
    browser = next((n for k, n in [("YaBrowser", "Yandex"), ("Edg", "Edge"), ("OPR", "Opera"), ("Firefox", "Firefox"),
                                   ("Chrome", "Chrome"), ("Safari", "Safari")] if k in ua), "Brauzer")
    osn = next((n for k, n in [("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"), ("Windows", "Windows"),
                               ("Mac OS", "Mac"), ("Linux", "Linux")] if k in ua), "")
    if "Claude/" in ua:
        browser = "Claude ilovasi"
    return f"{browser} · {osn}" if osn else browser


def client_ip(request) -> str:
    return (request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or request.remote or "?")


def list_sessions() -> list[dict]:
    return sorted(_sessions.values(), key=lambda x: x.get("last_seen", ""), reverse=True)


def revoke(sid: str) -> dict | None:
    for h, v in list(_sessions.items()):
        if v["id"] == sid:
            del _sessions[h]
            _save_sessions()
            return v
    return None


def _dump(o):
    if isinstance(o, datetime):
        return o.isoformat()
    raise TypeError


def jres(data, status=200):
    return web.json_response(data, status=status, dumps=lambda d: json.dumps(d, default=_dump, ensure_ascii=False))


@web.middleware
async def auth_mw(request: web.Request, handler):
    path = request.path
    if path.startswith("/api/") and not path.startswith("/api/auth/"):
        sess = _session(request)
        if not sess:
            return jres({"error": "auth"}, 401)
        if sess.get("_seen_ts", 0) < time.time() - 600:   # oxirgi faollik — 10 daqiqada bir yoziladi
            sess["last_seen"] = now().isoformat(timespec="seconds")
            sess["ip"] = client_ip(request)
            sess["_seen_ts"] = time.time()
            _save_sessions()
    try:
        return await handler(request)
    except YesPosError as e:
        return jres({"error": str(e)}, 400)
    except web.HTTPException:
        raise
    except Exception as e:
        log.exception("Web xato")
        return jres({"error": f"Kutilmagan xato: {e}"}, 500)


# ---------- auth ----------
async def send_code(request):
    if len(_codes) > 20:
        _codes.clear()
    code = f"{secrets.randbelow(1000000):06d}"
    _codes[code] = time.time() + 300
    # sayt boshqa sayt ichida bo'lsa (PUBLIC_URL=https://.../yespos) — request.host ichki manzil bo'ladi
    sayt = os.getenv("PUBLIC_URL", "").rstrip("/") or f"https://{request.host}"
    link = f"{sayt}/?code={code}"
    sent = await _ctx["broadcast"](_ctx["bot"], f"🔐 Saytga kirish kodi: <code>{code}</code>\n"
                                                f"Yoki shu havolani bosing: {link}\n\n5 daqiqa amal qiladi. "
                                                f"Agar siz so'ramagan bo'lsangiz, e'tibor bermang.")
    if not sent:
        return jres({"error": "Kod yuborilmadi. Avval Telegramda botga /start bosing."}, 400)
    return jres({"ok": True, "sent": sent})


async def login(request):
    now_t = time.time()
    _fails[:] = [t for t in _fails if t > now_t - 600]
    if len(_fails) >= 10:
        return jres({"error": "Juda ko'p noto'g'ri urinish. 10 daqiqadan so'ng qayta urining."}, 429)
    body = await request.json()
    code = str(body.get("code", "")).strip()
    if _codes.get(code, 0) < now_t:
        _fails.append(now_t)
        return jres({"error": "Kod noto'g'ri yoki muddati o'tgan"}, 400)
    _codes.pop(code, None)
    tok = secrets.token_urlsafe(32)
    stamp = now().isoformat(timespec="seconds")
    sess = {"id": secrets.token_hex(4), "device": device_name(request.headers.get("User-Agent", "")),
            "ip": client_ip(request), "created": stamp, "last_seen": stamp}
    _sessions[_hash(tok)] = sess
    _save_sessions()
    notify = _ctx.get("notify_login")
    if notify:
        await notify(sess)
    resp = jres({"ok": True})
    _set_cookie(resp, tok)
    return resp


def _set_cookie(resp, tok):
    resp.set_cookie(COOKIE, tok, max_age=COOKIE_AGE, httponly=True,
                    secure=bool(os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RENDER")), samesite="Lax")


async def logout(request):
    if _sessions.pop(_hash(request.cookies.get(COOKIE, "")), None):
        _save_sessions()
    resp = jres({"ok": True})
    resp.del_cookie(COOKIE)
    return resp


async def me(request):
    sess = _session(request)
    resp = jres({"auth": bool(sess), "org": os.getenv("ORG_NAME", ""), "device": sess and sess["device"]})
    if sess:  # cookie muddatini har safar yangilaymiz — qurilma qayta kod so'ramaydi
        _set_cookie(resp, request.cookies[COOKIE])
    return resp


# ---------- o'qish ----------
async def sales(request):
    frm, to, title = _ctx["period"](request.query.get("period", "today"))
    s, pt = await an.sales_summary(frm, to)
    return jres({"title": title, "from": frm, "to": to, "summary": s, "payment_types": pt or []})


async def charts(request):
    import asyncio
    frm, to, title = _ctx["period"](request.query.get("period", "month"))
    if (to - frm).days < 6:  # qisqa davr uchun ham trend ko'rinsin
        from datetime import timedelta
        frm = an.day_start(to) - timedelta(days=13)
    daily, wd, hr = await asyncio.gather(api.sales_chart(frm, to), api.payments_by_day(frm, to),
                                         api.payments_by_hour(frm, to))
    for d in daily:
        d["date"] = an.parse_dt(d.pop("created_date", "")).date().isoformat()
    return jres({"from": frm, "to": to, "daily": daily, "weekday": wd, "hour": hr})


async def overview(request):
    """Bosh sahifa uchun qisqa ko'rsatkichlar."""
    import asyncio
    c = _ctx["cached"]
    clients, sup, neg = await asyncio.gather(c("clients", an.client_debts), c("supdebts", an.supplier_debts),
                                             c("neg", an.negative_stock))
    th = config.DEBT_DAYS
    aging = []
    edges = [0] + th
    for i, lo in enumerate(edges):
        hi = edges[i + 1] if i + 1 < len(edges) else None
        grp = [r for r in clients if r["days"] >= lo and (hi is None or r["days"] < hi)]
        aging.append({"label": f"{lo}-{hi - 1} kun" if hi else f"{lo}+ kun", "count": len(grp),
                      "sum": sum(r["ending_balance"] for r in grp)})
    owe = [r for r in sup if r["debt"] > 0]
    return jres({
        "client_debt": sum(r["ending_balance"] for r in clients), "client_count": len(clients),
        "client_late": len([r for r in clients if r["days"] >= th[0]]), "aging": aging,
        "supplier_debt": sum(r["debt"] for r in owe), "supplier_count": len(owe),
        "supplier_top": [{"name": r["name"], "debt": r["debt"]} for r in owe[:10]],
        "neg_count": len(neg), "neg_value": sum(-(i.get("stock") or 0) * (i.get("cost") or 0) for i in neg),
    })


async def top(request):
    return jres(await an.top_items(30, 50))


async def client_debts(request):
    rows = await _ctx["cached"]("clients", an.client_debts)
    return jres({"rows": rows, "thresholds": config.DEBT_DAYS})


async def goods(request):
    kind = request.match_info["kind"]
    c = _ctx["cached"]
    if kind == "neg":
        return jres(await c("neg", an.negative_stock))
    if kind == "unsold":
        return jres({"days": config.UNSOLD_DAYS, "rows": await c("unsold", an.unsold_items)})
    by_qty, by_rev = await c("slow", an.slow_items)
    return jres({"days": config.SLOW_DAYS, "rows": by_qty if kind == "slowqty" else by_rev})


async def supplier_debts(request):
    return jres(await _ctx["cached"]("supdebts", an.supplier_debts))


async def supplier_payments(request):
    from datetime import timedelta
    pays = await api.supplier_payments(now() - timedelta(days=30), now(), 100)
    for p in pays:
        p["created_date"] = an.parse_dt(p.get("created_date"))
    return jres(pays)


async def doc(request):
    return jres(await an.purchase_doc(int(request.query["id"])))


async def pay_info(request):
    when = an.parse_dt(request.query["date"])
    p = await an.find_payment(int(request.query["supplier"]), when, float(request.query["value"]))
    return jres(p or {})


def _pay_date(s: str | None):
    """'YYYY-MM-DD' -> shu kun + hozirgi soat. Bugun yoki bo'sh bo'lsa None (oddiy to'lov)."""
    if not s:
        return None
    d = datetime.strptime(s, "%Y-%m-%d").date()
    t = now()
    if d == t.date():
        return None
    if d > t.date():
        raise YesPosError("Kelajakdagi sana bilan to'lov qilib bo'lmaydi")
    return t.replace(year=d.year, month=d.month, day=d.day)


async def pay_plan(request):
    q = request.query
    when = _pay_date(q.get("date"))
    if not when:
        return jres({"dated": False})
    plan, left = await an.plan_dated_payment(int(q["supplier"]), _num(q.get("amount"), "Summa"), when)
    return jres({"dated": True, "left": left, "plan": [{"doc": d, "sum": s, "date": dt} for d, s, dt in plan]})


async def suppliers(request):
    return jres(await api.search_suppliers(request.query.get("q", "").strip(), 15))


async def items(request):
    q = request.query.get("q", "").strip()
    return jres((await api.search_items(q))[:20] if q else [])


async def payment_types(request):
    return jres(await api.payment_types())


def _parse_range(q):
    if q.get("period"):
        frm, to, _ = _ctx["period"](q["period"])
        return frm, to
    frm = datetime.strptime(q["from"], "%Y-%m-%d").replace(tzinfo=config.TZ)
    to = datetime.strptime(q["to"], "%Y-%m-%d").replace(tzinfo=config.TZ, hour=23, minute=59, second=59)
    return frm, to


async def act(request):
    sid = int(request.query["supplier"])
    frm, to = _parse_range(request.query)
    a = await an.act_sverka(sid, frm, to)
    return jres({"from": frm, "to": to, **a})


async def act_xlsx(request):
    sid = int(request.query["supplier"])
    name = request.query.get("name", str(sid))
    frm, to = _parse_range(request.query)
    a = await an.act_sverka(sid, frm, to)
    data = excel.act_sverka(os.getenv("ORG_NAME", "Bizning do'kon"), name, frm, to, a)
    safe = "".join(ch for ch in name if ch.isalnum() or ch in " _-")[:40] or "supplier"
    return _xlsx(data, f"Akt_sverka_{safe}_{to:%Y-%m-%d}.xlsx")


async def export(request):
    res = await exports.build(request.match_info["key"], _ctx["cached"])
    if not res:
        raise web.HTTPNotFound()
    return _xlsx(*res)


def _xlsx(data: bytes, filename: str):
    from urllib.parse import quote
    return web.Response(body=data, headers={
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
    })


# ---------- yozish (YesPOS'ga) ----------
def _num(v, name):
    try:
        v = float(v)
    except (TypeError, ValueError):
        raise YesPosError(f"{name} noto'g'ri")
    if v <= 0:
        raise YesPosError(f"{name} 0 dan katta bo'lishi kerak")
    return v


async def pay(request):
    b = await request.json()
    amount = _num(b.get("amount"), "Summa")
    when = _pay_date(b.get("date"))
    if when:
        plan = await an.pay_dated(int(b["supplier"]), amount, int(b["payment_type"]), when, "Sayt orqali")
        extra = f", sana {when:%d.%m.%Y}, hujjatlar: " + ", ".join(f"№{d}" for d, _, _ in plan)
    else:
        await api.pay_to_supplier(int(b["supplier"]), amount, int(b["payment_type"]))
        extra = ""
    _ctx["drop"]("supdebts")
    await _ctx["broadcast"](_ctx["bot"], f"🌐 Sayt orqali to'lov: {b.get('supplier_name', '')} — "
                                         f"{money(amount)} so'm ({b.get('payment_type_name', '')}){extra}")
    return jres({"ok": True})


async def purchase(request):
    b = await request.json()
    rows = [{"item": int(i["item"]), "name": i.get("name", ""), "qty": _num(i["qty"], "Miqdor"),
             "cost": float(i.get("cost") or 0), "price": float(i.get("price") or 0),
             "unit_type": i.get("unit_type")} for i in b.get("items", [])]
    if not rows:
        raise YesPosError("Tovar qo'shilmagan")
    when = None
    if b.get("date"):
        d = datetime.strptime(b["date"], "%Y-%m-%d").date()
        if d != now().date():
            when = now().replace(year=d.year, month=d.month, day=d.day)
    doc_id = await api.create_purchase(int(b["supplier"]), rows, note=b.get("note") or "Sayt orqali", when=when)
    _ctx["drop"]("supdebts", "neg")
    total = sum(r["qty"] * r["cost"] for r in rows)
    await _ctx["broadcast"](_ctx["bot"], f"🌐 Sayt orqali tovar kirim №{doc_id or '?'}: {b.get('supplier_name', '')}, "
                                         f"{len(rows)} xil tovar, {money(total)} so'm")
    return jres({"ok": True, "id": doc_id})


async def writeoff(request):
    b = await request.json()
    rows = [{"item": int(i["item"]), "qty": _num(i["qty"], "Miqdor")} for i in b.get("items", [])]
    if not rows:
        raise YesPosError("Tovar qo'shilmagan")
    t = 9 if int(b.get("type", 8)) == 9 else 8
    doc_id = await api.create_write_off(rows, t, note=b.get("note") or "Sayt orqali")
    _ctx["drop"]("neg")
    await _ctx["broadcast"](_ctx["bot"], f"🌐 Sayt orqali tovar chiqim №{doc_id or '?'} "
                                         f"({'buzilgan' if t == 9 else 'yoqotish'}), {len(rows)} xil tovar")
    return jres({"ok": True, "id": doc_id})


# Sayt boshqa sayt ichida (masalan /yespos) ishlasa — sahifadagi /api manzillariga shu prefiks qo'shiladi
PREFIX = os.getenv("WEB_PREFIX", "").rstrip("/")


async def index(request):
    if not PREFIX:
        return web.FileResponse(os.path.join(STATIC, "index.html"), headers={"Cache-Control": "no-cache"})
    with open(os.path.join(STATIC, "index.html"), encoding="utf-8") as f:
        html = f.read()
    for q in ("'", '"', "`"):
        html = html.replace(q + "/api/", q + PREFIX + "/api/")
    return web.Response(text=html, content_type="text/html", headers={"Cache-Control": "no-cache"})


def create_app() -> web.Application:
    app = web.Application(middlewares=[auth_mw])
    r = app.router
    r.add_get("/", index)
    r.add_post("/api/auth/code", send_code)
    r.add_post("/api/auth/login", login)
    r.add_post("/api/auth/logout", logout)
    r.add_get("/api/auth/me", me)
    r.add_get("/api/sales", sales)
    r.add_get("/api/top", top)
    r.add_get("/api/charts", charts)
    r.add_get("/api/overview", overview)
    r.add_get("/api/client-debts", client_debts)
    r.add_get("/api/goods/{kind:neg|unsold|slowqty|slowrev}", goods)
    r.add_get("/api/supplier-debts", supplier_debts)
    r.add_get("/api/supplier-payments", supplier_payments)
    r.add_get("/api/suppliers", suppliers)
    r.add_get("/api/items", items)
    r.add_get("/api/payment-types", payment_types)
    r.add_get("/api/act", act)
    r.add_get("/api/act.xlsx", act_xlsx)
    r.add_get("/api/doc", doc)
    r.add_get("/api/pay-info", pay_info)
    r.add_get("/api/pay-plan", pay_plan)
    r.add_get("/api/export/{key}.xlsx", export)
    r.add_post("/api/pay", pay)
    r.add_post("/api/purchase", purchase)
    r.add_post("/api/writeoff", writeoff)
    return app


async def start(bot, cached, period, broadcast, drop, notify_login=None):
    _ctx.update(bot=bot, cached=cached, period=period, broadcast=broadcast, drop=drop, notify_login=notify_login)
    app = create_app()
    import mcp_server
    mcp_server.setup(app, bot=bot, cached=cached, period=period, broadcast=broadcast, drop=drop)
    runner = web.AppRunner(app)
    await runner.setup()
    port = int(os.getenv("PORT", "8080"))
    await web.TCPSite(runner, "0.0.0.0", port).start()
    log.info("Sayt ishga tushdi: port %s", port)
