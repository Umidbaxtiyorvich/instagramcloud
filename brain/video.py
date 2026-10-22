"""ffmpeg orqali 9:16 video montaj: slaydlar, matn, o'tishlar, ixtiyoriy ovoz."""
import shutil
import subprocess
import tempfile
from pathlib import Path

W, H, FPS = 1080, 1920, 30
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
PALETTES = [("0x1e3c72", "0x2a5298"), ("0x141e30", "0x243b55"), ("0x42275a", "0x734b6d"), ("0x134e5e", "0x71b280")]


def _run(cmd: list[str]) -> None:
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError(p.stderr[-800:])


def _wrap(text: str, width: int = 18) -> str:
    lines, cur = [], ""
    for w in text.split():
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    return "\n".join(lines + [cur])


def make_slide(text: str, seconds: float, idx: int, out: Path, tmp: Path) -> None:
    c1, c2 = PALETTES[idx % len(PALETTES)]
    txt = tmp / f"s{idx}.txt"
    txt.write_text(_wrap(text), encoding="utf-8")
    fade = min(0.5, seconds / 4)
    vf = (
        f"drawtext=fontfile={FONT}:textfile={txt}:fontsize=84:fontcolor=white:line_spacing=18:"
        f"x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.5:shadowx=4:shadowy=4,"
        f"fade=t=in:d={fade},fade=t=out:st={seconds - fade}:d={fade}"
    )
    _run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"gradients=s={W}x{H}:c0={c1}:c1={c2}:x0=0:y0=0:x1={W}:y1={H}:d={seconds}:r={FPS}",
          "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", str(seconds), str(out)])


def speak(text: str, out: Path) -> bool:
    """Ovoz: espeak-ng o'rnatilgan bo'lsa. Yo'q bo'lsa jimgina o'tkazib yuboradi."""
    exe = shutil.which("espeak-ng") or shutil.which("espeak")
    if not exe:
        return False
    _run([exe, "-v", "uz", "-w", str(out), text])
    return True


def render(slides: list[dict], out: Path, voice: bool = False) -> Path:
    """slides: [{"text": str, "seconds": float}]"""
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        parts = []
        for i, s in enumerate(slides):
            p = tmp / f"p{i}.mp4"
            make_slide(s["text"], float(s.get("seconds", 3)), i, p, tmp)
            parts.append(p)
        lst = tmp / "list.txt"
        lst.write_text("".join(f"file '{p}'\n" for p in parts))
        silent = tmp / "all.mp4"
        _run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(silent)])
        wav = tmp / "v.wav"
        if voice and speak(" ".join(s["text"] for s in slides), wav):
            _run(["ffmpeg", "-y", "-i", str(silent), "-i", str(wav), "-c:v", "copy", "-c:a", "aac", "-shortest", str(out)])
        else:
            shutil.copy(silent, out)
    return out
