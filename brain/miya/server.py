"""Miya serveri: python -m miya.server  (brain/ papkasidan), so'ng brauzerda http://127.0.0.1:8765"""
import json
import os
import sys
import threading
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import llm, think
from .learn import Learner
from .vault import Vault

HERE = Path(__file__).parent
VAULT = Path(os.environ.get("MIYA_VAULT", HERE.parent / "vault"))
v = Vault(VAULT)
L = Learner(v)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        if u.path == "/":
            return self._send(200, (HERE / "static" / "index.html").read_bytes(), "text/html; charset=utf-8")
        if u.path == "/api/graph":
            return self._send(200, v.graph())
        if u.path == "/api/note":
            n = v.note(q.get("id", ""))
            return self._send(200 if n else 404, n or {"error": "Eslatma topilmadi"})
        if u.path == "/api/status":
            return self._send(200, {"stats": v.stats(), "sources": L.sources, "log": list(L.log)[-40:],
                                    "busy": L.busy.locked(), "vault": str(VAULT), "llm": llm.info()})
        self._send(404, {"error": "topilmadi"})

    def do_POST(self):
        u = urllib.parse.urlsplit(self.path)
        try:
            if u.path == "/api/ask":
                return self._send(200, think.ask(v, self._json().get("q", ""), L))
            if u.path == "/api/source":
                b = self._json()
                url = b.get("url", "").strip()
                if not url.startswith(("http://", "https://")):
                    return self._send(400, {"error": "Manzil http:// yoki https:// bilan boshlanishi kerak"})
                L.add_source(url, int(b.get("max_pages", 20)), float(b.get("every_hours", 24)))
                threading.Thread(target=L.run_due, args=(url,), daemon=True).start()
                return self._send(200, {"ok": True})
            if u.path == "/api/source/delete":
                L.remove_source(self._json().get("url", ""))
                return self._send(200, {"ok": True})
            if u.path == "/api/book":
                name = urllib.parse.unquote(self.headers.get("X-Filename", "kitob.txt"))
                data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                return self._send(200, {"notes": L.read_book(name, data)})
            if u.path == "/api/reload":
                v.load()
                return self._send(200, {"ok": True})
        except Exception as e:
            return self._send(400, {"error": str(e)})
        self._send(404, {"error": "topilmadi"})


def main():
    port = int(os.environ.get("MIYA_PORT", 8765))
    L.start_scheduler()
    url = f"http://127.0.0.1:{port}"
    print(f"Miya ishga tushdi: {url}\nXotira papkasi (Obsidian'da oching): {VAULT}")
    if "--no-browser" not in sys.argv:
        threading.Timer(1, lambda: webbrowser.open(url)).start()
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()


if __name__ == "__main__":
    main()
