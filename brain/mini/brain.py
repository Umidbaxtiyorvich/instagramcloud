"""Noldan yozilgan kichik neyron til modeli (numpy). Hech qayerga ulanmaydi.

Arxitektura: belgi (harf) darajasidagi neyron tarmoq (Bengio, 2003):
oldingi C ta harf -> embedding -> tanh qatlam -> keyingi harf ehtimoli.
Backprop qo'lda yozilgan, Adam optimizatori bilan o'qitiladi.
"""
import json
import pathlib
import numpy as np

C, E, H = 32, 24, 768


class Brain:
    def __init__(self, chars: str, seed: int = 0):
        self.chars = chars
        self.V = len(chars)
        r = np.random.default_rng(seed)
        self.p = {
            "emb": r.normal(0, 0.1, (self.V, E)),
            "W1": r.normal(0, (2 / (C * E)) ** 0.5, (C * E, H)),
            "b1": np.zeros(H),
            "W2": r.normal(0, (1 / H) ** 0.5, (H, self.V)),
            "b2": np.zeros(self.V),
        }
        self.m = {k: np.zeros_like(v) for k, v in self.p.items()}
        self.v = {k: np.zeros_like(v) for k, v in self.p.items()}
        self.t = 0

    def forward(self, X):
        p = self.p
        e = p["emb"][X].reshape(len(X), -1)
        h = np.tanh(e @ p["W1"] + p["b1"])
        logits = h @ p["W2"] + p["b2"]
        return e, h, logits

    def loss_and_grads(self, X, y):
        p = self.p
        e, h, logits = self.forward(X)
        z = logits - logits.max(1, keepdims=True)
        pr = np.exp(z)
        pr /= pr.sum(1, keepdims=True)
        n = len(X)
        loss = -np.log(pr[np.arange(n), y] + 1e-12).mean()
        d = pr
        d[np.arange(n), y] -= 1
        d /= n
        g = {"W2": h.T @ d, "b2": d.sum(0)}
        dh = (d @ p["W2"].T) * (1 - h * h)
        g["W1"] = e.T @ dh
        g["b1"] = dh.sum(0)
        de = (dh @ p["W1"].T).reshape(n, C, E)
        g["emb"] = np.zeros_like(p["emb"])
        np.add.at(g["emb"], X, de)
        return loss, g

    def step(self, g, lr):
        self.t += 1
        for k in self.p:
            self.m[k] = 0.9 * self.m[k] + 0.1 * g[k]
            self.v[k] = 0.999 * self.v[k] + 0.001 * g[k] ** 2
            mh = self.m[k] / (1 - 0.9 ** self.t)
            vh = self.v[k] / (1 - 0.999 ** self.t)
            self.p[k] -= lr * mh / (np.sqrt(vh) + 1e-8)

    def generate(self, prompt: str, n: int = 300, temp: float = 0.7, seed=None) -> str:
        r = np.random.default_rng(seed)
        idx = {c: i for i, c in enumerate(self.chars)}
        ctx = [idx.get(c, 0) for c in prompt][-C:]
        ctx = [0] * (C - len(ctx)) + ctx
        out = prompt
        for _ in range(n):
            _, _, lg = self.forward(np.array([ctx]))
            lg = lg[0] / max(temp, 1e-3)
            pr = np.exp(lg - lg.max())
            pr /= pr.sum()
            i = int(r.choice(self.V, p=pr))
            out += self.chars[i]
            ctx = ctx[1:] + [i]
        return out

    def save(self, path):
        np.savez(path, chars=self.chars, **self.p)

    @classmethod
    def load(cls, path):
        d = np.load(path)
        b = cls(str(d["chars"]))
        for k in b.p:
            b.p[k] = d[k]
        return b
