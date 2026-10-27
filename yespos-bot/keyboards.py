from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup

BTN_REPORTS = "📊 Hisobotlar"
BTN_DEBTS = "💰 Mijozlar qarzi"
BTN_GOODS = "📦 Tovar tahlili"
BTN_SUPPLIERS = "🚚 Yetkazib beruvchilar"
BTN_PURCHASE = "➕ Tovar kirim"
BTN_WRITEOFF = "➖ Tovar chiqim"
BTN_PAY = "💵 Ta'minotchiga to'lov"
BTN_DEVICES = "🖥 Sayt qurilmalari"
BTN_AIOFIS = "🔌 AI ofis ulanishi"
BTN_CANCEL = "❌ Bekor qilish"

main_menu = ReplyKeyboardMarkup(resize_keyboard=True, keyboard=[
    [KeyboardButton(text=BTN_REPORTS), KeyboardButton(text=BTN_DEBTS)],
    [KeyboardButton(text=BTN_GOODS), KeyboardButton(text=BTN_SUPPLIERS)],
    [KeyboardButton(text=BTN_PURCHASE), KeyboardButton(text=BTN_WRITEOFF)],
    [KeyboardButton(text=BTN_PAY), KeyboardButton(text=BTN_DEVICES)],
    [KeyboardButton(text=BTN_AIOFIS)],
])

cancel_menu = ReplyKeyboardMarkup(resize_keyboard=True, keyboard=[[KeyboardButton(text=BTN_CANCEL)]])


def ikb(rows: list[list[tuple[str, str]]]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t, callback_data=d) for t, d in row] for row in rows
    ])


reports_kb = ikb([
    [("Bugun", "rep:today"), ("Kecha", "rep:yesterday")],
    [("Shu hafta", "rep:week"), ("Shu oy", "rep:month")],
    [("O'tgan oy", "rep:prevmonth"), ("🏆 Top tovarlar (30 kun)", "rep:top")],
])

goods_kb = ikb([
    [("🔴 Minus tovarlar", "goods:neg")],
    [("🧊 Umuman sotilmayotgan", "goods:unsold")],
    [("🐢 Kam sotilayotgan (soni)", "goods:slowqty")],
    [("💸 Kam tushum (summa bo'yicha)", "goods:slowrev")],
])

suppliers_kb = ikb([
    [("📋 Qarzlar ro'yxati", "sup:debts")],
    [("🧾 Akt sverka", "sup:act")],
    [("💳 Oxirgi to'lovlar", "sup:pays")],
])

act_period_kb = ikb([
    [("Shu oy", "actp:month"), ("O'tgan oy", "actp:prevmonth")],
    [("Oxirgi 3 oy", "actp:3m"), ("Shu yil", "actp:year")],
    [("Hammasi", "actp:all")],
])

writeoff_type_kb = ikb([[("Yo'qotish (8)", "wot:8"), ("Buzilgan tovar (9)", "wot:9")]])


def excel_btn(key: str):
    return ikb([[("📥 Excelga yuklab olish", f"xl:{key}")]])
