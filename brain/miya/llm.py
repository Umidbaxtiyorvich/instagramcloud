"""Kompyuterdagi katta ochiq model (Qwen, Llama...) bilan ulanish. Internet va token kerak emas.

Qo'llab-quvvatlanadi: Ollama (standart) yoki OpenAI-mos mahalliy server (LM Studio, llama.cpp server).
Sozlash: MIYA_MODEL=qwen2.5:7b, MIYA_OLLAMA=http://127.0.0.1:11434, MIYA_LLM_URL=http://127.0.0.1:1234 (OpenAI-mos).
"""
import json
import os
import time
import urllib.request

OLLAMA = os.environ.get("MIYA_OLLAMA", "http://127.0.0.1:11434").rstrip("/")
OPENAI = os.environ.get("MIYA_LLM_URL", "").rstrip("/")
MODEL = os.environ.get("MIYA_MODEL", "qwen2.5:7b")
_cache = {"t": 0, "info": None}
# mahalliy so'rovlar proksi orqali o'tmasligi kerak
_open = urllib.request.build_opener(urllib.request.ProxyHandler({})).open


def _get(url, timeout=3):
    with _open(url, timeout=timeout) as r:
        return json.loads(r.read())


def _post(url, body, timeout=600):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with _open(req, timeout=timeout) as r:
        return json.loads(r.read())


def info() -> dict:
    """Qaysi model ishlayotganini aniqlaydi (30 soniya keshlanadi)."""
    if time.time() - _cache["t"] < 30 and _cache["info"]:
        return _cache["info"]
    res = {"ok": False, "backend": None, "model": MODEL, "models": [], "hint": "Ollama topilmadi. miya_setup.bat ni ishga tushiring."}
    try:
        if OPENAI:
            ms = [m["id"] for m in _get(OPENAI + "/v1/models").get("data", [])]
            res.update(ok=bool(ms), backend="openai", models=ms, model=MODEL if MODEL in ms else (ms[0] if ms else MODEL), hint="")
        else:
            ms = [m["name"] for m in _get(OLLAMA + "/api/tags").get("models", [])]
            pick = next((m for m in ms if m == MODEL or m.split(":")[0] == MODEL.split(":")[0]), None) or (ms[0] if ms else None)
            res.update(backend="ollama", models=ms, ok=bool(pick), model=pick or MODEL,
                       hint="" if pick else f"Ollama ishlayapti, lekin model yo'q: ollama pull {MODEL}")
    except Exception:
        pass
    _cache.update(t=time.time(), info=res)
    return res


def chat(messages: list[dict], temperature: float = 0.4) -> str:
    i = info()
    if not i["ok"]:
        raise RuntimeError(i["hint"])
    if i["backend"] == "openai":
        r = _post(OPENAI + "/v1/chat/completions", {"model": i["model"], "messages": messages, "temperature": temperature})
        return r["choices"][0]["message"]["content"].strip()
    r = _post(OLLAMA + "/api/chat", {"model": i["model"], "messages": messages, "stream": False,
                                    "options": {"temperature": temperature, "num_ctx": 8192}})
    return r["message"]["content"].strip()
