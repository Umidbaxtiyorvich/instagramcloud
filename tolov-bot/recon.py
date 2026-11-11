"""
Xaridor bergan sverka (AI o'qigan qatorlar) bilan bazadagi (CloudShop) harakatlarni solishtirish.

Har bir natija qatori holati:
  ok          - mos (tur, summa bir xil, sana +-1 kun)
  date        - summa mos, sana farq qiladi (2..7 kun)
  amount      - sana mos (+-1 kun), summa farq qiladi
  theirs_only - xaridorning sverkasida bor, bazada yo'q
  ours_only   - bazada bor (xaridor sverkasi davrida), xaridorda yo'q
"""
from datetime import datetime, timezone, timedelta

TASHKENT = timezone(timedelta(hours=5))
DAY = 86400
SIGN = {"sale": 1, "given": 1, "payment": -1, "return": -1}


def _ts(date: str) -> int | None:
    try:
        return int(datetime.strptime(date, "%Y-%m-%d").replace(hour=12, tzinfo=TASHKENT).timestamp())
    except (ValueError, TypeError):
        return None


def _day(ts: int) -> str:
    return datetime.fromtimestamp(ts, TASHKENT).strftime("%d.%m.%Y")


def _days(a: int, b: int) -> float:
    return abs(a - b) / DAY


def compare(theirs: list[dict], ours: list[dict]) -> dict:
    """theirs: [{date: YYYY-MM-DD, kind, amount, note, doc_no, sure}], ours: reports.movements() natijasi."""
    t_rows = []
    for i, r in enumerate(theirs):
        ts = _ts(r.get("date"))
        if ts and int(r.get("amount") or 0) > 0:
            t_rows.append({**r, "i": i, "ts": ts, "amount": int(r["amount"])})
    if not t_rows:
        return {"items": [], "summary": None}
    lo, hi = min(r["ts"] for r in t_rows) - 3 * DAY, max(r["ts"] for r in t_rows) + 3 * DAY
    o_rows = [{**r, "amount": r["plus"] or r["minus"]} for r in ours if lo <= r["ts"] <= hi]
    used_t, used_o, items = set(), set(), []

    def kinds_match(t, o):
        return t["kind"] == o["kind"] or (t["kind"] == "other")

    def take(pred, status):
        pairs = []
        for t in t_rows:
            if t["i"] in used_t:
                continue
            cands = [o for o in o_rows if id(o) not in used_o and kinds_match(t, o) and pred(t, o)]
            if cands:
                o = min(cands, key=lambda o: (_days(t["ts"], o["ts"]), abs(t["amount"] - o["amount"])))
                used_t.add(t["i"]); used_o.add(id(o))
                if t["kind"] == "other":  # turi noma'lum qator - bazadagi juftining turini oladi (jamilar uchun)
                    t["kind"] = o["kind"]
                pairs.append((t, o))
        for t, o in pairs:
            items.append(_item(status, t, o))

    take(lambda t, o: t["amount"] == o["amount"] and _days(t["ts"], o["ts"]) <= 1.5, "ok")
    take(lambda t, o: t["amount"] == o["amount"] and _days(t["ts"], o["ts"]) <= 7.5, "date")
    take(lambda t, o: _days(t["ts"], o["ts"]) <= 1.5, "amount")
    for t in t_rows:
        if t["i"] not in used_t:
            items.append(_item("theirs_only", t, None))
    for o in o_rows:
        if id(o) not in used_o:
            items.append(_item("ours_only", None, o))
    items.sort(key=lambda x: (x["ts"], x["status"] != "ok"))

    def total(rows, key, kinds):
        return sum(r[key] for r in rows if r.get("kind") in kinds)
    their_range = [o for o in o_rows if min(r["ts"] for r in t_rows) - DAY <= o["ts"] <= max(r["ts"] for r in t_rows) + DAY]
    summary = {
        "from": _day(min(r["ts"] for r in t_rows)), "to": _day(max(r["ts"] for r in t_rows)),
        "theirs": {"sales": total(t_rows, "amount", {"sale"}), "payments": total(t_rows, "amount", {"payment"})},
        "ours": {"sales": total(their_range, "amount", {"sale"}), "payments": total(their_range, "amount", {"payment"})},
        "counts": {s: sum(1 for x in items if x["status"] == s)
                   for s in ("ok", "date", "amount", "theirs_only", "ours_only")},
    }
    return {"items": items, "summary": summary}


def _item(status: str, t: dict | None, o: dict | None) -> dict:
    return {
        "status": status,
        "kind": (o or t)["kind"] if (o or t)["kind"] != "other" or not o else o["kind"],
        "ts": (t or o)["ts"],
        "theirs": None if not t else {"date": _day(t["ts"]), "iso": datetime.fromtimestamp(t["ts"], TASHKENT).strftime("%Y-%m-%d"),
                                      "amount": t["amount"], "note": t.get("note") or "", "doc_no": t.get("doc_no") or "",
                                      "sure": t.get("sure", True), "kind": t["kind"]},
        "ours": None if not o else {"id": o["id"], "src": o["src"], "doc_type": o.get("doc_type"), "number": o.get("number"),
                                    "date": o["date"], "iso": datetime.fromtimestamp(o["ts"], TASHKENT).strftime("%Y-%m-%d"),
                                    "amount": o["amount"], "what": o["what"], "comment": o.get("comment") or ""},
    }
