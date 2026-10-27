"""YesPOS Telegram bot — ishga tushirish: python bot.py"""
import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta

from aiogram import BaseMiddleware, Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import BufferedInputFile, CallbackQuery, Message
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import analytics as an
import config
import excel
import exports
import web
import keyboards as kb
from analytics import money, now, qty
from yespos import YesPosError, api

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bot")

router = Router()
STATE_FILE = os.path.join(config.DATA_DIR, "state.json")
ORG_NAME = os.getenv("ORG_NAME", "Bizning do'kon")


# ================== yordamchilar ==================
class AdminOnly(BaseMiddleware):
    async def __call__(self, handler, event, data):
        user = data.get("event_from_user")
        if user and user.id in config.ADMIN_IDS:
            return await handler(event, data)
        if isinstance(event, Message):
            await event.answer("⛔ Bu bot siz uchun ishlamaydi.")
        elif isinstance(event, CallbackQuery):
            await event.answer("⛔ Bu bot siz uchun ishlamaydi.", show_alert=True)


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(s):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False)


async def send_long(target: Message, text: str, reply_markup=None):
    parts, cur = [], ""
    for line in text.split("\n"):
        if len(cur) + len(line) + 1 > 3900:
            parts.append(cur)
            cur = ""
        cur += line + "\n"
    parts.append(cur)
    for i, p in enumerate(parts):
        await target.answer(p, reply_markup=reply_markup if i == len(parts) - 1 else None)


async def broadcast(bot: Bot, text: str, document: BufferedInputFile | None = None) -> int:
    sent = 0
    for uid in config.ADMIN_IDS:
        try:
            if document:
                await bot.send_document(uid, document, caption=text[:1000])
            else:
                for i in range(0, len(text), 3900):
                    await bot.send_message(uid, text[i:i + 3900])
            sent += 1
        except Exception as e:
            log.warning("Xabar yuborilmadi %s: %s", uid, e)
    return sent


def to_number(text: str) -> float | None:
    try:
        v = float(text.replace(" ", "").replace(",", "."))
        return v if v >= 0 else None
    except ValueError:
        return None


# Excel uchun natijalar keshi (10 daqiqa)
_cache: dict[str, tuple[float, object]] = {}


def drop_cache(*keys):
    for k in keys:
        _cache.pop(k, None)


async def cached(key: str, coro_fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    val = await coro_fn()
    _cache[key] = (time.time(), val)
    return val


# ================== start ==================
@router.message(CommandStart())
@router.message(Command("menu"))
async def start(m: Message, state: FSMContext):
    await state.clear()
    await m.answer("Assalomu alaykum! YesPOS nazorat boti.\nKerakli bo'limni tanlang 👇", reply_markup=kb.main_menu)


@router.message(F.text == kb.BTN_CANCEL)
async def cancel(m: Message, state: FSMContext):
    await state.clear()
    await m.answer("Bekor qilindi.", reply_markup=kb.main_menu)


# ================== Hisobotlar ==================
@router.message(F.text == kb.BTN_REPORTS)
async def reports_menu(m: Message):
    await m.answer("Qaysi davr uchun hisobot?", reply_markup=kb.reports_kb)


def period(name: str):
    t = now()
    today = an.day_start(t)
    if name == "today":
        return today, t, "Bugun"
    if name == "yesterday":
        return today - timedelta(days=1), today - timedelta(milliseconds=1), "Kecha"
    if name == "week":
        return today - timedelta(days=today.weekday()), t, "Shu hafta"
    if name == "month":
        return today.replace(day=1), t, "Shu oy"
    if name == "prevmonth":
        first = today.replace(day=1)
        prev_first = (first - timedelta(days=1)).replace(day=1)
        return prev_first, first - timedelta(milliseconds=1), "O'tgan oy"
    if name == "3m":
        return today - timedelta(days=90), t, "Oxirgi 3 oy"
    if name == "year":
        return today.replace(month=1, day=1), t, "Shu yil"
    return an.FAR_PAST, t, "Butun davr"


def sales_text(title, frm, to, s, pt):
    lines = [f"📊 <b>{title}</b> ({frm:%d.%m.%Y} — {to:%d.%m.%Y})", "",
             f"💰 Tushum: <b>{money(s.get('income'))}</b> so'm",
             f"📈 Foyda: <b>{money(s.get('profit'))}</b> so'm",
             f"🧾 Cheklar: {s.get('receipts', 0)} ta, o'rtacha chek: {money(s.get('avarage_receipt'))}",
             f"↩️ Qaytarishlar: {s.get('refunds', 0)} ta, {money(s.get('refund_total'))} so'm",
             f"🏛 OFD: {money(s.get('ofd_total'))} so'm ({s.get('ofd_receipts', 0)} chek)"]
    if pt:
        lines += ["", "<b>To'lov turlari:</b>"] + [f"  • {p['name']}: {money(p['value'])}" for p in pt]
    return "\n".join(lines)


@router.callback_query(F.data.startswith("rep:"))
async def report_cb(c: CallbackQuery):
    await c.answer("Yuklanmoqda...")
    key = c.data.split(":")[1]
    if key == "top":
        items = await an.top_items(30, 30)
        text = "🏆 <b>Eng ko'p tushum keltirgan tovarlar (30 kun)</b>\n\n" + "\n".join(
            f"{i}. {s['item']} — {qty(s['qty'])} dona, {money(s['price'])} so'm, foyda {money(s.get('profit'))}"
            for i, s in enumerate(items, 1))
        return await send_long(c.message, text)
    frm, to, title = period(key)
    s, pt = await an.sales_summary(frm, to)
    await c.message.answer(sales_text(title, frm, to, s, pt))


# ================== Mijozlar qarzi ==================
@router.message(F.text == kb.BTN_DEBTS)
async def debts(m: Message):
    msg = await m.answer("⏳ Mijozlar qarzi hisoblanmoqda...")
    rows = await cached("clients", an.client_debts)
    if not rows:
        return await msg.edit_text("✅ Hozir qarzdor mijozlar yo'q.")
    total = sum(r["ending_balance"] for r in rows)
    lines = [f"💰 <b>Qarzdor mijozlar: {len(rows)} ta</b>", f"Jami qarz: <b>{money(total)}</b> so'm", ""]
    for th in reversed(config.DEBT_DAYS):
        grp = [r for r in rows if r["days"] >= th]
        lines.append(f"⚠️ {th}+ kun cho'zilgan: {len(grp)} ta, {money(sum(r['ending_balance'] for r in grp))} so'm")
    lines.append("")
    for r in rows[:40]:
        flag = "🔴" if r["days"] >= config.DEBT_DAYS[-1] else "🟠" if r["days"] >= config.DEBT_DAYS[0] else "🟢"
        lp = f", oxirgi to'lov {r['last_payment']:%d.%m.%Y}" if r.get("last_payment") else ""
        lines.append(f"{flag} {r['name']} {r.get('phone') or ''} — <b>{money(r['ending_balance'])}</b>, "
                     f"{r['days']} kun{lp}")
    await msg.delete()
    await send_long(m, "\n".join(lines), kb.excel_btn("clients"))


# ================== Tovar tahlili ==================
@router.message(F.text == kb.BTN_GOODS)
async def goods_menu(m: Message):
    await m.answer("Tovar tahlili:", reply_markup=kb.goods_kb)


@router.callback_query(F.data.startswith("goods:"))
async def goods_cb(c: CallbackQuery):
    await c.answer("Yuklanmoqda, biroz kuting...")
    key = c.data.split(":")[1]
    m = c.message
    if key == "neg":
        items = await cached("neg", an.negative_stock)
        if not items:
            return await m.answer("✅ Minus qoldiqli tovar yo'q.")
        text = f"🔴 <b>Minus tovarlar: {len(items)} ta</b>\n\n" + "\n".join(
            f"• {i['name']} (SKU {i.get('sku')}) — <b>{qty(i['stock'])}</b>" for i in items[:60])
    elif key == "unsold":
        items = await cached("unsold", an.unsold_items)
        frozen = sum(i["frozen"] for i in items)
        text = (f"🧊 <b>{config.UNSOLD_DAYS} kun ichida umuman sotilmagan: {len(items)} ta</b>\n"
                f"Ularda muzlagan pul (tannarxda): <b>{money(frozen)}</b> so'm\n\n" + "\n".join(
                    f"• {i['name']} — qoldiq {qty(i['stock'])}, {money(i['frozen'])} so'm" for i in items[:50]))
    elif key == "slowqty":
        by_qty, _ = await cached("slow", an.slow_items)
        text = (f"🐢 <b>Eng kam sotilayotgan tovarlar (soni bo'yicha, {config.SLOW_DAYS} kun)</b>\n\n" + "\n".join(
            f"• {s['item']} — sotildi {qty(s['qty'])}, qoldiq {qty(s['stock'])}" for s in by_qty[:50]))
    else:
        _, by_rev = await cached("slow", an.slow_items)
        text = (f"💸 <b>Eng kam tushum keltirayotgan tovarlar (summa bo'yicha, {config.SLOW_DAYS} kun)</b>\n\n"
                + "\n".join(f"• {s['item']} — {money(s.get('price'))} so'm ({qty(s['qty'])} dona), "
                            f"qoldiq {qty(s['stock'])}" for s in by_rev[:50]))
    await send_long(m, text, kb.excel_btn(key))


# ================== Excel ==================
@router.callback_query(F.data.startswith("xl:"))
async def excel_cb(c: CallbackQuery):
    await c.answer("Excel tayyorlanmoqda...")
    res = await exports.build(c.data.split(":")[1], cached)
    if res:
        await c.message.answer_document(BufferedInputFile(res[0], filename=res[1]))


# ================== Yetkazib beruvchilar ==================
class Act(StatesGroup):
    search = State()
    period = State()
    docs = State()       # akt chiqqandan keyin hujjat raqamini yozib ko'rish


def parse_user_date(text: str):
    """'.' yoki bo'sh -> None (bugun). '01.10.2026' yoki '01.10' -> datetime (hozirgi soat bilan)."""
    t = (text or "").strip()
    if t in (".", "", "bugun"):
        return None
    for fmt in ("%d.%m.%Y", "%d.%m.%y", "%d.%m"):
        try:
            d = datetime.strptime(t, fmt)
            if fmt == "%d.%m":
                d = d.replace(year=now().year)
            break
        except ValueError:
            continue
    else:
        raise ValueError
    n = now()
    if d.date() > n.date():
        raise ValueError
    if d.date() == n.date():
        return None
    return n.replace(year=d.year, month=d.month, day=d.day)


async def send_doc(m: Message, doc_id: int):
    d = await an.purchase_doc(doc_id)
    lines = [f"📄 <b>Kirim hujjati №{d['id']}</b>", f"🚚 {d['supplier']}", f"🕒 {d['date']:%d.%m.%Y %H:%M} · {d['author']}"]
    if d.get("note"):
        lines.append(f"📝 {d['note']}")
    lines.append("")
    for i, it in enumerate(d["items"], 1):
        lines.append(f"{i}. {it['name']} — {qty(it['qty'])} × {money(it['cost'])} = <b>{money(it['sum'])}</b>")
    lines += ["", f"<b>Jami: {money(d['total_cost'])} so'm</b> (sotuv narxida {money(d['total_price'])})"]
    if d.get("total_payments"):
        lines.append(f"Hujjat bo'yicha to'langan: {money(d['total_payments'])}")
    await send_long(m, "\n".join(lines))


@router.message(F.text == kb.BTN_SUPPLIERS)
async def suppliers_menu(m: Message):
    await m.answer("Yetkazib beruvchilar:", reply_markup=kb.suppliers_kb)


@router.callback_query(F.data == "sup:debts")
async def sup_debts(c: CallbackQuery):
    await c.answer("Yuklanmoqda...")
    rows = await cached("supdebts", an.supplier_debts)
    owe = [r for r in rows if r["debt"] > 0]
    adv = [r for r in rows if r["debt"] < 0]
    lines = [f"🚚 <b>Yetkazib beruvchilarga qarzimiz: {money(sum(r['debt'] for r in owe))}</b> so'm "
             f"({len(owe)} ta)", ""]
    lines += [f"• {r['name']} — <b>{money(r['debt'])}</b>" for r in owe[:60]]
    if adv:
        lines += ["", f"↪️ Oldindan to'langan / ular bizga qarz ({len(adv)} ta):"]
        lines += [f"• {r['name']} — {money(-r['debt'])}" for r in adv[:20]]
    await send_long(c.message, "\n".join(lines), kb.excel_btn("supdebts"))


@router.callback_query(F.data == "sup:pays")
async def sup_pays(c: CallbackQuery):
    await c.answer()
    pays = await api.supplier_payments(now() - timedelta(days=30), now(), 30)
    if not pays:
        return await c.message.answer("Oxirgi 30 kunda to'lov yo'q.")
    await send_long(c.message, "💳 <b>Oxirgi to'lovlar</b>\n\n" + "\n".join(
        f"• {an.parse_dt(p['created_date']):%d.%m %H:%M} {p['company_name']} — <b>{money(p['value'])}</b> "
        f"({p.get('author', '')})" for p in pays))


async def ask_supplier(m: Message, state: FSMContext, next_state: State, purpose: str):
    await state.set_state(next_state)
    await state.update_data(purpose=purpose)
    await m.answer("Yetkazib beruvchi nomini yozing (qisman ham bo'ladi):", reply_markup=kb.cancel_menu)


async def show_suppliers(m: Message, text: str):
    sups = await api.search_suppliers(text.strip(), 10)
    if not sups:
        return await m.answer("Topilmadi. Boshqacha yozib ko'ring.")
    await m.answer("Tanlang:", reply_markup=kb.ikb([[(s["company_name"][:60], f"pick_sup:{s['id']}")] for s in sups]))


@router.callback_query(F.data == "sup:act")
async def act_start(c: CallbackQuery, state: FSMContext):
    await c.answer()
    await ask_supplier(c.message, state, Act.search, "act")


@router.message(Act.search)
async def act_search(m: Message):
    await show_suppliers(m, m.text or "")


@router.callback_query(Act.search, F.data.startswith("pick_sup:"))
async def act_pick(c: CallbackQuery, state: FSMContext):
    await c.answer()
    sid = int(c.data.split(":")[1])
    name = next((b.text for row in c.message.reply_markup.inline_keyboard for b in row
                 if b.callback_data == c.data), str(sid))
    await state.update_data(sup_id=sid, sup_name=name)
    await state.set_state(Act.period)
    await c.message.answer(f"<b>{name}</b>\nDavrni tanlang yoki yozing (masalan: 01.01.2026-31.03.2026):",
                           reply_markup=kb.act_period_kb)


async def do_act(m: Message, state: FSMContext, frm: datetime, to: datetime):
    d = await state.get_data()
    await state.clear()
    await state.set_state(Act.docs)
    msg = await m.answer("⏳ Akt sverka tayyorlanmoqda...")
    act = await an.act_sverka(d["sup_id"], frm, to)
    closing = act["closing"]
    status = (f"Bizning qarz: <b>{money(-closing)}</b>" if closing < 0 else
              f"Ular bizga qarz: <b>{money(closing)}</b>" if closing > 0 else "Qarz yo'q")
    try:
        await msg.delete()
    except Exception:
        pass
    await m.answer(
        f"🧾 <b>Akt sverka — {d['sup_name']}</b>\n{frm:%d.%m.%Y} — {to:%d.%m.%Y}\n\n"
        f"Boshlang'ich qoldiq: {money(act['opening'])}\n"
        f"Kirim (tovar olindi): {money(act['credit'])}\n"
        f"To'landi: {money(act['debit'])}\n"
        f"Oxirgi qoldiq: {money(closing)}\n{status}\nHujjatlar: {len(act['rows'])} ta")
    data = excel.act_sverka(ORG_NAME, d["sup_name"], frm, to, act)
    safe = "".join(ch for ch in d["sup_name"] if ch.isalnum() or ch in " _-")[:40]
    await m.answer_document(BufferedInputFile(data, filename=f"Akt_sverka_{safe}_{to:%Y-%m-%d}.xlsx"),
                            reply_markup=kb.main_menu)
    docs = [r for r in act["rows"] if r.get("doc")][-20:]
    if docs:
        btns = [[(f"№{r['doc']} · {r['date']:%d.%m.%Y} · {money(r['credit'] or r['debit'])}", f"pdoc:{r['doc']}")]
                for r in reversed(docs)]
        await m.answer("📄 Hujjat ichini ko'rish uchun bosing (oxirgi 20 ta).\n"
                       "Boshqa hujjat uchun raqamini yozing, masalan: <code>4691</code>",
                       reply_markup=kb.ikb(btns))


@router.callback_query(F.data.startswith("pdoc:"))
async def pdoc_cb(c: CallbackQuery):
    await c.answer()
    await send_doc(c.message, int(c.data.split(":")[1]))


@router.message(Act.docs, F.text.regexp(r"^\s*№?\s*\d+\s*$"))
async def pdoc_text(m: Message):
    await send_doc(m, int(m.text.strip().lstrip("№").strip()))


@router.callback_query(Act.period, F.data.startswith("actp:"))
async def act_period(c: CallbackQuery, state: FSMContext):
    await c.answer()
    frm, to, _ = period(c.data.split(":")[1])
    await do_act(c.message, state, frm, to)


@router.message(Act.period)
async def act_period_text(m: Message, state: FSMContext):
    try:
        a, b = (m.text or "").replace(" ", "").split("-")
        frm = datetime.strptime(a, "%d.%m.%Y").replace(tzinfo=config.TZ)
        to = datetime.strptime(b, "%d.%m.%Y").replace(tzinfo=config.TZ, hour=23, minute=59, second=59)
    except ValueError:
        return await m.answer("Format: 01.01.2026-31.03.2026")
    await do_act(m, state, frm, to)


# ================== Ta'minotchiga to'lov ==================
class Pay(StatesGroup):
    search = State()
    amount = State()
    date = State()
    ptype = State()
    confirm = State()


@router.message(F.text == kb.BTN_PAY)
async def pay_start(m: Message, state: FSMContext):
    await state.clear()
    await ask_supplier(m, state, Pay.search, "pay")


@router.message(Pay.search)
async def pay_search(m: Message):
    await show_suppliers(m, m.text or "")


@router.callback_query(Pay.search, F.data.startswith("pick_sup:"))
async def pay_pick(c: CallbackQuery, state: FSMContext):
    await c.answer()
    sid = int(c.data.split(":")[1])
    name = next((b.text for row in c.message.reply_markup.inline_keyboard for b in row
                 if b.callback_data == c.data), str(sid))
    rows = await cached("supdebts", an.supplier_debts)
    debt = next((r["debt"] for r in rows if r["id"] == sid), 0)
    await state.update_data(sup_id=sid, sup_name=name)
    await state.set_state(Pay.amount)
    await c.message.answer(f"<b>{name}</b>\nHozirgi qarzimiz: {money(debt)} so'm\n\nTo'lov summasini yozing:")


@router.message(Pay.amount)
async def pay_amount(m: Message, state: FSMContext):
    v = to_number(m.text or "")
    if not v:
        return await m.answer("Summani raqamda yozing, masalan: 1500000")
    await state.update_data(amount=v)
    await state.set_state(Pay.date)
    await m.answer("📅 To'lov sanasi?\nBugun bo'lsa «.» yuboring, boshqa kun bo'lsa yozing: <code>01.10.2026</code>")


@router.message(Pay.date)
async def pay_date(m: Message, state: FSMContext):
    try:
        when = parse_user_date(m.text or "")
    except ValueError:
        return await m.answer("Sana formati: 01.10.2026 (kelajakdagi sana bo'lmaydi). Bugun uchun «.»")
    d = await state.get_data()
    plan_text = ""
    if when:
        plan, left = await an.plan_dated_payment(d["sup_id"], d["amount"], when)
        if left > 0.5:
            return await m.answer(f"⚠️ To'lanmagan kirim hujjatlari yetarli emas: {money(left)} so'm taqsimlanmadi.\n"
                                  f"Kamroq summa yoki bugungi sana («.») bilan qiling.")
        plan_text = "\n🔗 Kirim hujjatlariga bog'lanadi:\n" + "\n".join(
            f"   №{doc} ({dt:%d.%m.%Y}) — {money(part)}" for doc, part, dt in plan)
    await state.update_data(when=when.isoformat() if when else None, plan_text=plan_text)
    await state.set_state(Pay.ptype)
    pts = await api.payment_types()
    await m.answer("To'lov turi:", reply_markup=kb.ikb(
        [[(p.get("name_uz") or p["name"], f"pt:{p['id']}:{(p.get('name_uz') or p['name'])[:20]}")] for p in pts]))


@router.callback_query(Pay.ptype, F.data.startswith("pt:"))
async def pay_ptype(c: CallbackQuery, state: FSMContext):
    await c.answer()
    _, pid, pname = c.data.split(":", 2)
    await state.update_data(pt_id=int(pid), pt_name=pname)
    d = await state.get_data()
    await state.set_state(Pay.confirm)
    when = datetime.fromisoformat(d["when"]) if d.get("when") else None
    await c.message.answer(
        f"Tasdiqlang:\n🚚 {d['sup_name']}\n💵 {money(d['amount'])} so'm\n💳 {pname}\n"
        f"📅 {(when or now()):%d.%m.%Y}{d.get('plan_text', '')}",
        reply_markup=kb.ikb([[("✅ Tasdiqlash", "pay:ok"), ("❌ Bekor", "pay:no")]]))


@router.callback_query(Pay.confirm, F.data.startswith("pay:"))
async def pay_confirm(c: CallbackQuery, state: FSMContext):
    await c.answer()
    d = await state.get_data()
    await state.clear()
    await c.message.edit_reply_markup(reply_markup=None)
    if c.data == "pay:no":
        return await c.message.answer("Bekor qilindi.", reply_markup=kb.main_menu)
    when = datetime.fromisoformat(d["when"]) if d.get("when") else None
    if when:
        await an.pay_dated(d["sup_id"], d["amount"], d["pt_id"], when, "Telegram bot orqali")
    else:
        await api.pay_to_supplier(d["sup_id"], d["amount"], d["pt_id"])
    _cache.pop("supdebts", None)
    await c.message.answer(f"✅ {d['sup_name']} ga {money(d['amount'])} so'm to'lov kiritildi "
                           f"({(when or now()):%d.%m.%Y}).", reply_markup=kb.main_menu)


# ================== Tovar kirim / chiqim ==================
class Doc(StatesGroup):
    supplier = State()   # faqat kirim uchun
    date = State()       # faqat kirim uchun
    wtype = State()      # faqat chiqim uchun
    item = State()
    qty = State()
    cost = State()
    price = State()
    confirm = State()


@router.message(F.text == kb.BTN_PURCHASE)
async def purchase_start(m: Message, state: FSMContext):
    await state.clear()
    await state.update_data(kind="in", items=[])
    await ask_supplier(m, state, Doc.supplier, "purchase")


@router.message(F.text == kb.BTN_WRITEOFF)
async def writeoff_start(m: Message, state: FSMContext):
    await state.clear()
    await state.update_data(kind="out", items=[])
    await state.set_state(Doc.wtype)
    await m.answer("Chiqim turi:", reply_markup=kb.writeoff_type_kb)
    await m.answer("Bekor qilish uchun pastdagi tugmani bosing.", reply_markup=kb.cancel_menu)


@router.message(Doc.supplier)
async def doc_sup_search(m: Message):
    await show_suppliers(m, m.text or "")


@router.callback_query(Doc.supplier, F.data.startswith("pick_sup:"))
async def doc_sup_pick(c: CallbackQuery, state: FSMContext):
    await c.answer()
    sid = int(c.data.split(":")[1])
    name = next((b.text for row in c.message.reply_markup.inline_keyboard for b in row
                 if b.callback_data == c.data), str(sid))
    await state.update_data(sup_id=sid, sup_name=name)
    await state.set_state(Doc.date)
    await c.message.answer(f"🚚 {name}\n\n📅 Kirim sanasi?\nBugun bo'lsa «.» yuboring, boshqa kun bo'lsa: "
                           f"<code>01.10.2026</code>")


@router.message(Doc.date)
async def doc_date(m: Message, state: FSMContext):
    try:
        when = parse_user_date(m.text or "")
    except ValueError:
        return await m.answer("Sana formati: 01.10.2026 (kelajakdagi sana bo'lmaydi). Bugun uchun «.»")
    await state.update_data(when=when.isoformat() if when else None)
    await state.set_state(Doc.item)
    await m.answer(f"📅 {(when or now()):%d.%m.%Y}\n\nTovar nomi yoki shtrix-kodini yozing:")


@router.callback_query(Doc.wtype, F.data.startswith("wot:"))
async def doc_wtype(c: CallbackQuery, state: FSMContext):
    await c.answer()
    await state.update_data(wtype=int(c.data.split(":")[1]))
    await state.set_state(Doc.item)
    await c.message.answer("Tovar nomi yoki shtrix-kodini yozing:")


@router.message(Doc.item)
async def doc_item_search(m: Message, state: FSMContext):
    items = await api.search_items((m.text or "").strip())
    if not items:
        return await m.answer("Tovar topilmadi. Boshqacha yozib ko'ring.")
    items = items[:10]
    await state.update_data(found={str(i["id"]): {
        "name": i["name"], "unit_type": i.get("unit_type"), "stock": i.get("stock"),
        "cost": i.get("last_incomming_price") or i.get("cost") or 0, "price": i.get("price") or 0,
    } for i in items})
    await m.answer("Tanlang:", reply_markup=kb.ikb(
        [[(f"{i['name'][:45]} | qoldiq {qty(i.get('stock'))}", f"it:{i['id']}")] for i in items]))


@router.callback_query(Doc.item, F.data.startswith("it:"))
async def doc_item_pick(c: CallbackQuery, state: FSMContext):
    await c.answer()
    d = await state.get_data()
    it = d["found"][c.data.split(":")[1]]
    it["item"] = int(c.data.split(":")[1])
    await state.update_data(cur=it)
    await state.set_state(Doc.qty)
    await c.message.answer(f"📦 {it['name']}\nQoldiq: {qty(it['stock'])}\n\nMiqdorini yozing:")


@router.message(Doc.qty)
async def doc_qty(m: Message, state: FSMContext):
    v = to_number(m.text or "")
    if not v:
        return await m.answer("Miqdorni raqamda yozing, masalan: 10 yoki 2.5")
    d = await state.get_data()
    cur = d["cur"]
    cur["qty"] = v
    await state.update_data(cur=cur)
    if d["kind"] == "out":
        return await add_item_and_ask(m, state)
    await state.set_state(Doc.cost)
    await m.answer(f"Kirim narxi (tannarx)? Oxirgi: {money(cur['cost'])}\n"
                   f"O'zgarmasa «.» yuboring.")


@router.message(Doc.cost)
async def doc_cost(m: Message, state: FSMContext):
    d = await state.get_data()
    cur = d["cur"]
    if (m.text or "").strip() != ".":
        v = to_number(m.text or "")
        if v is None:
            return await m.answer("Raqam yozing yoki «.»")
        cur["cost"] = v
    await state.update_data(cur=cur)
    await state.set_state(Doc.price)
    await m.answer(f"Sotish narxi? Hozirgi: {money(cur['price'])}\nO'zgarmasa «.» yuboring.")


@router.message(Doc.price)
async def doc_price(m: Message, state: FSMContext):
    d = await state.get_data()
    cur = d["cur"]
    if (m.text or "").strip() != ".":
        v = to_number(m.text or "")
        if v is None:
            return await m.answer("Raqam yozing yoki «.»")
        cur["price"] = v
    await state.update_data(cur=cur)
    await add_item_and_ask(m, state)


def doc_summary(d) -> str:
    title = "➕ <b>Tovar kirim</b>" if d["kind"] == "in" else (
        "➖ <b>Tovar chiqim</b> (" + ("yo'qotish" if d.get("wtype") == 8 else "buzilgan") + ")")
    lines = [title]
    if d["kind"] == "in":
        when = datetime.fromisoformat(d["when"]) if d.get("when") else now()
        lines.append(f"🚚 {d['sup_name']} · 📅 {when:%d.%m.%Y}")
    total = 0
    for i, it in enumerate(d["items"], 1):
        if d["kind"] == "in":
            s = it["qty"] * it["cost"]
            total += s
            lines.append(f"{i}. {it['name']} — {qty(it['qty'])} × {money(it['cost'])} = {money(s)} "
                         f"(sotish {money(it['price'])})")
        else:
            lines.append(f"{i}. {it['name']} — {qty(it['qty'])}")
    if d["kind"] == "in":
        lines.append(f"\n<b>Jami: {money(total)} so'm</b>")
    return "\n".join(lines)


async def add_item_and_ask(m: Message, state: FSMContext):
    d = await state.get_data()
    items = d["items"] + [d["cur"]]
    await state.update_data(items=items, cur=None, found=None)
    d["items"] = items
    await state.set_state(Doc.confirm)
    await m.answer(doc_summary(d), reply_markup=kb.ikb([
        [("➕ Yana tovar qo'shish", "doc:more")],
        [("✅ Saqlash va o'tkazish", "doc:save"), ("❌ Bekor", "doc:cancel")],
    ]))


@router.callback_query(Doc.confirm, F.data.startswith("doc:"))
async def doc_confirm(c: CallbackQuery, state: FSMContext):
    await c.answer()
    act = c.data.split(":")[1]
    await c.message.edit_reply_markup(reply_markup=None)
    if act == "more":
        await state.set_state(Doc.item)
        return await c.message.answer("Keyingi tovar nomi yoki shtrix-kodi:")
    d = await state.get_data()
    await state.clear()
    if act == "cancel":
        return await c.message.answer("Bekor qilindi.", reply_markup=kb.main_menu)
    if d["kind"] == "in":
        doc_id = await api.create_purchase(d["sup_id"], d["items"], note="Telegram bot orqali",
                                           when=datetime.fromisoformat(d["when"]) if d.get("when") else None)
        _cache.pop("supdebts", None)
        what = "Kirim hujjati"
    else:
        doc_id = await api.create_write_off(d["items"], d.get("wtype", 8), note="Telegram bot orqali")
        what = "Chiqim hujjati"
    _cache.pop("neg", None)
    if doc_id:
        await c.message.answer(f"✅ {what} №{doc_id} yaratildi va o'tkazildi.", reply_markup=kb.main_menu)
    else:
        await c.message.answer(f"⚠️ {what} yaratildi, lekin ID qaytmadi — YesPOS'da tekshirib "
                               f"«O'tkazish» ni bosing.", reply_markup=kb.main_menu)


# ================== Sayt qurilmalari ==================
def _ago(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return "?"
    return f"{dt:%d.%m.%Y %H:%M}"


def devices_view():
    sess = web.list_sessions()
    if not sess:
        return "🖥 Saytga hech qanday qurilma kirmagan.", None
    lines = [f"🖥 <b>Saytga kirgan qurilmalar: {len(sess)} ta</b>", ""]
    btns = []
    for i, x in enumerate(sess, 1):
        lines.append(f"{i}. <b>{x['device']}</b>\n   IP: {x.get('ip', '?')} · kirgan: {_ago(x.get('created'))}\n"
                     f"   oxirgi faollik: {_ago(x.get('last_seen'))}")
        btns.append([(f"❌ {i}. {x['device']} — chiqarish", f"wsrm:{x['id']}")])
    if len(sess) > 1:
        btns.append([("🚫 Hammasini chiqarish", "wsrm:*")])
    return "\n".join(lines), kb.ikb(btns)


@router.message(F.text == kb.BTN_DEVICES)
async def devices(m: Message):
    text, markup = devices_view()
    await m.answer(text, reply_markup=markup)


@router.callback_query(F.data.startswith("wsrm:"))
async def device_remove(c: CallbackQuery):
    sid = c.data.split(":", 1)[1]
    if sid == "*":
        for x in web.list_sessions():
            web.revoke(x["id"])
        await c.answer("Barcha qurilmalar chiqarildi", show_alert=True)
    else:
        x = web.revoke(sid)
        await c.answer(f"{x['device']} chiqarildi" if x else "Bu qurilma allaqachon chiqarilgan", show_alert=True)
    text, markup = devices_view()
    try:
        await c.message.edit_text(text, reply_markup=markup)
    except Exception:
        await c.message.answer(text, reply_markup=markup)


async def notify_login(bot: Bot, sess: dict):
    text = (f"🖥 <b>Saytga yangi qurilma kirdi</b>\n{sess['device']}\nIP: {sess['ip']}\n"
            f"Vaqt: {_ago(sess['created'])}\n\nAgar bu siz bo'lmasangiz — chiqarib tashlang.")
    markup = kb.ikb([[("❌ Chiqarib tashlash", f"wsrm:{sess['id']}")]])
    for uid in config.ADMIN_IDS:
        try:
            await bot.send_message(uid, text, reply_markup=markup)
        except Exception as e:
            log.warning("Xabar yuborilmadi %s: %s", uid, e)


# ================== AI ofis (MCP) ==================
def aiofis_text(token: str) -> str:
    # PUBLIC_URL — sayt boshqa sayt ichida bo'lsa (https://.../yespos)
    url = os.getenv("PUBLIC_URL") or "https://" + (os.getenv("RAILWAY_PUBLIC_DOMAIN") or "yespos-bot-production.up.railway.app")
    return ("🔌 <b>AI ofisga ulash</b>\n\n"
            "AI ofis → <b>Ulanishlar</b> → yangi ulanish:\n"
            "• Nomi: <code>YesPOS</code>\n"
            f"• Manzil (URL): <code>{url.rstrip('/')}/mcp</code>\n"
            "• Ulanish turi: <b>API token</b>\n"
            f"• Token: <tg-spoiler><code>{token}</code></tg-spoiler>\n\n"
            "Faqat ko'rish uchun shu yetarli. AI ofis to'lov, kirim va chiqimni ham qila olishi uchun "
            "ulanishda «Yozishga ruxsat» ni yoqing — har bir bunday amal shu botga xabar qilinadi.\n\n"
            "⚠️ Tokenni hech kimga bermang. Oshkor bo'lsa — «Tokenni yangilash» ni bosing va AI ofisga yangisini kiriting.")


@router.message(F.text == kb.BTN_AIOFIS)
async def aiofis(m: Message):
    import mcp_server
    await m.answer(aiofis_text(mcp_server.get_token()),
                   reply_markup=kb.ikb([[("🔄 Tokenni yangilash", "mcptok:rotate")]]))


@router.callback_query(F.data == "mcptok:rotate")
async def aiofis_rotate(c: CallbackQuery):
    import mcp_server
    await c.answer("Yangi token yaratildi. Eskisi endi ishlamaydi.", show_alert=True)
    await c.message.edit_text(aiofis_text(mcp_server.get_token(rotate=True)),
                              reply_markup=kb.ikb([[("🔄 Tokenni yangilash", "mcptok:rotate")]]))


# ================== Avtomatik ogohlantirishlar ==================
async def job_check(bot: Bot):
    """Har CHECK_INTERVAL_MIN daqiqada: yangi minus tovarlar va muddati o'tgan qarzlar."""
    st = load_state()
    try:
        neg = await an.negative_stock()
        known = set(st.get("neg_ids", []))
        new = [i for i in neg if i["id"] not in known]
        if new and "neg_ids" in st:  # birinchi ishga tushishda spam qilmaymiz
            await broadcast(bot, f"🔴 <b>Yangi minus tovarlar: {len(new)} ta</b>\n\n" + "\n".join(
                f"• {i['name']} — {qty(i['stock'])}" for i in new[:40]))
        st["neg_ids"] = [i["id"] for i in neg]
    except Exception as e:
        log.exception("Minus tovar tekshiruvi: %s", e)

    try:
        debts = await an.client_debts()
        notified = st.get("debt_notified", {})
        alerts = []
        for r in debts:
            reached = max([t for t in config.DEBT_DAYS if r["days"] >= t], default=0)
            if reached and notified.get(str(r["id"]), 0) < reached:
                alerts.append(f"• {r['name']} {r.get('phone') or ''} — {money(r['ending_balance'])} so'm, "
                              f"<b>{r['days']} kun</b> ({reached}+ chegarasi)")
                notified[str(r["id"])] = reached
        current = {str(r["id"]) for r in debts}
        st["debt_notified"] = {k: v for k, v in notified.items() if k in current}
        if alerts:
            await broadcast(bot, "⏰ <b>Qarzi cho'zilib ketgan mijozlar</b>\n\n" + "\n".join(alerts))
    except Exception as e:
        log.exception("Qarz tekshiruvi: %s", e)
    save_state(st)


async def job_daily(bot: Bot):
    try:
        frm, to, _ = period("yesterday")
        s, pt = await an.sales_summary(frm, to)
        parts = [sales_text("Kechagi savdo", frm, to, s, pt)]
        debts = await an.client_debts()
        late = [r for r in debts if r["days"] >= config.DEBT_DAYS[0]]
        parts.append(f"\n💰 Mijozlar qarzi: {money(sum(r['ending_balance'] for r in debts))} so'm "
                     f"({len(debts)} ta), {config.DEBT_DAYS[0]}+ kun cho'zilgan: {len(late)} ta")
        sup = await an.supplier_debts()
        parts.append(f"🚚 Ta'minotchilarga qarzimiz: {money(sum(r['debt'] for r in sup if r['debt'] > 0))} so'm")
        neg = await an.negative_stock()
        parts.append(f"🔴 Minus tovarlar: {len(neg)} ta")
        await broadcast(bot, "🌅 <b>Kunlik hisobot</b>\n\n" + "\n".join(parts))
    except Exception as e:
        log.exception("Kunlik hisobot: %s", e)


async def job_weekly(bot: Bot):
    try:
        items = await an.unsold_items()
        data = excel.simple(f"Sotilmagan {config.UNSOLD_DAYS} kun",
                            ["Tovar", "SKU", "Qoldiq", "Tannarx", "Muzlagan summa"],
                            [[i["name"], i.get("sku"), i["stock"], i.get("cost"), i["frozen"]] for i in items],
                            [50, 10, 12, 14, 18])
        await broadcast(bot, f"🧊 Haftalik: {config.UNSOLD_DAYS} kunda sotilmagan {len(items)} ta tovar, "
                             f"muzlagan pul {money(sum(i['frozen'] for i in items))} so'm",
                        BufferedInputFile(data, filename=f"sotilmagan_{now():%Y-%m-%d}.xlsx"))
    except Exception as e:
        log.exception("Haftalik hisobot: %s", e)


# ================== xatolar ==================
@router.errors()
async def on_error(event):
    exc = event.exception
    log.exception("Xato: %s", exc)
    msg = f"⚠️ Xato: {exc}" if isinstance(exc, YesPosError) else "⚠️ Kutilmagan xato yuz berdi, qayta urinib ko'ring."
    upd = event.update
    target = upd.message or (upd.callback_query and upd.callback_query.message)
    if target:
        try:
            await target.answer(msg)
        except Exception:
            pass
    return True


async def main():
    if not config.BOT_TOKEN or not config.ADMIN_IDS:
        raise SystemExit(".env faylda BOT_TOKEN va ADMIN_IDS ni to'ldiring")
    from aiogram.client.default import DefaultBotProperties
    bot = Bot(config.BOT_TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
    dp = Dispatcher()
    dp.message.outer_middleware(AdminOnly())
    dp.callback_query.outer_middleware(AdminOnly())
    dp.include_router(router)

    if not api.token:
        await api.login()
    hh, mm = map(int, config.DAILY_REPORT_TIME.split(":"))
    sched = AsyncIOScheduler(timezone=config.TZ)
    sched.add_job(job_check, "interval", minutes=config.CHECK_INTERVAL_MIN, args=[bot],
                  next_run_time=datetime.now(config.TZ) + timedelta(seconds=20))
    sched.add_job(job_daily, "cron", hour=hh, minute=mm, args=[bot])
    sched.add_job(job_weekly, "cron", day_of_week="mon", hour=hh, minute=mm + 5 if mm < 55 else mm, args=[bot])
    sched.start()
    await web.start(bot, cached, period, broadcast, drop_cache, lambda sess: notify_login(bot, sess))
    log.info("Bot ishga tushdi")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
