"""brain.npz -> web/index.html (brauzerda ishlaydigan, serversiz miya)."""
import base64, json, pathlib
import numpy as np

here = pathlib.Path(__file__).parent
d = np.load(here / "brain.npz")
w = {k: base64.b64encode(d[k].astype(np.float16).tobytes()).decode() for k in ["emb", "W1", "b1", "W2", "b2"]}
meta = {"chars": str(d["chars"]), "C": 32, "E": 24, "H": 768, "weights": w}
n_params = sum(d[k].size for k in ["emb", "W1", "b1", "W2", "b2"])
tpl = (here / "web" / "template.html").read_text(encoding="utf-8")
html = tpl.replace("__BRAIN__", json.dumps(meta)).replace("__PARAMS__", f"{n_params:,}".replace(",", " "))
(here / "web" / "index.html").write_text(html, encoding="utf-8")
print("yozildi:", len(html) // 1024, "KB,", n_params, "parametr")
