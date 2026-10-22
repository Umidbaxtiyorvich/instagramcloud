"""Fikrlash: savol -> xotiradan izlash -> (bo'lsa) katta ochiq model bilan javob tuzish -> eslab qolish.

Chatga havola tashlansa, miya saytga o'zi kiradi, o'qiydi, qisqacha aytib beradi va saytning qolgan sahifalarini fonda o'rganadi.
"""
import re
import threading

from . import llm
from .text import sentences, terms
from .vault import Vault

REMEMBER = re.compile(r"^\s*(eslab qol|yodla|saqla)\s*[:,-]?\s*", re.I)
URL = re.compile(r"https?://[^\s<>\"')\]]+")
SYSTEM = (
    "Sen «Miya» — foydalanuvchining shaxsiy sun'iy miyasisan. Foydalanuvchi tilida (odatda o'zbekcha) aniq va tushunarli javob ber. "
    "Senga xotiradan topilgan eslatmalar [1], [2] ko'rinishida beriladi. Avvalo ularga tayan va qaysi eslatmadan olganingni [1] kabi belgila. "
    "Agar xotirada javob bo'lmasa, o'z bilimingdan javob ber, lekin «xotiramda yo'q, umumiy bilimimdan:» deb boshla. "
    "Bilmasang, to'qib chiqarma."
)
history: list[dict] = []  # oxirgi suhbat qatorlari (model kontekst uchun)


def _extractive(v: Vault, q: str, hits) -> tuple[str, list[str], list[str]]:
    """Model yo'q bo'lsa: eslatmalardan eng mos gaplarni tanlaydi."""
    qs, steps, cand = set(terms(q)), [], []
    for rank, (score, n) in enumerate(hits):
        for i, s in enumerate(sentences(n["body"])):
            if s.startswith(("Tushunchalar:", "Manbalar:", "Savol:")) or s.endswith("?"):
                continue
            s = re.sub(r"^Javob:\s*", "", s)
            hit = qs & set(terms(s))
            if hit:
                val = sum(v.idf(t) for t in hit) * (1 + 0.15 * len(hit)) / (1 + 0.3 * rank) - 0.002 * len(s)
                cand.append((val, rank, i, s, n["id"]))
    cand.sort(key=lambda x: -x[0])
    cand = [c for c in cand if c[0] >= 0.6 * cand[0][0]] if cand else []
    picked, seen = [], set()
    for c in cand:
        if c[3][:60] not in seen:
            seen.add(c[3][:60])
            picked.append(c)
        if len(picked) >= 3:
            break
    if not picked:
        return f"«{hits[0][1]['title']}» eslatmasi mavzuga yaqin, lekin aniq javob topa olmadim.", [hits[0][1]["id"]], steps
    steps.append(f"Ulardan savolga eng mos {len(picked)} ta gapni tanladim.")
    picked.sort(key=lambda c: (c[1], c[2]))
    return " ".join(c[3] for c in picked), list(dict.fromkeys(c[4] for c in picked)), steps


def _remember(q: str, a: str):
    history.extend([{"role": "user", "content": q}, {"role": "assistant", "content": a}])
    del history[:-8]


def learn_url(v: Vault, learner, q: str, url: str) -> dict:
    steps = [f"Xabarda havola bor: {url}. Saytga kirib o'qiyman."]
    try:
        page = learner.learn_page(url)
    except Exception as e:
        ans = f"Saytni o'qib bo'lmadi: {e}"
        return {"thinking": steps, "answer": ans, "sources": []}
    steps.append(f"Sahifa: «{page['title']}», {len(page['text'])} harf, {page['notes']} ta yangi eslatma.")
    learner.add_source(url, max_pages=15, every_hours=24)
    threading.Thread(target=learner.run_due, args=(url,), daemon=True).start()
    steps.append("Saytning boshqa sahifalarini (15 tagacha) fonda o'qishni boshladim va har kuni qaytib yangilarini o'rganaman.")
    m = llm.info()
    rest = URL.sub("", q).strip(" ,.-:")
    if m["ok"]:
        steps.append(f"Model ({m['model']}) sahifani qisqacha xulosa qilyapti.")
        ask = rest if len(terms(rest)) > 2 else "Bu sahifada nima haqida yozilgan? 3-5 gapda asosiy fikrlarni ayt."
        try:
            ans = llm.chat([{"role": "system", "content": SYSTEM},
                            {"role": "user", "content": f"Sahifa: {page['title']}\n\n{page['text'][:6000]}\n\nTopshiriq: {ask}"}])
        except Exception as e:
            ans = f"O'qidim, lekin model javob bermadi: {e}"
    else:
        ans = " ".join(sentences(page["text"])[:3]) or "O'qidim."
        ans = f"O'qib, eslab qoldim. Qisqacha: {ans}"
    ids = [n["id"] for n in v.notes.values() if n["meta"].get("manba") == url][:5]
    v.append_chat(q, ans, ids)
    _remember(q, ans)
    return {"thinking": steps, "answer": ans, "sources": [{"id": i, "title": v.notes[i]["title"]} for i in ids]}


def ask(v: Vault, q: str, learner=None) -> dict:
    m = REMEMBER.match(q)
    if m:
        body = q[m.end():].strip()
        if not body:
            return {"thinking": [], "answer": "Nimani eslab qolay? Masalan: «Eslab qol: Toshkent O'zbekiston poytaxti».", "sources": []}
        title = body.split(".")[0][:60]
        nid = v.add("eslatmalar", title, body)
        return {"thinking": [f"Bu buyruq: eslab qolish. «{title}» eslatmasini yaratdim.",
                             "Bog'langan tushunchalar: " + (", ".join(v.notes[nid]["links"]) or "yo'q")],
                "answer": "Eslab qoldim.", "sources": [{"id": nid, "title": title}]}

    u = URL.search(q)
    if u and learner is not None:
        return learn_url(v, learner, q, u.group(0).rstrip(".,"))

    steps = ["Savoldagi asosiy so'zlar: " + (", ".join(dict.fromkeys(terms(q))) or "topilmadi")]
    # avval o'qilgan manbalar va eslatmalar; suhbat tarixi faqat ular yetmasa qo'shiladi
    hits = v.search(q, k=5, types=("manba", "eslatma"))
    if len(hits) < 2:
        hits += v.search(q, k=2 - len(hits), types=("suhbat",))
    if hits:
        steps.append(f"Xotiradan {len(hits)} ta mos eslatma topdim: " + "; ".join(f"«{n['title']}»" for _, n in hits[:4]))
    else:
        steps.append("Xotiramda bu haqda eslatma yo'q.")
    mi = llm.info()
    if mi["ok"]:
        ctx = "\n\n".join(f"[{i + 1}] {n['title']}\n{n['body'][:1500]}" for i, (_, n) in enumerate(hits)) or "(xotirada mos eslatma yo'q)"
        steps.append(f"Eslatmalarni {mi['model']} modeliga berib, javob tuzdirdim.")
        try:
            ans = llm.chat([{"role": "system", "content": SYSTEM}, *history,
                            {"role": "user", "content": f"Xotiradan topilgan eslatmalar:\n{ctx}\n\nSavol: {q}"}])
            used = [n["id"] for _, n in hits]
        except Exception as e:
            steps.append(f"Model javob bermadi ({e}), oddiy usulga o'tdim.")
            mi = {"ok": False}
    if not mi["ok"]:
        if not hits:
            ans = "Bu haqda hali hech narsa bilmayman. Menga shu mavzudagi sayt havolasini yoki kitob bering, o'qib o'rganaman."
            used = []
        else:
            ans, used, more = _extractive(v, q, hits)
            steps += more
    v.append_chat(q, ans, used)
    _remember(q, ans)
    return {"thinking": steps, "answer": ans, "sources": [{"id": i, "title": v.notes[i]["title"]} for i in used]}
