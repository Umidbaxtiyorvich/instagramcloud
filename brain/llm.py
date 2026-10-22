"""Mahalliy LLM mijozi (Ollama). Hech qanday tashqi API kaliti kerak emas."""
import json
import os
import urllib.request

HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
MODEL = os.environ.get("BRAIN_MODEL", "qwen2.5:7b")


def available() -> bool:
    try:
        urllib.request.urlopen(f"{HOST}/api/tags", timeout=2)
        return True
    except Exception:
        return False


def ask_json(prompt: str, system: str = "") -> dict:
    """Modeldan qat'iy JSON javob oladi."""
    body = json.dumps({
        "model": MODEL,
        "prompt": prompt,
        "system": system,
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.7},
    }).encode()
    req = urllib.request.Request(f"{HOST}/api/generate", body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(json.loads(r.read())["response"])
