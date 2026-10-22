"""gpt.pt -> web/index.html (brauzerda ishlaydigan GPT, serversiz)."""
import base64, json, pathlib
import numpy as np
import torch

here = pathlib.Path(__file__).parent
ck = torch.load(here / "gpt.pt")
w = {k: base64.b64encode(v.float().numpy().astype(np.float16).tobytes()).decode() for k, v in ck["state"].items()}
n = sum(v.numel() for v in ck["state"].values())
meta = {"chars": ck["chars"], "cfg": ck["cfg"], "weights": w}
tpl = (here / "web" / "chat.html").read_text(encoding="utf-8")
html = tpl.replace("__BRAIN__", json.dumps(meta)).replace("__PARAMS__", f"{n:,}".replace(",", " "))
(here / "web" / "index.html").write_text(html, encoding="utf-8")
print("yozildi:", len(html) // 1024, "KB,", n, "parametr")
