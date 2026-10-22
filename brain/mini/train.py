"""O'qitish: python3 train.py [vaqt_soniya]  — data/*.txt dagi barcha matnlardan o'rganadi."""
import pathlib
import sys
import time
import numpy as np
from brain import Brain, C

here = pathlib.Path(__file__).parent
text = "\n".join(p.read_text(encoding="utf-8") for p in sorted((here / "data").glob("*.txt")))
chars = "".join(sorted(set(text)))
idx = {c: i for i, c in enumerate(chars)}
data = np.array([idx[c] for c in text])
# kontekst oynalari: C ta harf -> keyingi harf
pad = np.concatenate([np.zeros(C, dtype=int), data])
X = np.stack([pad[i:i + C] for i in range(len(data))])
y = data
print(f"matn: {len(text)} harf, lug'at: {len(chars)}, parametrlar tayyorlanmoqda...")

brain = Brain(chars)
budget = float(sys.argv[1]) if len(sys.argv) > 1 else 120
rng = np.random.default_rng(1)
t0 = time.time()
step = 0
while time.time() - t0 < budget:
    b = rng.integers(0, len(X), 256)
    loss, g = brain.loss_and_grads(X[b], y[b])
    brain.step(g, lr=2e-3 if step < 1500 else 5e-4)
    if step % 200 == 0:
        print(f"qadam {step:5d}  xato {loss:.3f}")
    step += 1
brain.save(here / "brain.npz")
print("saqlandi: brain.npz")
