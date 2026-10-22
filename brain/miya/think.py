"""Fikrlash: savol -> xotiradan izlash -> eng mos gaplarni tanlash -> javob + fikr qadamlari. Har suhbat eslab qolinadi."""
import re

from .text import sentences, terms
from .vault import Vault

REMEMBER = re.compile(r"^\s*(eslab qol|yodla|saqla)\s*[:,-]?\s*", re.I)


def ask(v: Vault, q: str) -> dict:
    m = REMEMBER.match(q)
    if m:
        body = q[m.end():].strip()
        if not body:
            return {"thinking": [], "answer": "Nimani eslab qolay? Masalan: «Eslab qol: Toshkent O'zbekiston poytaxti».", "sources": []}
        title = body.split(".")[0][:60]
        nid = v.add("eslatmalar", title, body)
        cs = v.notes[nid]["links"]
        return {"thinking": [f"Bu buyruq: eslab qolish. «{title}» eslatmasini yaratdim.",
                             "Bog'langan tushunchalar: " + (", ".join(cs) or "yo'q")],
                "answer": "Eslab qoldim.", "sources": [{"id": nid, "title": title}]}

    steps = []
    qt = list(dict.fromkeys(terms(q)))
    steps.append("Savoldagi asosiy so'zlar: " + (", ".join(qt) or "topilmadi"))
    hits = v.search(q, k=6)
    if not hits:
        steps.append("Xotiramda bu so'zlar bilan bog'liq eslatma yo'q.")
        ans = "Bu haqda hali hech narsa bilmayman. Menga shu mavzudagi sayt yoki kitob bering, o'qib o'rganaman."
        v.append_chat(q, ans, [])
        return {"thinking": steps, "answer": ans, "sources": []}
    steps.append(f"{len(hits)} ta mos eslatma topdim: " + "; ".join(f"«{n['title']}» ({s:.1f})" for s, n in hits[:4]))

    qs = set(qt)
    cand = []
    for rank, (score, n) in enumerate(hits):
        for i, s in enumerate(sentences(n["body"])):
            if s.startswith(("Tushunchalar:", "Manbalar:", "Savol:")) or s.endswith("?"):
                continue
            s = re.sub(r"^Javob:\s*", "", s)
            st = set(terms(s))
            hit = qs & st
            if not hit:
                continue
            val = sum(v.idf(t) for t in hit) * (1 + 0.15 * len(hit)) / (1 + 0.3 * rank) - 0.002 * len(s)
            cand.append((val, rank, i, s, n["id"]))
    cand.sort(key=lambda x: -x[0])
    # faqat eng yaxshi gapga yaqin balli gaplar olinadi — aloqasizlari tashlanadi
    cand = [c for c in cand if c[0] >= 0.6 * cand[0][0]] if cand else []
    picked, seen = [], set()
    for c in cand:
        key = c[3][:60]
        if key in seen:
            continue
        seen.add(key)
        picked.append(c)
        if len(picked) >= 3:
            break
    if not picked:
        ans = f"«{hits[0][1]['title']}» eslatmasi mavzuga yaqin, lekin aniq javob topa olmadim."
        used = [hits[0][1]["id"]]
    else:
        steps.append(f"Ulardan savolga eng mos {len(picked)} ta gapni tanladim va manba tartibida tizdim.")
        picked.sort(key=lambda c: (c[1], c[2]))
        ans = " ".join(c[3] for c in picked)
        used = list(dict.fromkeys(c[4] for c in picked))
    rel = [l for _, n in hits[:3] for l in n["links"]][:6]
    if rel:
        steps.append("Bog'liq tushunchalar: " + ", ".join(dict.fromkeys(rel)))
    v.append_chat(q, ans, used)
    return {"thinking": steps, "answer": ans, "sources": [{"id": u, "title": v.notes[u]["title"]} for u in used]}
