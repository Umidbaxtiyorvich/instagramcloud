"""AI Ofis uchun MCP server (Streamable HTTP, JSON javoblar).

AI Ofis «Ulanishlar» bo'limida qo'shiladi: URL — https://<sayt>/mcp, API token — botdagi «🔌 AI ofis ulanishi».
Faqat o'qish vositalari readOnlyHint bilan belgilangan; yozish vositalari AI Ofisda «Yozishga ruxsat»
berilgandagina ishlaydi va har biri Telegram'ga xabar qilinadi.
"""
import hmac
import json
import logging
import os
import secrets
from datetime import datetime, timedelta

from aiohttp import web

import analytics as an
import config
from analytics import money, now, qty
from yespos import YesPosError, api

log = logging.getLogger("mcp")
TOKEN_FILE = os.path.join(config.DATA_DIR, "mcp_token.txt")
PROTOCOL = "2025-06-18"
_ctx: dict = {}


def get_token(rotate: bool = False) -> str:
    if not rotate:
        try:
            with open(TOKEN_FILE, encoding="utf-8") as f:
                t = f.read().strip()
            if t:
                return t
        except FileNotFoundError:
            pass
    t = "ypmcp_" + secrets.token_urlsafe(32)
    with open(TOKEN_FILE, "w", encoding="utf-8") as f:
        f.write(t)
    return t


# ---------- yordamchilar ----------
def _period(name: str | None):
    return _ctx["period"](name or "today")


def _range(args):
    if args.get("dan") and args.get("gacha"):
        frm = datetime.strptime(args["dan"], "%Y-%m-%d").replace(tzinfo=config.TZ)
        to = datetime.strptime(args["gacha"], "%Y-%m-%d").replace(tzinfo=config.TZ, hour=23, minute=59, second=59)
        return frm, to
    frm, to, _ = _period(args.get("davr") or "month")
    return frm, to


def _date(s: str | None):
    if not s:
        return None
    d = datetime.strptime(s, "%Y-%m-%d").date()
    t = now()
    if d > t.date():
        raise YesPosError("Kelajakdagi sana bo'lmaydi")
    return None if d == t.date() else t.replace(year=d.year, month=d.month, day=d.day)


async def _supplier(args) -> tuple[int, str]:
    if args.get("yetkazib_beruvchi_id"):
        sid = int(args["yetkazib_beruvchi_id"])
        return sid, args.get("yetkazib_beruvchi") or str(sid)
    name = (args.get("yetkazib_beruvchi") or "").strip()
    if not name:
        raise YesPosError("yetkazib_beruvchi (nomi) yoki yetkazib_beruvchi_id kerak")
    found = await api.search_suppliers(name, 10)
    if not found:
        raise YesPosError(f"«{name}» nomli yetkazib beruvchi topilmadi")
    exact = [s for s in found if s["company_name"].strip().lower() == name.lower()]
    if len(found) > 1 and not exact:
        raise YesPosError("Bir nechta yetkazib beruvchi topildi, aniqrog'ini tanlang (yetkazib_beruvchi_id bilan): " +
                          "; ".join(f"{s['id']} — {s['company_name']}" for s in found))
    s = (exact or found)[0]
    return s["id"], s["company_name"]


async def _notify(text: str):
    try:
        await _ctx["broadcast"](_ctx["bot"], "🤖 AI ofis orqali: " + text)
    except Exception:
        log.exception("Telegram xabari yuborilmadi")


# ---------- vositalar ----------
async def t_umumiy(a):
    c = _ctx["cached"]
    today_s, _ = await an.sales_summary(*_period("today")[:2])
    month_s, _ = await an.sales_summary(*_period("month")[:2])
    clients = await c("clients", an.client_debts)
    sup = await c("supdebts", an.supplier_debts)
    neg = await c("neg", an.negative_stock)
    late = [r for r in clients if r["days"] >= config.DEBT_DAYS[0]]
    owe = [r for r in sup if r["debt"] > 0]
    return "\n".join([
        f"YesPOS umumiy holat ({now():%d.%m.%Y %H:%M}):",
        f"- Bugun: tushum {money(today_s.get('income'))}, foyda {money(today_s.get('profit'))}, cheklar {today_s.get('receipts', 0)}",
        f"- Shu oy: tushum {money(month_s.get('income'))}, foyda {money(month_s.get('profit'))}, cheklar {month_s.get('receipts', 0)}",
        f"- Mijozlar qarzi: {money(sum(r['ending_balance'] for r in clients))} ({len(clients)} ta), "
        f"{config.DEBT_DAYS[0]}+ kun cho'zilgan: {len(late)} ta",
        f"- Ta'minotchilarga qarzimiz: {money(sum(r['debt'] for r in owe))} ({len(owe)} ta)",
        f"- Minus qoldiqli tovarlar: {len(neg)} ta",
    ])


async def t_ogohlantirish(a):
    """AI ofis «Miya» uchun: muammolar va daraja (info / ogoh / xavf) JSON ko'rinishida."""
    c = _ctx["cached"]
    neg = await c("neg", an.negative_stock)
    clients = await c("clients", an.client_debts)
    frm, to, _ = _period("yesterday")
    kecha, _ = await an.sales_summary(frm, to)
    daraja, qismlar = "info", []
    if neg:
        daraja = "xavf"
        qismlar.append(f"🔴 Minus qoldiq: {len(neg)} ta tovar\n" + "\n".join(
            f"• {i['name']}: {qty(i['stock'])}" for i in neg[:10]) + (f"\n… va yana {len(neg) - 10} ta" if len(neg) > 10 else ""))
    late = [r for r in clients if r["days"] >= config.DEBT_DAYS[0]]
    if late:
        if daraja == "info":
            daraja = "ogoh"
        if any(r["days"] >= config.DEBT_DAYS[-1] for r in late):
            daraja = "xavf"
        qismlar.append(f"⏰ Qarzi cho'zilgan mijozlar: {len(late)} ta, {money(sum(r['ending_balance'] for r in late))} so'm\n"
                       + "\n".join(f"• {r['name']} {r.get('phone') or ''}: {money(r['ending_balance'])}, {r['days']} kun"
                                   for r in late[:10]))
    qismlar.append(f"📊 Kechagi savdo: tushum {money(kecha.get('income'))}, foyda {money(kecha.get('profit'))}, "
                   f"cheklar {kecha.get('receipts', 0)}")
    if daraja == "info":
        qismlar.insert(0, "✅ YesPOS tekshirildi: minus tovar va cho'zilgan qarz yo'q.")
    return json.dumps({"daraja": daraja, "matn": "🏪 YesPOS\n" + "\n\n".join(qismlar)}, ensure_ascii=False)


async def t_savdo(a):
    frm, to = _range(a)
    s, pt = await an.sales_summary(frm, to)
    lines = [f"Savdo {frm:%d.%m.%Y} — {to:%d.%m.%Y}:",
             f"tushum {money(s.get('income'))}, foyda {money(s.get('profit'))}, cheklar {s.get('receipts', 0)}, "
             f"o'rtacha chek {money(s.get('avarage_receipt'))}, qaytarish {money(s.get('refund_total'))}"]
    if pt:
        lines.append("To'lov turlari: " + ", ".join(f"{p['name']} {money(p['value'])}" for p in pt))
    return "\n".join(lines)


async def t_top(a):
    days = int(a.get("kun") or 30)
    items = await an.top_items(days, int(a.get("soni") or 20))
    return f"Eng ko'p tushum ({days} kun):\n" + "\n".join(
        f"{i}. {s['item']} — {qty(s['qty'])} dona, tushum {money(s['price'])}, foyda {money(s.get('profit'))}"
        for i, s in enumerate(items, 1))


async def t_mijoz_qarz(a):
    rows = await _ctx["cached"]("clients", an.client_debts)
    if not rows:
        return "Qarzdor mijozlar yo'q."
    return f"Qarzdor mijozlar: {len(rows)} ta, jami {money(sum(r['ending_balance'] for r in rows))}\n" + "\n".join(
        f"- {r['name']} {r.get('phone') or ''}: {money(r['ending_balance'])}, {r['days']} kun"
        + (f", oxirgi to'lov {r['last_payment']:%d.%m.%Y}" if r.get("last_payment") else "") for r in rows[:100])


async def t_minus(a):
    items = await _ctx["cached"]("neg", an.negative_stock)
    if not items:
        return "Minus qoldiqli tovar yo'q."
    return f"Minus qoldiqli tovarlar: {len(items)} ta\n" + "\n".join(
        f"- {i['name']} (SKU {i.get('sku')}): {qty(i['stock'])}" for i in items[:150])


async def t_sotilmayotgan(a):
    items = await _ctx["cached"]("unsold", an.unsold_items)
    return (f"{config.UNSOLD_DAYS} kunda umuman sotilmagan: {len(items)} ta, muzlagan pul "
            f"{money(sum(i['frozen'] for i in items))}\n" + "\n".join(
                f"- {i['name']}: qoldiq {qty(i['stock'])}, {money(i['frozen'])}" for i in items[:100]))


async def t_kam_sotilayotgan(a):
    by_qty, by_rev = await _ctx["cached"]("slow", an.slow_items)
    rev = (a.get("turi") or "soni") == "summa"
    lst = by_rev if rev else by_qty
    return (f"Eng kam sotilayotgan ({'tushum' if rev else 'soni'} bo'yicha, {config.SLOW_DAYS} kun):\n" + "\n".join(
        f"- {s['item']}: sotildi {qty(s['qty'])}, tushum {money(s.get('price'))}, qoldiq {qty(s.get('stock'))}"
        for s in lst[:80]))


async def t_taminotchi_qarz(a):
    rows = await _ctx["cached"]("supdebts", an.supplier_debts)
    owe = [r for r in rows if r["debt"] > 0]
    return (f"Ta'minotchilarga qarzimiz: {money(sum(r['debt'] for r in owe))} ({len(owe)} ta)\n" + "\n".join(
        f"- [{r['id']}] {r['name']}: {money(r['debt'])}" for r in owe[:150]))


async def t_akt(a):
    sid, name = await _supplier(a)
    frm, to = _range(a)
    act = await an.act_sverka(sid, frm, to)
    c = act["closing"]
    head = (f"Akt sverka — {name}, {frm:%d.%m.%Y} — {to:%d.%m.%Y}\n"
            f"Boshlang'ich qoldiq {money(act['opening'])}, kirim (tovar) {money(act['credit'])}, "
            f"to'landi {money(act['debit'])}, oxirgi qoldiq {money(c)} "
            f"({'bizning qarz ' + money(-c) if c < 0 else 'ular bizga qarz ' + money(c) if c > 0 else 'qarz yoq'})")
    rows = [f"- {r['date']:%d.%m.%Y %H:%M} {r['document']}: "
            + (f"to'lov {money(r['debit'])}" if r["debit"] else f"tovar {money(r['credit'])}")
            + f", qoldiq {money(r['balance'])}" for r in act["rows"][-200:]]
    return head + "\n" + "\n".join(rows)


async def t_hujjat(a):
    d = await an.purchase_doc(int(a["id"]))
    return (f"Kirim hujjati №{d['id']} — {d['supplier']}, {d['date']:%d.%m.%Y %H:%M}, {d['author']}\n"
            f"Jami {money(d['total_cost'])} (sotuv narxida {money(d['total_price'])})\n" + "\n".join(
                f"- {i['name']}: {qty(i['qty'])} × {money(i['cost'])} = {money(i['sum'])} (sotish {money(i['price'])})"
                for i in d["items"]))


async def t_tovar(a):
    items = (await api.search_items(a["nom"]))[:20]
    if not items:
        return "Topilmadi."
    return "\n".join(f"- [{i['id']}] {i['name']}: qoldiq {qty(i.get('stock'))}, narx {money(i.get('price'))}, "
                     f"tannarx {money(i.get('last_incomming_price') or i.get('cost'))}" for i in items)


async def t_tolov(a):
    sid, name = await _supplier(a)
    amount = float(a["summa"])
    if amount <= 0:
        raise YesPosError("Summa 0 dan katta bo'lsin")
    pts = await api.payment_types()
    pt_name = (a.get("tolov_turi") or "Naqt").lower()
    pt = next((p for p in pts if pt_name in (p.get("name_uz") or "").lower() or pt_name in p["name"].lower()), pts[0])
    when = _date(a.get("sana"))
    if when:
        plan = await an.pay_dated(sid, amount, pt["id"], when, "AI ofis orqali")
        extra = f", sana {when:%d.%m.%Y}, hujjatlar " + ", ".join(f"№{d}" for d, _, _ in plan)
    else:
        await api.pay_to_supplier(sid, amount, pt["id"])
        extra = ""
    _ctx["drop"]("supdebts")
    msg = f"{name} ga {money(amount)} so'm to'lov ({pt.get('name_uz') or pt['name']}){extra}"
    await _notify(msg)
    return "Bajarildi: " + msg


def _items(a, need_cost: bool):
    rows = []
    for it in a.get("tovarlar") or []:
        r = {"item": int(it["tovar_id"]), "qty": float(it["miqdor"])}
        if r["qty"] <= 0:
            raise YesPosError("Miqdor 0 dan katta bo'lsin")
        if need_cost:
            r["cost"] = float(it["tannarx"])
            r["price"] = float(it.get("sotish_narxi") or 0)
        rows.append(r)
    if not rows:
        raise YesPosError("tovarlar ro'yxati bo'sh")
    return rows


async def t_kirim(a):
    sid, name = await _supplier(a)
    rows = _items(a, True)
    if any(not r["price"] for r in rows):
        raise YesPosError("Har bir tovar uchun sotish_narxi kerak (joriy narxni yespos_tovar_qidirish ko'rsatadi)")
    when = _date(a.get("sana"))
    doc = await api.create_purchase(sid, rows, note="AI ofis orqali", when=when)
    _ctx["drop"]("supdebts", "neg")
    msg = (f"tovar kirim №{doc or '?'}: {name}, {len(rows)} xil, "
           f"{money(sum(r['qty'] * r['cost'] for r in rows))} so'm" + (f", sana {when:%d.%m.%Y}" if when else ""))
    await _notify(msg)
    return "Bajarildi: " + msg


async def t_chiqim(a):
    rows = _items(a, False)
    t = 9 if str(a.get("turi")) in ("9", "buzilgan") else 8
    doc = await api.create_write_off(rows, t, note="AI ofis orqali")
    _ctx["drop"]("neg")
    msg = f"tovar chiqim №{doc or '?'} ({'buzilgan' if t == 9 else 'yoqotish'}), {len(rows)} xil"
    await _notify(msg)
    return "Bajarildi: " + msg


S = lambda props=None, req=None: {"type": "object", "properties": props or {}, **({"required": req} if req else {})}
DAVR = {"type": "string", "enum": ["today", "yesterday", "week", "month", "prevmonth", "3m", "year", "all"],
        "description": "Davr: today=bugun, yesterday=kecha, week=shu hafta, month=shu oy, prevmonth=o'tgan oy, year=shu yil"}
DAN = {"type": "string", "description": "Boshlanish sanasi YYYY-MM-DD (davr o'rniga)"}
GACHA = {"type": "string", "description": "Tugash sanasi YYYY-MM-DD"}
SUP = {"yetkazib_beruvchi": {"type": "string", "description": "Yetkazib beruvchi nomi (qisman ham bo'ladi)"},
       "yetkazib_beruvchi_id": {"type": "integer", "description": "Yetkazib beruvchi ID (aniq bo'lsa)"}}
ITEMS = {"type": "array", "items": {"type": "object", "properties": {
    "tovar_id": {"type": "integer"}, "miqdor": {"type": "number"}, "tannarx": {"type": "number"},
    "sotish_narxi": {"type": "number"}}, "required": ["tovar_id", "miqdor"]},
    "description": "Kirimda tannarx va sotish_narxi majburiy"}

TOOLS = [
    ("yespos_umumiy_holat", "Do'konning qisqa holati: bugungi va oylik savdo, mijozlar qarzi, ta'minotchilarga qarz, minus tovarlar.", S(), t_umumiy, True),
    ("yespos_ogohlantirishlar", "Avtomatik tekshiruv uchun: minus tovarlar, qarzi cho'zilgan mijozlar va kechagi savdo. JSON: {daraja: info|ogoh|xavf, matn}.", S(), t_ogohlantirish, True),
    ("yespos_savdo","Davr bo'yicha savdo hisoboti: tushum, foyda, cheklar, to'lov turlari.", S({"davr": DAVR, "dan": DAN, "gacha": GACHA}), t_savdo, True),
    ("yespos_top_tovarlar", "Eng ko'p tushum keltirgan tovarlar.", S({"kun": {"type": "integer"}, "soni": {"type": "integer"}}), t_top, True),
    ("yespos_mijoz_qarzlari", "Qarzdor mijozlar, qarz necha kun cho'zilgani va oxirgi to'lov.", S(), t_mijoz_qarz, True),
    ("yespos_minus_tovarlar", "Ombordagi minus (manfiy) qoldiqli tovarlar.", S(), t_minus, True),
    ("yespos_sotilmayotgan_tovarlar", "Omborda bor, lekin oxirgi 30 kunda umuman sotilmagan tovarlar va muzlagan pul.", S(), t_sotilmayotgan, True),
    ("yespos_kam_sotilayotgan", "Eng kam sotilayotgan tovarlar: turi=soni (dona bo'yicha) yoki summa (tushum bo'yicha).", S({"turi": {"type": "string", "enum": ["soni", "summa"]}}), t_kam_sotilayotgan, True),
    ("yespos_taminotchi_qarzlari", "Yetkazib beruvchilarga qarzimiz (ID bilan).", S(), t_taminotchi_qarz, True),
    ("yespos_akt_sverka", "Yetkazib beruvchi bilan akt sverka: boshlang'ich qoldiq, hujjatlar, to'lovlar, oxirgi qoldiq.", S({**SUP, "davr": DAVR, "dan": DAN, "gacha": GACHA}), t_akt, True),
    ("yespos_kirim_hujjati", "Kirim hujjati (akt sverkadagi №) ichidagi tovarlar.", S({"id": {"type": "integer"}}, ["id"]), t_hujjat, True),
    ("yespos_tovar_qidirish", "Tovarni nomi yoki shtrix-kodi bo'yicha qidirish (ID, qoldiq, narx).", S({"nom": {"type": "string"}}, ["nom"]), t_tovar, True),
    ("yespos_taminotchiga_tolov", "YOZADI: yetkazib beruvchiga to'lovni YesPOS'ga kiritadi. sana (YYYY-MM-DD) berilsa, o'sha sana bilan yoziladi.", S({**SUP, "summa": {"type": "number"}, "tolov_turi": {"type": "string", "description": "Naqt, Plastik, ..."}, "sana": {"type": "string"}}, ["summa"]), t_tolov, False),
    ("yespos_tovar_kirim", "YOZADI: yetkazib beruvchidan tovar kirimi hujjatini yaratib o'tkazadi. tovar_id larni yespos_tovar_qidirish bilan toping.", S({**SUP, "tovarlar": ITEMS, "sana": {"type": "string"}}, ["tovarlar"]), t_kirim, False),
    ("yespos_tovar_chiqim", "YOZADI: tovarni hisobdan chiqaradi (turi: yoqotish yoki buzilgan).", S({"tovarlar": ITEMS, "turi": {"type": "string", "enum": ["yoqotish", "buzilgan"]}}, ["tovarlar"]), t_chiqim, False),
]
TOOL_MAP = {t[0]: t for t in TOOLS}


def _tools_list():
    return [{"name": n, "description": d, "inputSchema": schema,
             "annotations": {"readOnlyHint": ro, "destructiveHint": not ro}} for n, d, schema, _, ro in TOOLS]


async def _call(name, args):
    t = TOOL_MAP.get(name)
    if not t:
        return {"content": [{"type": "text", "text": f"Noma'lum vosita: {name}"}], "isError": True}
    try:
        text = await t[3](args or {})
        return {"content": [{"type": "text", "text": text[:60000]}]}
    except (YesPosError, ValueError, KeyError, TypeError) as e:
        return {"content": [{"type": "text", "text": f"Xato: {e}"}], "isError": True}


async def handle(request: web.Request):
    if request.method != "POST":
        return web.Response(status=405, headers={"Allow": "POST"})
    auth = request.headers.get("Authorization", "")
    if not hmac.compare_digest(auth.encode(), f"Bearer {get_token()}".encode()):
        return web.json_response({"error": "unauthorized"}, status=401)
    try:
        msg = await request.json()
    except Exception:
        return web.json_response({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}, status=400)

    async def one(m):
        mid, method, params = m.get("id"), m.get("method"), m.get("params") or {}
        if mid is None:  # bildirishnoma
            return None
        if method == "initialize":
            res = {"protocolVersion": params.get("protocolVersion") or PROTOCOL, "capabilities": {"tools": {}},
                   "serverInfo": {"name": "yespos", "version": "1.0.0"},
                   "instructions": "YesPOS (Oazis Supermarket) ma'lumotlari. Pul summalari so'mda."}
        elif method == "tools/list":
            res = {"tools": _tools_list()}
        elif method == "tools/call":
            res = await _call(params.get("name"), params.get("arguments"))
        elif method == "ping":
            res = {}
        else:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"Method not found: {method}"}}
        return {"jsonrpc": "2.0", "id": mid, "result": res}

    if isinstance(msg, list):
        out = [r for r in [await one(m) for m in msg] if r]
        return web.json_response(out) if out else web.Response(status=202)
    r = await one(msg)
    return web.json_response(r, dumps=lambda d: json.dumps(d, ensure_ascii=False)) if r else web.Response(status=202)


def setup(app: web.Application, **ctx):
    _ctx.update(ctx)
    get_token()
    app.router.add_route("*", "/mcp", handle)
