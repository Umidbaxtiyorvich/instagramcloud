"""Miya: mavzu -> (LLM) ssenariy -> (ffmpeg) video + caption. Tashqi API yo'q."""
import argparse
import json
from pathlib import Path

import llm
import video

SYSTEM = (
    "Sen Instagram Reels ssenariy yozuvchisan. Faqat JSON qaytar: "
    '{"slides":[{"text":"qisqa gap (<=10 so\'z)","seconds":3}],"caption":"post matni","hashtags":["..."]}. '
    "4-6 ta slayd, birinchisi e'tiborni tortuvchi hook, oxirgisi chaqiriq (CTA). Auditoriya tilida yoz."
)


def fallback_plan(topic: str) -> dict:
    """LLM yo'q bo'lsa (masalan Ollama ishga tushmagan), oddiy shablon."""
    return {
        "slides": [
            {"text": topic, "seconds": 3},
            {"text": "Bilasizmi?", "seconds": 2},
            {"text": "Batafsil postda", "seconds": 3},
            {"text": "Obuna bo'ling!", "seconds": 3},
        ],
        "caption": topic,
        "hashtags": [],
    }


def run(topic: str, out_dir: Path, voice: bool) -> None:
    if llm.available():
        print(f"[miya] model: {llm.MODEL}, ssenariy yozilmoqda...")
        plan = llm.ask_json(f"Mavzu: {topic}", SYSTEM)
    else:
        print("[miya] Ollama topilmadi, shablon ishlatilmoqda (haqiqiy miya uchun README ga qarang).")
        plan = fallback_plan(topic)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    mp4 = video.render(plan["slides"], out_dir / "reel.mp4", voice=voice)
    tags = " ".join("#" + h.lstrip("#") for h in plan.get("hashtags", []))
    (out_dir / "caption.txt").write_text(f"{plan.get('caption', '')}\n\n{tags}".strip(), encoding="utf-8")
    print(f"[miya] tayyor: {mp4}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("topic")
    ap.add_argument("--out", default="out")
    ap.add_argument("--voice", action="store_true")
    a = ap.parse_args()
    run(a.topic, Path(a.out), a.voice)
