"""O'rganish: saytlarni aylanib o'qish, kitoblarni o'qish, jadval bo'yicha o'zi qayta o'rganish."""
import hashlib
import io
import json
import re
import threading
import time
import urllib.parse
import urllib.request
import urllib.robotparser
import zipfile
from collections import deque
from pathlib import Path

from .text import html_to_text
from .vault import Vault

UA = "MiyaBot/1.0 (shaxsiy o'quv dasturi)"
CHUNK = 1800


def chunks(text: str, size: int = CHUNK) -> list[str]:
    """Matnni paragraflar bo'yicha ~size harflik bo'laklarga ajratadi."""
    out, cur = [], ""
    for para in text.split("\n"):
        para = para.strip()
        if not para:
            continue
        if len(cur) + len(para) > size and cur:
            out.append(cur)
            cur = ""
        while len(para) > size * 1.5:
            out.append(para[:size])
            para = para[size:]
        cur = f"{cur}\n\n{para}".strip()
    if cur:
        out.append(cur)
    return out


class Learner:
    def __init__(self, vault: Vault):
        self.v = vault
        self.dir = vault.root / ".miya"
        self.seen_f, self.src_f = self.dir / "seen.json", self.dir / "sources.json"
        self.seen = self._read(self.seen_f, {})
        self.sources = self._read(self.src_f, [])
        self.log: deque = deque(maxlen=200)
        self.busy = threading.Lock()
        self.robots: dict = {}

    @staticmethod
    def _read(p: Path, default):
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return default

    def _save(self):
        self.seen_f.write_text(json.dumps(self.seen, ensure_ascii=False), encoding="utf-8")
        self.src_f.write_text(json.dumps(self.sources, ensure_ascii=False, indent=1), encoding="utf-8")

    def say(self, msg: str):
        self.log.append({"t": time.strftime("%H:%M:%S"), "msg": msg})
        print("[miya]", msg, flush=True)

    # --- bitta matnni xotiraga qo'shish ---
    def ingest_text(self, title: str, text: str, source: str, kind: str) -> int:
        h = hashlib.sha1(text.encode()).hexdigest()
        if self.seen.get(source) == h:
            return 0
        parts = chunks(text)
        for i, part in enumerate(parts):
            t = title if len(parts) == 1 else f"{title} ({i + 1}-qism)"
            self.v.add("manbalar", t, part, {"manba": source, "tur": kind})
        self.seen[source] = h
        self._save()
        return len(parts)

    # --- saytlar ---
    def _allowed(self, url: str) -> bool:
        base = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(url))
        if base not in self.robots:
            rp = urllib.robotparser.RobotFileParser(base + "/robots.txt")
            try:
                rp.read()
            except Exception:
                rp = None
            self.robots[base] = rp
        rp = self.robots[base]
        return True if rp is None else rp.can_fetch(UA, url)

    def fetch(self, url: str) -> tuple[str, str]:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "uz,ru;q=0.8,en;q=0.6"})
        with urllib.request.urlopen(req, timeout=20) as r:
            ctype = r.headers.get("Content-Type", "")
            raw = r.read(5_000_000)
            enc = r.headers.get_content_charset() or "utf-8"
        return ctype, raw.decode(enc, errors="replace")

    def learn_page(self, url: str) -> dict:
        """Bitta sahifani o'qiydi va xotiraga qo'shadi. {title, text, notes, links} qaytaradi."""
        if not self._allowed(url):
            raise RuntimeError("sayt robots.txt orqali o'qishga ruxsat bermagan")
        ctype, html = self.fetch(url)
        if "html" not in ctype and "text" not in ctype:
            raise RuntimeError(f"bu sahifa matn emas ({ctype})")
        title, text, links = html_to_text(html) if "html" in ctype else (url, html, [])
        title = title or url
        n = self.ingest_text(title, text, url, "sayt") if len(text) > 200 else 0
        self.say(f"o'qidim: {title} — {n} ta yangi eslatma" if n else f"yangi narsa yo'q: {title}")
        return {"title": title, "text": text, "notes": n, "links": links}

    def crawl(self, start: str, max_pages: int = 20) -> int:
        """Boshlang'ich sahifadan shu sayt ichidagi havolalar bo'ylab o'qiydi (robots.txt ga rioya qiladi)."""
        host = urllib.parse.urlsplit(start).netloc
        q, visited, learned = deque([start]), set(), 0
        while q and len(visited) < max_pages:
            url = urllib.parse.urldefrag(q.popleft())[0]
            if url in visited:
                continue
            visited.add(url)
            try:
                page = self.learn_page(url)
            except Exception as e:
                self.say(f"o'qib bo'lmadi: {url} ({e})")
                continue
            learned += page["notes"]
            for l in page["links"]:
                u = urllib.parse.urldefrag(urllib.parse.urljoin(url, l))[0]
                if urllib.parse.urlsplit(u).netloc == host and u.startswith("http") and u not in visited \
                        and not re.search(r"\.(jpg|jpeg|png|gif|svg|webp|zip|mp4|mp3|css|js|pdf)$", u, re.I):
                    q.append(u)
            time.sleep(1)  # saytga ortiqcha yuk bermaslik uchun
        return learned

    # --- kitoblar ---
    def read_book(self, name: str, data: bytes) -> int:
        ext = Path(name).suffix.lower()
        title = Path(name).stem
        if ext in (".txt", ".md"):
            text = data.decode("utf-8", errors="replace")
        elif ext in (".html", ".htm"):
            title2, text, _ = html_to_text(data.decode("utf-8", errors="replace"))
            title = title2 or title
        elif ext == ".epub":
            z = zipfile.ZipFile(io.BytesIO(data))
            pages = sorted(n for n in z.namelist() if n.endswith((".xhtml", ".html", ".htm")))
            text = "\n".join(html_to_text(z.read(n).decode("utf-8", errors="replace"))[1] for n in pages)
        elif ext == ".pdf":
            try:
                from pypdf import PdfReader
            except ImportError:
                raise RuntimeError("PDF o'qish uchun: pip install pypdf")
            text = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)
        else:
            raise RuntimeError(f"{ext} formati qo'llab-quvvatlanmaydi (txt, md, html, epub, pdf)")
        n = self.ingest_text(title, text, f"kitob:{name}", "kitob")
        self.say(f"kitob o'qildi: {title} — {n} ta eslatma")
        return n

    # --- jadval: saytlarni o'zi qayta o'rganadi ---
    def add_source(self, url: str, max_pages: int = 20, every_hours: float = 24):
        self.sources = [s for s in self.sources if s["url"] != url]
        self.sources.append({"url": url, "max_pages": max_pages, "every_hours": every_hours, "last": 0})
        self._save()

    def remove_source(self, url: str):
        self.sources = [s for s in self.sources if s["url"] != url]
        self._save()

    def run_due(self, force_url: str | None = None):
        if not self.busy.acquire(blocking=False):
            return
        try:
            for s in list(self.sources):
                due = time.time() - s.get("last", 0) > s["every_hours"] * 3600
                if s["url"] == force_url or (force_url is None and due):
                    self.say(f"o'rganish boshlandi: {s['url']}")
                    n = self.crawl(s["url"], s["max_pages"])
                    s["last"] = time.time()
                    self._save()
                    self.say(f"tugadi: {s['url']} — {n} ta yangi eslatma")
        finally:
            self.busy.release()

    def start_scheduler(self):
        def loop():
            while True:
                try:
                    self.run_due()
                except Exception as e:
                    self.say(f"xato: {e}")
                time.sleep(60)
        threading.Thread(target=loop, daemon=True).start()
