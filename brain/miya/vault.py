"""Xotira: Obsidian'ga mos .md eslatmalar papkasi + qidiruv indeksi + graf.

Papkalar: manbalar/ (sayt va kitoblardan), tushunchalar/ (avtomatik), eslatmalar/ (siz yozgan), suhbatlar/ (kunlik).
"""
import datetime as dt
import json
import math
import re
import threading
from collections import Counter, defaultdict
from pathlib import Path

from .text import STOP, norm, stem, terms, words

LINK = re.compile(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]")
BAD = re.compile(r'[\\/*"<>:|?#^\[\]\n\r\t]+')
FOLDERS = {"manbalar": "manba", "tushunchalar": "tushuncha", "eslatmalar": "eslatma", "suhbatlar": "suhbat"}


def slug(s: str, n: int = 80) -> str:
    s = BAD.sub(" ", s).strip(" .") or "nomsiz"
    return re.sub(r"\s+", " ", s)[:n].strip()


def parse(md: str) -> tuple[dict, str]:
    meta = {}
    if md.startswith("---\n"):
        end = md.find("\n---", 4)
        if end > 0:
            for line in md[4:end].splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip()
            md = md[end + 4:].lstrip("\n")
    return meta, md


class Vault:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.lock = threading.RLock()
        for f in FOLDERS:
            (self.root / f).mkdir(parents=True, exist_ok=True)
        (self.root / ".miya").mkdir(exist_ok=True)
        self.notes: dict[str, dict] = {}  # id (fayl nomi) -> {type, title, path, meta, body, links, tf, len}
        self.df = Counter()
        self.load()

    # --- yuklash va indeks ---
    def load(self):
        with self.lock:
            self.notes.clear()
            self.df.clear()
            for folder, typ in FOLDERS.items():
                for p in (self.root / folder).glob("*.md"):
                    self._index(p, typ)

    def _index(self, p: Path, typ: str):
        meta, body = parse(p.read_text(encoding="utf-8"))
        nid = p.stem
        old = self.notes.get(nid)
        if old:
            self.df.subtract(old["tf"].keys())
        tf = Counter(terms(body))
        self.notes[nid] = {"id": nid, "type": typ, "title": meta.get("title", nid), "path": p, "meta": meta,
                           "body": body, "links": sorted(set(LINK.findall(body))), "tf": tf, "len": sum(tf.values())}
        self.df.update(tf.keys())

    def idf(self, t: str) -> float:
        n = len(self.notes) or 1
        return math.log(1 + (n - self.df.get(t, 0) + 0.5) / (self.df.get(t, 0) + 0.5))

    # --- qidiruv (BM25) ---
    def search(self, query: str, k: int = 6, types=("manba", "eslatma", "suhbat")) -> list[tuple[float, dict]]:
        q = terms(query)
        with self.lock:
            notes = [n for n in self.notes.values() if n["type"] in types]
            avg = sum(n["len"] for n in notes) / max(1, len(notes))
            res = []
            for n in notes:
                s = 0.0
                for t in set(q):
                    f = n["tf"].get(t, 0)
                    if f:
                        s += self.idf(t) * f * 2.5 / (f + 1.5 * (0.25 + 0.75 * n["len"] / max(avg, 1)))
                # sarlavhadagi moslik qo'shimcha ball beradi
                s += 0.5 * len(set(q) & set(terms(n["title"])))
                if s > 0:
                    res.append((s, n))
            return sorted(res, key=lambda x: -x[0])[:k]

    # --- tushunchalar ---
    def concepts_for(self, text: str, k: int = 6) -> list[str]:
        """Matndagi eng muhim so'zlar (TF-IDF) — ular graf tugunlariga aylanadi."""
        surface = defaultdict(Counter)
        for w in words(text):
            if len(w) >= 4 and w not in STOP and not w.isdigit():
                surface[stem(w)][w] += 1
        tf = Counter({s: sum(c.values()) for s, c in surface.items()})
        scored = sorted(tf, key=lambda s: -(tf[s] * self.idf(s)))
        names = self._concept_names()
        out = []
        for s in scored:
            if tf[s] < 2 and len(out) >= 3:
                break
            # tushuncha nomi: o'zak (masalan "shaharlardan" -> "shahar"), juda qisqa bo'lsa asl so'z
            out.append(names.get(s) or (s if len(s) >= 4 else surface[s].most_common(1)[0][0]))
            if len(out) >= k:
                break
        return out

    def _concept_names(self) -> dict:
        f = self.root / ".miya" / "concepts.json"
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}

    def _touch_concepts(self, concepts: list[str], note_id: str):
        names = self._concept_names()
        for c in concepts:
            names.setdefault(stem(norm(c)), c)
            p = self.root / "tushunchalar" / f"{slug(c)}.md"
            if p.exists():
                meta, body = parse(p.read_text(encoding="utf-8"))
            else:
                body = f"# {c}\n\nBu tushuncha quyidagi eslatmalarda uchraydi:\n"
            line = f"- [[{note_id}]]"
            if line not in body:
                body = body.rstrip("\n") + "\n" + line + "\n"
                p.write_text(f"---\ntitle: {c}\ntype: tushuncha\n---\n{body}", encoding="utf-8")
                self._index(p, "tushuncha")
        (self.root / ".miya" / "concepts.json").write_text(json.dumps(names, ensure_ascii=False, indent=0), encoding="utf-8")

    # --- yozish ---
    def add(self, folder: str, title: str, body: str, meta: dict | None = None, concepts: bool = True) -> str:
        with self.lock:
            base = slug(title)
            nid, i = base, 2
            while (self.root / folder / f"{nid}.md").exists():
                nid, i = f"{base} {i}", i + 1
            meta = {"title": title, "type": FOLDERS[folder], "sana": dt.datetime.now().isoformat(timespec="minutes"), **(meta or {})}
            cs = self.concepts_for(body) if concepts else []
            links = ("\n\nTushunchalar: " + " ".join(f"[[{slug(c)}]]" for c in cs)) if cs else ""
            front = "".join(f"{k}: {str(v).replace(chr(10), ' ')}\n" for k, v in meta.items())
            p = self.root / folder / f"{nid}.md"
            p.write_text(f"---\n{front}---\n# {title}\n\n{body.strip()}{links}\n", encoding="utf-8")
            self._index(p, FOLDERS[folder])
            if cs:
                self._touch_concepts(cs, nid)
            return nid

    def append_chat(self, q: str, a: str, used: list[str]):
        with self.lock:
            day = dt.date.today().isoformat()
            p = self.root / "suhbatlar" / f"Suhbat {day}.md"
            if not p.exists():
                p.write_text(f"---\ntitle: Suhbat {day}\ntype: suhbat\n---\n# Suhbat {day}\n", encoding="utf-8")
            refs = " ".join(f"[[{u}]]" for u in used)
            t = dt.datetime.now().strftime("%H:%M")
            with p.open("a", encoding="utf-8") as f:
                f.write(f"\n## {t} — {q}\n\n{a}\n" + (f"\nManbalar: {refs}\n" if refs else ""))
            self._index(p, "suhbat")

    # --- graf ---
    def graph(self) -> dict:
        with self.lock:
            ids = set(self.notes)
            deg = Counter()
            edges = []
            for n in self.notes.values():
                for l in n["links"]:
                    if l in ids and l != n["id"]:
                        edges.append([n["id"], l])
                        deg[n["id"]] += 1
                        deg[l] += 1
            nodes = [{"id": n["id"], "title": n["title"], "type": n["type"], "deg": deg[n["id"]]} for n in self.notes.values()]
            return {"nodes": nodes, "edges": edges}

    def note(self, nid: str) -> dict | None:
        n = self.notes.get(nid)
        if not n:
            return None
        back = [m["id"] for m in self.notes.values() if nid in m["links"]]
        return {"id": nid, "title": n["title"], "type": n["type"], "meta": n["meta"], "body": n["body"], "links": n["links"], "backlinks": back}

    def stats(self) -> dict:
        return dict(Counter(n["type"] for n in self.notes.values()))
