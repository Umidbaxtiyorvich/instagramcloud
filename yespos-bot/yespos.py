"""YesPOS (app.yespos.uz) API mijozi.

Endpointlar app.yespos.uz veb-ilovasi ishlatadigan ichki API'dan olingan.
Barcha javoblar {"code": 0, "message": "OK", "data": ...} ko'rinishida.
"""
import asyncio
import json
import logging
import os
import socket
from datetime import datetime

import httpx

import config

log = logging.getLogger("yespos")
SESSION_FILE = os.path.join(config.DATA_DIR, "session.json")


class YesPosError(Exception):
    pass


def ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


class YesPos:
    def __init__(self):
        # ulanish uchun 15 s: YesPOS serveri javob bermasa, sahifa va bot uzoq osilib qolmasin
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15))
        self.token = None
        self.session_id = None
        self.base_url = None
        self._lock = asyncio.Lock()
        self._load_session()

    # ---------- auth ----------
    def _load_session(self):
        try:
            with open(SESSION_FILE, encoding="utf-8") as f:
                s = json.load(f)
            self.token, self.session_id, self.base_url = s["token"], s["session_id"], s["base_url"]
        except Exception:
            pass

    def _save_session(self):
        with open(SESSION_FILE, "w", encoding="utf-8") as f:
            json.dump({"token": self.token, "session_id": self.session_id, "base_url": self.base_url}, f)

    async def login(self):
        body = {
            "org_id": config.YESPOS_ORG_ID,
            "login": config.YESPOS_LOGIN,
            "password": config.YESPOS_PASSWORD,
            "device": {"device": f"TelegramBot ({socket.gethostname()})", "ip": "127.0.0.1"},
        }
        r = await self.client.post(f"{config.YESPOS_AUTH_URL}/signIn", json=body)
        if r.status_code == 429:
            raise YesPosError("Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring.")
        data = r.json()
        if data.get("code") != 0:
            raise YesPosError("YesPOS login yoki parol noto'g'ri (.env faylni tekshiring)")
        d = data["data"]
        self.token = d["token"]
        self.session_id = (d.get("active_session") or {}).get("id")
        self.base_url = d["base_url"].rstrip("/") + "/"
        self._save_session()
        log.info("YesPOS'ga kirildi: %s", d.get("business_name"))

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "X-Session-ID": str(self.session_id),
            "branch": str(config.YESPOS_BRANCH),
            "Base-URL": self.base_url,
        }

    async def request(self, method: str, path: str, params=None, body=None):
        async with self._lock:
            if not self.token:
                await self.login()
        for attempt in range(2):
            try:
                r = await self.client.request(
                    method, self.base_url + path, params=params, json=body, headers=self._headers()
                )
            except httpx.TimeoutException:
                raise YesPosError("YesPOS serveri javob bermayapti (ulanish vaqti tugadi). Birozdan so'ng urinib ko'ring.")
            except httpx.TransportError as e:
                raise YesPosError(f"YesPOS serveriga ulanib bo'lmadi: {e.__class__.__name__}")
            new_token = r.headers.get("X-Refresh-Token")
            if new_token and new_token != self.token:
                self.token = new_token
                self._save_session()
            if r.status_code in (401, 403) and attempt == 0:
                async with self._lock:
                    await self.login()
                continue
            break
        try:
            data = r.json()
        except Exception:
            raise YesPosError(f"{path}: HTTP {r.status_code}")
        if r.status_code >= 400 or data.get("code", 0) not in (0, 2000):
            raise YesPosError(f"{path}: {data.get('message') or r.status_code}")
        return data

    async def get(self, path, **params):
        return (await self.request("GET", path, params=params))["data"]

    async def post(self, path, body):
        return await self.request("POST", path, body=body)

    # ---------- o'qish ----------
    async def sales_report(self, frm: datetime, to: datetime):
        return await self.get("salesReport", fromDate=ms(frm), toDate=ms(to), branch=config.YESPOS_BRANCH)

    async def sales_by_payment_types(self, frm: datetime, to: datetime):
        return await self.get("salesByPaymentTypes", fromDate=ms(frm), toDate=ms(to), branch=config.YESPOS_BRANCH)

    def _rep_params(self, frm: datetime, to: datetime):
        return dict(fromDate=ms(frm), toDate=ms(to), branch=config.YESPOS_BRANCH, employee="", agent="")

    async def sales_chart(self, frm: datetime, to: datetime):
        return await self.get("salesChartData", **self._rep_params(frm, to)) or []

    async def payments_by_day(self, frm: datetime, to: datetime):
        return await self.get("paymentsByDay", **self._rep_params(frm, to)) or []

    async def payments_by_hour(self, frm: datetime, to: datetime):
        return await self.get("paymentsByHour", **self._rep_params(frm, to)) or []

    async def stock_items(self, stock: str | None = None, key: str = ""):
        """Ombor qoldiqlari. stock='negative' -> faqat minus tovarlar."""
        items, offset, limit = [], 0, 500
        while True:
            params = dict(limit=limit, offset=offset, key=key, priceType=config.YESPOS_PRICE_TYPE, category="")
            if stock:
                params["stock"] = stock
            d = await self.get("stockReport", **params)
            items += d.get("items") or []
            offset += limit
            if offset >= (d.get("count") or 0) or not d.get("items"):
                return items, d

    async def sold_items(self, frm: datetime, to: datetime):
        items, offset, limit = [], 0, 500
        while True:
            d = await self.get("soldItemsReport", fromDate=ms(frm), toDate=ms(to), limit=limit, offset=offset)
            items += d.get("items") or []
            offset += limit
            if offset >= (d.get("count") or 0) or not d.get("items"):
                return items

    async def abc_report(self, frm: datetime, to: datetime):
        return await self.get("abcReport", fromDate=ms(frm), toDate=ms(to)) or []

    async def clients_debit_credit(self, frm: datetime, to: datetime):
        return await self.get("clientsDebitCredit", key="", fromDate=ms(frm), toDate=ms(to))

    async def client_history(self, client_id: int):
        return await self.get("clientDebitCredits", id=client_id)

    async def suppliers_debit_credit(self, frm: datetime, to: datetime):
        return await self.get("suppliersDebitCredit", key="", fromDate=ms(frm), toDate=ms(to))

    async def supplier_history(self, supplier_id: int):
        return await self.get("supplierDebitCredit", supplier=supplier_id)

    async def search_suppliers(self, key: str, limit: int = 10):
        d = await self.get("suppliers", limit=limit, offset=0, key=key)
        return d.get("suppliers") or []

    async def search_items(self, key: str):
        return await self.get("searchItems", key=key[:200], priceType=config.YESPOS_PRICE_TYPE,
                              branch=config.YESPOS_BRANCH) or []

    async def purchase_order(self, doc_id: int):
        return await self.get("purchOrder", id=doc_id)

    async def supplier_purchase_orders(self, supplier_id: int):
        d = await self.get("purchOrders", limit=5000, offset=0, key="", supplier=supplier_id, employee="",
                           fromDate=ms(datetime(2020, 1, 1, tzinfo=config.TZ)), toDate=ms(datetime.now(config.TZ)),
                           status="", type="", branch=config.YESPOS_BRANCH, showPays=1, byCreatedDate=0)
        return d.get("purch_orders") or []

    async def payment_types(self):
        return [p for p in (await self.get("payment-types") or []) if p.get("is_enable") and not p.get("is_delete")]

    async def supplier_payments(self, frm: datetime, to: datetime, limit=50):
        d = await self.get("paysBySupplier", fromDate=ms(frm), toDate=ms(to), limit=limit, offset=0)
        return d.get("pays") or []

    # ---------- yozish ----------
    async def pay_to_supplier(self, supplier_id: int, value: float, payment_type: int, comment: str = ""):
        body = {"payment_type": int(payment_type), "supplier": int(supplier_id), "value": float(value)}
        if comment:
            body["comment"] = comment
        return await self.post("payToSupplier", body)

    async def pay_by_purchase(self, doc_id: int, value: float, payment_type: int, when: datetime, comment: str = ""):
        """Kirim hujjatiga bog'langan to'lov — sana bilan saqlanadi (YesPOS vaqtni mahalliy saqlaydi)."""
        return await self.post("pay-to-supplier-by-purchase", {
            "payment_type": int(payment_type), "value": float(value), "comment": comment,
            "created_date": when.astimezone(config.TZ).strftime("%Y-%m-%d %H:%M:%S"), "document": int(doc_id),
        })

    async def create_purchase(self, supplier_id: int, items: list[dict], note: str = "",
                              when: datetime | None = None):
        """Tovar kirimi (prixod). items: [{item, qty, cost, price, unit_type}]"""
        body = {
            "note": note,
            "currency": 1,
            "supplier": int(supplier_id),
            "type": 1,
            "created_date": ms(when or datetime.now(config.TZ)),
            "items": [{
                "item": it["item"],
                "qty": float(it["qty"]),
                "cost": round(float(it["cost"]), 2),
                "price_type": config.YESPOS_PRICE_TYPE,
                "marks": None,
                "unit_type": it.get("unit_type"),
                "expiry_date": 0,
                "price": float(it["price"]),
            } for it in items],
        }
        res = await self.post("purchOrder", body)
        doc_id = _extract_id(res.get("data"))
        if doc_id:
            await self.post("performPurchOrder", {"id": doc_id})
        return doc_id

    async def create_write_off(self, items: list[dict], adj_type: int = 8, note: str = ""):
        """Tovar chiqimi (spisanie). adj_type: 8 - yo'qotish, 9 - buzilgan tovar. items: [{item, qty}]"""
        body = {
            "note": note,
            "branch": config.YESPOS_BRANCH,
            "price_type": config.YESPOS_PRICE_TYPE,
            "type": adj_type,
            "items": [{"item": it["item"], "remove_stock": float(it["qty"])} for it in items],
        }
        res = await self.post("stockAdjustment", body)
        doc_id = _extract_id(res.get("data"))
        if doc_id:
            await self.post("performStockAdjustment", {"id": doc_id})
        return doc_id


def _extract_id(data):
    if isinstance(data, int):
        return data
    if isinstance(data, dict):
        return data.get("id")
    return None


api = YesPos()
