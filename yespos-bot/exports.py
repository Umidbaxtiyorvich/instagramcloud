"""Bot va sayt uchun umumiy Excel eksportlari."""
import analytics as an
import config
import excel
from analytics import now

EXPORT_KEYS = ("clients", "neg", "unsold", "slowqty", "slowrev", "supdebts")


async def build(key: str, cached) -> tuple[bytes, str] | None:
    """(fayl, nom) qaytaradi. cached(key, fn) — natijalar keshi."""
    stamp = now().strftime("%Y-%m-%d")
    if key == "clients":
        rows = await cached("clients", an.client_debts)
        data = excel.simple("Mijozlar qarzi", ["Mijoz", "Telefon", "Qarz", "Necha kun", "Eng eski qarz sanasi",
                                               "Oxirgi to'lov"],
                            [[r["name"], r.get("phone") or "", r["ending_balance"], r["days"],
                              f"{r['oldest_unpaid']:%d.%m.%Y}" if r.get("oldest_unpaid") else "",
                              f"{r['last_payment']:%d.%m.%Y}" if r.get("last_payment") else ""] for r in rows],
                            [35, 18, 16, 12, 20, 16], ["JAMI", "", sum(r["ending_balance"] for r in rows)])
    elif key == "neg":
        items = await cached("neg", an.negative_stock)
        data = excel.simple("Minus tovarlar", ["Tovar", "SKU", "Kategoriya", "Qoldiq", "Tannarx", "Narx"],
                            [[i["name"], i.get("sku"), i.get("category_name"), i["stock"], i.get("cost"),
                              i.get("price")] for i in items], [50, 10, 20, 12, 14, 14])
    elif key == "unsold":
        items = await cached("unsold", an.unsold_items)
        data = excel.simple(f"Sotilmagan {config.UNSOLD_DAYS} kun",
                            ["Tovar", "SKU", "Kategoriya", "Qoldiq", "Tannarx", "Narx", "Muzlagan summa"],
                            [[i["name"], i.get("sku"), i.get("category_name"), i["stock"], i.get("cost"),
                              i.get("price"), i["frozen"]] for i in items], [50, 10, 20, 12, 14, 14, 18],
                            ["JAMI", "", "", "", "", "", sum(i["frozen"] for i in items)])
    elif key in ("slowqty", "slowrev"):
        by_qty, by_rev = await cached("slow", an.slow_items)
        lst = by_qty if key == "slowqty" else by_rev
        data = excel.simple(f"Kam sotilgan {config.SLOW_DAYS} kun",
                            ["Tovar", "SKU", "Kategoriya", "Sotilgan soni", "Tushum", "Foyda", "Qoldiq"],
                            [[s["item"], s.get("sku"), s.get("category"), s["qty"], s.get("price"),
                              s.get("profit"), s.get("stock")] for s in lst], [50, 10, 20, 14, 16, 16, 12])
    elif key == "supdebts":
        rows = await cached("supdebts", an.supplier_debts)
        data = excel.simple("Ta'minotchilar qarzi", ["Yetkazib beruvchi", "Bizning qarz", "Balans"],
                            [[r["name"], r["debt"], r["balance"]] for r in rows], [40, 18, 18],
                            ["JAMI", sum(r["debt"] for r in rows if r["debt"] > 0)])
    else:
        return None
    return data, f"{key}_{stamp}.xlsx"
