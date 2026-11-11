"""
CloudShop API (api.cloudshop.ru) bilan ishlash - web-beta.cloudshop.ru sayti ishlatadigan so'rovlar.

  POST /auth/login {email, password}        -> data.access_token, data.refresh_token
  POST /auth/refresh {refresh_token}
  GET  /profile                             -> kompaniya (client) id
  GET  /data/<client>/clients/              -> mijozlar (kontragentlar), telefonlari bilan
  GET  /data/<client>/accounts              -> hisoblar (Наличные va h.k.)
  POST /search/money/<client>/0/N           -> pul harakatlari (filtr: contragent, type)
  POST /money/<client>/                     -> yangi kirim (Idempotency-Key bilan)
"""
import asyncio
import time

import aiohttp

API = "https://api.cloudshop.ru"
# Saytning ochiq JS kodidagi ilova kaliti (har bir brauzer so'rovida yuboriladi)
APP_KEY = "QEYUeeP4fhvtt34n7PDTl8pb3bk2oB4W"
SOURCE_CLIENT_PAYMENT = 100  # To'lov toifasi: "Оплата от клиента"
TZ_SECONDS = 5 * 3600  # Toshkent


class CloudShopError(Exception):
    pass


class CloudShop:
    def __init__(self, email: str, password: str, account_id: str | None = None, company: str | None = None):
        self.email, self.password = email, password
        self.account_id = account_id
        self.access = self.refresh = None
        self.company = company
        self._clients: list[dict] = []
        self._clients_at = 0.0
        self.session: aiohttp.ClientSession | None = None

    def _headers(self):
        h = {"Accept": "application/json", "Content-Type": "application/json",
             "CloudShop-Key": APP_KEY, "Cloudshop-Timezone": str(TZ_SECONDS)}
        if self.access:
            h["Authorization"] = f"Bearer {self.access}"
        return h

    async def _raw(self, method, path, body=None, headers=None):
        if self.session is None:
            self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
        async with self.session.request(method, API + path, json=body,
                                        headers={**self._headers(), **(headers or {})}) as r:
            try:
                data = await r.json(content_type=None)
            except Exception:
                data = {"status": False, "error": f"HTTP {r.status}"}
            return r.status, data

    async def login(self):
        status, data = await self._raw("POST", "/auth/login", {"email": self.email, "password": self.password})
        if status != 200 or not data.get("status"):
            raise CloudShopError(f"CloudShop login xato: {data.get('error') or status}")
        self.access, self.refresh = data["data"]["access_token"], data["data"]["refresh_token"]
        if not self.company:
            _, prof = await self._raw("GET", "/profile")
            p = prof["data"][0] if isinstance(prof.get("data"), list) else prof["data"]
            self.company = next(iter(p.get("positions") or {}), None) or p.get("_client")
            if not self.company:
                raise CloudShopError("CloudShop: kompaniya id topilmadi")

    async def _refresh(self):
        if self.refresh:
            status, data = await self._raw("POST", "/auth/refresh", {"refresh_token": self.refresh})
            if status == 200 and data.get("status"):
                self.access = data["data"]["access_token"]
                self.refresh = data["data"].get("refresh_token", self.refresh)
                return
        await self.login()

    async def call(self, method, path, body=None, headers=None):
        if not self.access:
            await self.login()
        path = path.replace(":client", self.company)
        status, data = await self._raw(method, path, body, headers)
        # Token eskirganda CloudShop 401 emas, {"status": false, "error": 501} ham qaytaradi -
        # shuning uchun har qanday xatoda tokenni yangilab bir marta qayta urinamiz
        if status >= 400 or data.get("status") is False:
            print(f"CloudShop {method} {path}: {data.get('error') or status} - token yangilanib qayta urinilmoqda")
            await self._refresh()
            status, data = await self._raw(method, path, body, headers)
        if status >= 400 or data.get("status") is False:
            raise CloudShopError(f"CloudShop {method} {path}: {data.get('error') or status}")
        return data

    async def clients(self, max_age=600) -> list[dict]:
        if time.time() - self._clients_at > max_age:
            data = await self.call("GET", "/data/:client/clients/")
            self._clients = [c for c in data["data"] if not c.get("deleted")]
            self._clients_at = time.time()
        return self._clients

    async def clients_extended(self) -> list[dict]:
        """Hamma mijozlar statistikasi bilan (sotuv, qaytarish, olingan/berilgan pul, debt)."""
        data = await self.call("GET", "/data/:client/clients/extended/")
        return [c for c in data["data"] if not c.get("deleted")]

    async def _search_all(self, kind: str, body: dict, limit: int = 100, max_rows: int = 20000) -> list[dict]:
        rows, off = [], 0
        while off < max_rows:
            data = await self.call("POST", f"/search/{kind}/:client/{off}/{limit}", body)
            page = data.get("data") or []
            rows += page
            if len(page) < limit:
                break
            off += limit
        return rows

    async def client_docs(self, client_id: str, end: int) -> list[dict]:
        """Mijozga tegishli hujjatlar (sotuv = yuk berish, qaytarish)."""
        return await self._search_all("docs", {"contractor": client_id, "start": 0, "end": end})

    async def client_money(self, client_id: str, end: int) -> list[dict]:
        """Mijoz bilan pul harakatlari (debit - olingan, credit - berilgan)."""
        return await self._search_all("money", {"contragent": client_id, "start": 0, "end": end})

    async def default_account(self) -> str:
        if not self.account_id:
            data = await self.call("GET", "/data/:client/accounts")
            acc = [a for a in data["data"] if not a.get("deleted") and a.get("type") != "register"]
            self.account_id = next((a["_id"] for a in acc if a.get("default")), acc[0]["_id"])
        return self.account_id

    async def last_payments(self, client_id: str, n=5) -> list[dict]:
        data = await self.call("POST", f"/search/money/:client/0/{n}",
                               {"contragent": client_id, "start": 0, "end": int(time.time()), "type": "debit"})
        return [m for m in data.get("data") or [] if not m.get("deleted")]

    async def create_income(self, *, client: dict, amount: int, date_ts: int, comment: str, uuid: str) -> dict:
        body = {
            "date": date_ts, "type": "debit", "source": SOURCE_CLIENT_PAYMENT,
            "store": await self.default_account(),
            "contragent": {"_id": client["_id"], "name": client["name"], "type": "clients"},
            "sum": amount, "status": True, "comment": comment, "uuid": uuid,
        }
        data = await self.call("POST", "/money/:client/", body, {"Idempotency-Key": uuid})
        order_id = data.get("data")
        if isinstance(order_id, list):  # API ba'zan [id] yoki [kirim] qaytaradi
            order_id = order_id[0] if order_id else None
        if isinstance(order_id, dict):
            order_id = order_id.get("_id")
        if isinstance(order_id, str):
            return (await self.call("GET", f"/money/:client/{order_id}"))["data"]
        return order_id or {}

    # ---------- ma'lumotnomalar (qo'lda kirim/chiqim va tovar hujjatlari uchun) ----------

    async def refs(self) -> dict:
        acc, src, sup, cat = await asyncio.gather(
            self.call("GET", "/data/:client/accounts"), self.call("GET", "/data/:client/sources"),
            self.call("GET", "/data/:client/suppliers"), self._catalog())
        return {
            "accounts": [{"id": a["_id"], "name": a["name"], "default": bool(a.get("default"))}
                         for a in acc["data"] if not a.get("deleted") and a.get("type") != "register"],
            "sources": [{"id": s["id"], "type": s["type"], "title": s["title"]} for s in src["data"]],
            "suppliers": [{"id": s["_id"], "name": s["name"]} for s in sup["data"] if not s.get("deleted")],
            "catalog": cat,
        }

    async def _catalog(self) -> list[dict]:
        rows, off = [], 0
        while True:
            data = await self.call("GET", f"/data/:client/catalog/?limit=500&offset={off}")
            page = data.get("data") or []
            rows += page
            if len(page) < 500:
                break
            off += 500
        return [{"id": p["_id"], "name": p["name"], "type": p.get("type"), "unit": p.get("unit") or "",
                 "price": p.get("price") or 0, "purchase": p.get("purchase") or 0, "cost": p.get("cost") or 0,
                 "stock": p.get("stock") or {}, "sku": p.get("sku") or "", "barcode": p.get("barcode") or "",
                 "categories": p.get("categories") or []}
                for p in rows if not p.get("deleted") and p.get("type") != "group"]

    async def create_money(self, *, kind: str, account: dict, source: int, contragent: dict, amount: int,
                           date_ts: int, comment: str, uuid: str, doc_id: str | None = None) -> dict:
        """Qo'lda pul kirimi (debit) yoki chiqimi (credit). contragent: {_id, name, type: clients|suppliers}."""
        body = {"date": date_ts, "type": kind, "source": source, "store": account["id"],
                "contragent": contragent, "sum": amount, "status": True, "comment": comment, "uuid": uuid}
        if doc_id:
            body["_doc"] = doc_id
        data = await self.call("POST", "/money/:client/", body, {"Idempotency-Key": uuid})
        return await self._created("money", data)

    async def create_doc(self, *, kind: str, store: dict, contragent: dict, items: list[dict], catalog: dict,
                         date_ts: int, comment: str, uuid: str) -> dict:
        """Tovar hujjati: kind='sales' (ombordan xaridorga, qty manfiy) yoki 'purchases' (yetkazib beruvchidan omborga).
        items: [{id, qty, price}], catalog: id -> tovar (refs()['catalog'] dan)."""
        sign = -1 if kind == "sales" else 1
        products, total_qty, total = [], 0, 0
        for it in items:
            p = catalog[it["id"]]
            qty, price = float(it["qty"]), int(it["price"])
            qty = int(qty) if qty.is_integer() else round(qty, 3)  # CloudShop butun miqdorni int saqlaydi
            line = int(round(price * qty))
            products.append({
                "_id": p["id"], "qty": sign * qty, "price": price, "sum": line, "sub": line,
                "discount_sum": 0, "discount_percent": 0, "taxes": [], "tax_total": 0,
                "prices": {"cost": p["cost"], "price": p["price"], "purchase": p["purchase"]},
                "product": {"name": p["name"], "type": p["type"], "sku": p["sku"], "barcode": p["barcode"],
                            "unit": p["unit"], "categories": p["categories"]},
            })
            total_qty += sign * qty
            total += line
        store_ref = {"_id": store["id"], "name": store["name"], "type": "stores"}
        body = {
            "date": date_ts, "status": True, "state": None, "comment": comment, "uuid": uuid,
            "from": store_ref if kind == "sales" else contragent,
            "to": contragent if kind == "sales" else store_ref,
            "store": store["id"], "products": products, "qty": total_qty, "sum": total, "sub": total,
            "discount_percent": 0, "discount_sum": 0, "taxes": [], "tax_total": 0, "tax_type": "include",
            "type": kind, "sub_type": None,
        }
        if kind == "sales":
            body["price"] = "price"
        data = await self.call("POST", f"/docs/:client/{kind}/", body, {"Idempotency-Key": uuid})
        return await self._created("docs", data)

    async def _created(self, kind: str, data: dict) -> dict:
        """POST javobidan yaratilgan yozuvni olish (javob id, [id], obyekt yoki [obyekt] bo'lishi mumkin)."""
        x = data.get("data")
        if isinstance(x, list):
            x = x[0] if x else None
        if isinstance(x, dict) and x.get("number") is not None:
            return x
        oid = x.get("_id") if isinstance(x, dict) else x
        if not isinstance(oid, str):
            return {}
        got = (await self.call("GET", f"/{kind}/:client/{oid}" + ("?v=v3" if kind == "docs" else "")))["data"]
        return (got[0] if isinstance(got, list) and got else got) or {"_id": oid}

    # ---------- tahrirlash (sverka solishtiruvidan) ----------

    async def get_money(self, order_id: str) -> dict:
        d = (await self.call("GET", f"/money/:client/{order_id}"))["data"]
        return d[0] if isinstance(d, list) else d

    async def update_money(self, order_id: str, **changes) -> dict:
        """Sayt kabi: PUT /money/<co>/<id>, body - kirimning asosiy maydonlari (o'zgartirilgan)."""
        o = await self.get_money(order_id)
        keep = ("date", "type", "source", "store", "contragent", "sum", "status", "number", "comment",
                "_doc", "_register", "_shift", "period_id")
        body = {k: o[k] for k in keep if k in o and o[k] is not None}
        body.update(changes)
        await self.call("PUT", f"/money/:client/{order_id}", body)
        return await self.get_money(order_id)

    async def delete_income(self, order_id: str):
        """Kirimni o'chirish (sayt ham shunday qiladi: DELETE + kirimning o'zi body'da)."""
        order = (await self.call("GET", f"/money/:client/{order_id}"))["data"]
        await self.call("DELETE", f"/money/:client/{order_id}", order)
