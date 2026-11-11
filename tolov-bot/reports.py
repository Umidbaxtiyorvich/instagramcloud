"""
Qarzlar hisoboti va akt sverka (CloudShop ma'lumotlari asosida) + Excel fayllar.

Sof qarz CloudShop saytidagi "Баланс" formulasi bilan hisoblanadi:
    balans = olingan pul (debit) - sotuvlar - berilgan pul (credit) + qaytarishlar
    qarz   = -balans   (musbat - mijoz bizga qarzdor, manfiy - biz unga qarzdormiz / oldindan to'lagan)
"Долг по продажам" (CloudShop `debt` maydoni) - to'lanmagan sotuv hujjatlari yig'indisi, alohida ustunda.
"""
import io
from datetime import datetime, timezone, timedelta

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

TASHKENT = timezone(timedelta(hours=5))
NUM = '#,##0;[Red]-#,##0'
HEAD_FILL = PatternFill("solid", fgColor="1F4E78")
HEAD_FONT = Font(bold=True, color="FFFFFF")
TOTAL_FILL = PatternFill("solid", fgColor="DDEBF7")
THIN = Side(style="thin", color="B7B7B7")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def day(ts: int) -> str:
    return datetime.fromtimestamp(ts, TASHKENT).strftime("%d.%m.%Y")


def _sum(x) -> int:
    return int((x or {}).get("sum") or 0)


# ---------- umumiy qarzlar ----------

def debts(clients_ext: list[dict]) -> list[dict]:
    rows = []
    for c in clients_ext:
        sales, ret = _sum(c.get("sales")), _sum(c.get("return_sales"))
        paid, given = _sum(c.get("debit")), _sum(c.get("credit"))
        rows.append({
            "id": c["_id"], "name": c.get("name", ""), "phones": ", ".join(c.get("phones") or []),
            "sales": sales, "returns": ret, "paid": paid, "given": given,
            "debt": sales - ret - paid + given,  # sof qarz
            "unpaid_docs": int(c.get("debt") or 0),
            "last_sale": (c.get("sales") or {}).get("last_date") or 0,
        })
    rows.sort(key=lambda r: -r["debt"])
    return rows


# ---------- akt sverka ----------

def movements(docs: list[dict], money: list[dict]) -> list[dict]:
    """Mijoz bilan barcha harakatlar (sana bo'yicha). kind: sale | return | payment | given;
    src/id - bazadagi yozuv (tahrirlash uchun): src='doc' (sotuv hujjati) yoki 'money' (kirim/chiqim)."""
    moves = []
    for d in docs:
        if d.get("deleted") or d.get("status") is False or not d.get("sum"):
            continue
        base = {"ts": d["date"], "date": day(d["date"]), "src": "doc", "id": d.get("_id"), "doc_type": d.get("type"),
                "number": d.get("number"), "comment": (d.get("comment") or "")[:120]}
        if d.get("type") == "sales":
            moves.append({**base, "kind": "sale", "what": f"Yuk berildi (sotuv №{d.get('number')})",
                          "plus": int(d["sum"]), "minus": 0})
        elif d.get("type") == "return_sales":
            moves.append({**base, "kind": "return", "what": f"Qaytarildi №{d.get('number')}",
                          "plus": 0, "minus": int(d["sum"])})
    for m in money:
        if m.get("deleted") or m.get("status") is False or not m.get("sum"):
            continue
        base = {"ts": m["date"], "date": day(m["date"]), "src": "money", "id": m.get("_id"), "doc_type": m.get("type"),
                "number": m.get("number"), "comment": (m.get("comment") or "")[:120]}
        if m.get("type") == "debit":
            moves.append({**base, "kind": "payment", "what": f"Pul olindi (kirim №{m.get('number')})",
                          "plus": 0, "minus": int(m["sum"])})
        elif m.get("type") == "credit":
            moves.append({**base, "kind": "given", "what": f"Pul berildi (chiqim №{m.get('number')})",
                          "plus": int(m["sum"]), "minus": 0})
    moves.sort(key=lambda x: x["ts"])
    return moves

def akt(client: dict, docs: list[dict], money: list[dict], start: int, end: int) -> dict:
    """Davr uchun akt sverka: boshlang'ich qoldiq, har bir harakat (yuk berildi / pul olindi), yakuniy qoldiq."""
    rows_all = movements(docs, money)
    opening = sum(r["plus"] - r["minus"] for r in rows_all if r["ts"] < start)
    bal, rows = opening, []
    for r in rows_all:
        if start <= r["ts"] <= end:
            bal += r["plus"] - r["minus"]
            rows.append({**r, "balance": bal})
    after = sum(r["plus"] - r["minus"] for r in rows_all if r["ts"] > end)
    return {
        "client": {"id": client["_id"], "name": client.get("name", ""), "phones": ", ".join(client.get("phones") or [])},
        "start": day(start), "end": day(end), "opening": opening, "rows": rows,
        "total_plus": sum(r["plus"] for r in rows), "total_minus": sum(r["minus"] for r in rows),
        "closing": bal, "current": bal + after,
    }


# ---------- Excel ----------

def _header(ws, row: int, titles: list[str]):
    for i, t in enumerate(titles, 1):
        c = ws.cell(row=row, column=i, value=t)
        c.fill, c.font, c.border = HEAD_FILL, HEAD_FONT, BORDER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)


def _widths(ws, widths: list[int]):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def _bytes(wb) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def debts_xlsx(rows: list[dict], only_debtors: bool = True) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Qarzlar"
    now = datetime.now(TASHKENT).strftime("%d.%m.%Y %H:%M")
    ws["A1"] = "Xaridorlar qarzlari"
    ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = f"Holat: {now} (CloudShop ma'lumotlari)"
    titles = ["№", "Xaridor", "Telefon", "Jami yuk berilgan", "Qaytarilgan", "Jami olingan pul",
              "Berilgan pul", "SOF QARZ", "To'lanmagan hujjatlar (CloudShop)", "Oxirgi yuk sanasi"]
    _header(ws, 4, titles)
    data = [r for r in rows if r["debt"] > 0] if only_debtors else rows
    r = 4
    for i, d in enumerate(data, 1):
        r += 1
        vals = [i, d["name"], d["phones"], d["sales"], d["returns"], d["paid"], d["given"], d["debt"],
                d["unpaid_docs"], day(d["last_sale"]) if d["last_sale"] else ""]
        for col, v in enumerate(vals, 1):
            c = ws.cell(row=r, column=col, value=v)
            c.border = BORDER
            if col in (4, 5, 6, 7, 8, 9):
                c.number_format = NUM
        ws.cell(row=r, column=8).font = Font(bold=True)
    r += 1
    ws.cell(row=r, column=2, value=f"JAMI ({len(data)} ta xaridor)")
    for col in (4, 5, 6, 7, 8, 9):
        L = get_column_letter(col)
        ws.cell(row=r, column=col, value=f"=SUM({L}5:{L}{r - 1})").number_format = NUM
    for col in range(1, len(titles) + 1):
        c = ws.cell(row=r, column=col)
        c.fill, c.font, c.border = TOTAL_FILL, Font(bold=True), BORDER
    ws.freeze_panes = "C5"
    ws.auto_filter.ref = f"A4:{get_column_letter(len(titles))}{r - 1}"
    _widths(ws, [5, 38, 18, 16, 13, 16, 13, 16, 18, 13])
    return _bytes(wb)


def akt_xlsx(a: dict) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Akt sverka"
    ws["A1"] = "AKT SVERKA (o'zaro hisob-kitoblarni solishtirish dalolatnomasi)"
    ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = f"Xaridor: {a['client']['name']}" + (f"   Tel: {a['client']['phones']}" if a['client']['phones'] else "")
    ws["A3"] = f"Davr: {a['start']} — {a['end']}"
    ws["A2"].font = ws["A3"].font = Font(bold=True)
    titles = ["Sana", "Hujjat / harakat", "Yuk berildi (qarz +)", "Pul olindi (qarz −)", "Qarz qoldig'i", "Izoh"]
    _header(ws, 5, titles)
    r = 6
    ws.cell(row=r, column=1, value=a["start"])
    ws.cell(row=r, column=2, value="Boshlang'ich qoldiq")
    ws.cell(row=r, column=5, value=a["opening"]).number_format = NUM
    for col in range(1, 7):
        c = ws.cell(row=r, column=col)
        c.font, c.fill, c.border = Font(bold=True), TOTAL_FILL, BORDER
    for row in a["rows"]:
        r += 1
        vals = [row["date"], row["what"], row["plus"] or None, row["minus"] or None, row["balance"], row["comment"]]
        for col, v in enumerate(vals, 1):
            c = ws.cell(row=r, column=col, value=v)
            c.border = BORDER
            if col in (3, 4, 5):
                c.number_format = NUM
    r += 1
    ws.cell(row=r, column=2, value="Davr bo'yicha jami")
    ws.cell(row=r, column=3, value=a["total_plus"]).number_format = NUM
    ws.cell(row=r, column=4, value=a["total_minus"]).number_format = NUM
    r += 1
    ws.cell(row=r, column=1, value=a["end"])
    ws.cell(row=r, column=2, value="Yakuniy qoldiq (qarz)")
    ws.cell(row=r, column=5, value=a["closing"]).number_format = NUM
    for rr in (r - 1, r):
        for col in range(1, 7):
            c = ws.cell(row=rr, column=col)
            c.font, c.fill, c.border = Font(bold=True), TOTAL_FILL, BORDER
    r += 2
    who = "xaridor bizga" if a["closing"] >= 0 else "biz xaridorga"
    ws.cell(row=r, column=1, value=f"{a['end']} holatiga {who} {abs(a['closing']):,} so'm qarzdor.".replace(",", " "))
    ws.cell(row=r, column=1).font = Font(bold=True)
    r += 3
    ws.cell(row=r, column=1, value="Sotuvchi: ____________________")
    ws.cell(row=r, column=4, value="Xaridor: ____________________")
    ws.freeze_panes = "A6"
    _widths(ws, [12, 34, 18, 18, 17, 40])
    return _bytes(wb)
