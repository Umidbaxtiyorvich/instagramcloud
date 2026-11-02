"""Hisob-kitoblar: qarzlar, minus tovarlar, sotilmayotgan tovarlar, akt sverka."""
import asyncio
import math
import re
from datetime import datetime, timedelta

import config
from yespos import YesPosError, api

FAR_PAST = datetime(2020, 1, 1, tzinfo=config.TZ)


def now():
    return datetime.now(config.TZ)


def day_start(d: datetime):
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


def parse_dt(s: str) -> datetime:
    """YesPOS vaqtni Toshkent vaqtida saqlaydi, lekin oxiriga 'Z' qo'yadi — shuning uchun 'Z' ni e'tiborsiz qoldiramiz."""
    s = (s or "").replace("Z", "").replace(" ", "T")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return now()
    return dt.replace(tzinfo=config.TZ) if dt.tzinfo is None else dt.astimezone(config.TZ)


def money(v) -> str:
    return f"{round(v or 0):,}".replace(",", " ")


def qty(v) -> str:
    v = round(v or 0, 3)
    return str(int(v)) if v == int(v) else str(v)


# ---------- Mijozlar qarzi ----------
async def client_debts():
    """Qarzdor mijozlar ro'yxati, eng eski to'lanmagan sotuv sanasi va kunlar soni bilan."""
    d = await api.clients_debit_credit(FAR_PAST, now())
    debtors = [c for c in (d.get("transactions") or []) if (c.get("ending_balance") or 0) > 1]
    sem = asyncio.Semaphore(5)

    async def enrich(c):
        async with sem:
            try:
                h = await api.client_history(c["id"])
                rows = sorted(h.get("debit_credits") or [], key=lambda r: r["created_date"])
            except Exception:
                rows = []
        # FIFO: to'lovlar eng eski sotuvlarni yopadi
        paid = sum(r.get("credit") or 0 for r in rows)
        oldest = None
        for r in rows:
            debit = r.get("debit") or 0
            if debit <= 0:
                continue
            if paid >= debit - 0.01:
                paid -= debit
                continue
            oldest = parse_dt(r["created_date"])
            break
        last_pay = max((parse_dt(r["created_date"]) for r in rows if (r.get("credit") or 0) > 0), default=None)
        c["oldest_unpaid"] = oldest
        c["days"] = (now() - oldest).days if oldest else 0
        c["last_payment"] = last_pay
        return c

    debtors = await asyncio.gather(*(enrich(c) for c in debtors))
    return sorted(debtors, key=lambda c: -c["days"])


# ---------- Yetkazib beruvchilar ----------
async def supplier_debts():
    """Yetkazib beruvchilar oldidagi qarzimiz (ending_balance < 0 -> biz qarzdormiz)."""
    d = await api.suppliers_debit_credit(FAR_PAST, now())
    rows = []
    for s in d.get("suppliers") or []:
        bal = s.get("ending_balance") or 0
        if abs(bal) > 1:
            rows.append({"id": s["id"], "name": s["company_name"], "balance": bal, "debt": -bal})
    rows.sort(key=lambda r: -r["debt"])
    return rows


async def act_sverka(supplier_id: int, frm: datetime, to: datetime):
    """Akt sverka: boshlang'ich qoldiq, davr harakatlari, oxirgi qoldiq.
    Qoldiq = sum(debit - credit). Manfiy qoldiq -> biz yetkazib beruvchiga qarzdormiz."""
    h = await api.supplier_history(supplier_id)
    rows = sorted(h.get("debit_credits") or [], key=lambda r: r["created_date"])
    opening = 0.0
    period = []
    for r in rows:
        dt = parse_dt(r["created_date"])
        if dt < frm:
            opening += (r.get("debit") or 0) - (r.get("credit") or 0)
        elif dt <= to:
            doc = r.get("document", "")
            period.append({"date": dt, "document": doc, "doc": doc_number(doc),
                           "kind": "pay" if (r.get("debit") or 0) > 0 and not doc_number(doc) else "doc",
                           "debit": r.get("debit") or 0, "credit": r.get("credit") or 0})
    total_debit = sum(r["debit"] for r in period)
    total_credit = sum(r["credit"] for r in period)
    bal = opening
    for r in period:
        bal += r["debit"] - r["credit"]
        r["balance"] = bal
    return {"opening": opening, "rows": period, "debit": total_debit, "credit": total_credit,
            "closing": opening + total_debit - total_credit}


# ---------- Tovarlar ----------
async def negative_stock():
    items, _ = await api.stock_items(stock="negative")
    return sorted([i for i in items if (i.get("stock") or 0) < 0], key=lambda i: i["stock"])


async def unsold_items(days: int = config.UNSOLD_DAYS):
    """Omborda bor, lekin oxirgi `days` kunda bitta ham sotilmagan tovarlar."""
    stock, _ = await api.stock_items()
    sold = await api.sold_items(now() - timedelta(days=days), now())
    sold_ids = {s["id"] for s in sold if (s.get("qty") or 0) > 0}
    res = [i for i in stock if (i.get("stock") or 0) > 0 and i["id"] not in sold_ids]
    for i in res:
        i["frozen"] = (i.get("stock") or 0) * (i.get("cost") or 0)
    return sorted(res, key=lambda i: -i["frozen"])


async def slow_items(days: int = config.SLOW_DAYS):
    """Kam sotilayotgan tovarlar (soni bo'yicha) va kam tushum keltirayotganlar (summa bo'yicha).
    Faqat omborda qoldig'i bor tovarlar hisobga olinadi."""
    sold = await api.sold_items(now() - timedelta(days=days), now())
    sold = [s for s in sold if (s.get("qty") or 0) > 0 and (s.get("stock") or 0) > 0]
    by_qty = sorted(sold, key=lambda s: s["qty"])
    by_revenue = sorted(sold, key=lambda s: s.get("price") or 0)
    return by_qty, by_revenue


async def top_items(days: int = 30, n: int = 20):
    sold = await api.sold_items(now() - timedelta(days=days), now())
    return sorted(sold, key=lambda s: -(s.get("price") or 0))[:n]


# ---------- Savdo ----------
async def sales_summary(frm: datetime, to: datetime):
    s = await api.sales_report(frm, to)
    try:
        pt = await api.sales_by_payment_types(frm, to)
    except Exception:
        pt = None
    return s, pt


# ---------- Akt sverka hujjatlari ----------
DOC_RE = re.compile(r"№\s*(\d+)")


def doc_number(document: str) -> int | None:
    m = DOC_RE.search(document or "")
    return int(m.group(1)) if m else None


async def purchase_doc(doc_id: int):
    d = await api.purchase_order(doc_id)
    items = [{"name": i.get("name"), "sku": i.get("sku"), "qty": i.get("qty") or 0, "cost": i.get("cost") or 0,
              "price": i.get("price") or 0, "sum": (i.get("qty") or 0) * (i.get("cost") or 0)}
             for i in d.get("items") or []]
    return {"id": d.get("id"), "type": d.get("type"), "supplier": d.get("supplier_name"),
            "date": parse_dt(d.get("perform_date") or d.get("created_date")),
            "author": d.get("perform_author_name") or d.get("author_name"), "note": d.get("note"),
            "total_cost": d.get("total_cost") or 0, "total_price": d.get("total_price") or 0,
            "total_payments": d.get("total_payments") or 0, "items": items}


async def find_payment(supplier_id: int, when: datetime, value: float):
    """Aktdagi 'Оплата' qatoriga mos to'lovni topadi (to'lovlar ro'yxatidan, vaqt va summa bo'yicha)."""
    pays = await api.supplier_payments(when - timedelta(days=1), when + timedelta(days=1), 500)
    best = None
    for p in pays:
        if p.get("supplier") != supplier_id or abs((p.get("value") or 0) - value) > 0.5:
            continue
        diff = abs((parse_dt(p["created_date"]) - when).total_seconds())
        if best is None or diff < best[0]:
            best = (diff, p)
    if not best:
        return None
    p = best[1]
    return {"value": p.get("value"), "date": parse_dt(p["created_date"]), "author": p.get("author"),
            "comment": p.get("comment"), "payment_type": p.get("payment_type")}


# ---------- Sanali to'lov ----------
async def plan_dated_payment(supplier_id: int, amount: float, when: datetime):
    """Summani to'lanmagan kirim hujjatlariga taqsimlaydi: avval to'lov sanasigacha bo'lgan eng yangi
    hujjatlar, keyin undan keyingilari. Qaytaradi: [(doc_id, summa, hujjat_sanasi)], taqsimlanmagan qoldiq."""
    docs = [d for d in await api.supplier_purchase_orders(supplier_id)
            if d.get("status") == 1 and d.get("type") == 1]
    for d in docs:
        # pastga yaxlitlaymiz: 55999.988 → 55999.98 (yuqoriga yaxlitlansa YesPOS «Limit exceeded» deydi)
        d["_left"] = math.floor(((d.get("total_cost") or 0) - (d.get("total_pays") or 0)) * 100 + 1e-6) / 100
        d["_dt"] = parse_dt(d.get("perform_date") or d.get("created_date"))
    docs = [d for d in docs if d["_left"] > 0.5]
    before = sorted([d for d in docs if d["_dt"] <= when], key=lambda d: d["_dt"], reverse=True)
    after = sorted([d for d in docs if d["_dt"] > when], key=lambda d: d["_dt"])
    plan, left = [], round(amount, 2)
    for d in before + after:
        if left <= 0:
            break
        part = min(left, d["_left"])
        plan.append((d["id"], part, d["_dt"]))
        left = round(left - part, 2)
    return plan, left


async def pay_dated(supplier_id: int, amount: float, payment_type: int, when: datetime, comment: str = ""):
    plan, left = await plan_dated_payment(supplier_id, amount, when)
    if left > 0.001:
        raise YesPosError(f"To'lanmagan kirim hujjatlari yetarli emas: {left:,.2f} so'm taqsimlanmadi. "
                          f"Kamroq summa yoki bugungi sana bilan to'lov qiling.".replace(",", " "))
    done = []
    for doc_id, part, _ in plan:
        try:
            await api.pay_by_purchase(doc_id, part, payment_type, when, comment)
        except YesPosError as e:
            if not done:
                raise
            raise YesPosError(f"Qisman bajarildi: {', '.join(f'№{d} — {money(p)}' for d, p in done)} yozildi; "
                              f"№{doc_id} ga {money(part)} yozilmadi ({e}). YesPOS'da tekshiring.")
        done.append((doc_id, part))
    return plan
