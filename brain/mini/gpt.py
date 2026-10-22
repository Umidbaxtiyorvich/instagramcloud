"""Kichik GPT (transformer), noldan. Men (katta modellar) ham shu arxitekturada ishlaymiz, faqat milliard marta kattaroq.

python3 gpt.py train [soniya]   — data/*.txt dan o'qitadi, gpt.pt ga saqlaydi
python3 gpt.py chat "savol"     — javob beradi
"""
import math, pathlib, sys, time
import torch
import torch.nn as nn
import torch.nn.functional as F

here = pathlib.Path(__file__).parent
CFG = dict(block=160, n_layer=3, n_head=4, n_embd=96, dropout=0.1)


class Block(nn.Module):
    def __init__(s, c):
        super().__init__()
        s.ln1, s.ln2 = nn.LayerNorm(c["n_embd"]), nn.LayerNorm(c["n_embd"])
        s.qkv = nn.Linear(c["n_embd"], 3 * c["n_embd"])
        s.proj = nn.Linear(c["n_embd"], c["n_embd"])
        s.fc = nn.Linear(c["n_embd"], 4 * c["n_embd"])
        s.fc2 = nn.Linear(4 * c["n_embd"], c["n_embd"])
        s.nh, s.drop = c["n_head"], nn.Dropout(c["dropout"])

    def forward(s, x):
        B, T, C = x.shape
        q, k, v = s.qkv(s.ln1(x)).split(C, 2)
        q, k, v = (t.view(B, T, s.nh, C // s.nh).transpose(1, 2) for t in (q, k, v))
        a = F.scaled_dot_product_attention(q, k, v, is_causal=True, dropout_p=s.drop.p if s.training else 0)
        x = x + s.drop(s.proj(a.transpose(1, 2).reshape(B, T, C)))
        return x + s.drop(s.fc2(F.gelu(s.fc(s.ln2(x)), approximate="tanh")))


class GPT(nn.Module):
    def __init__(s, V, c=CFG):
        super().__init__()
        s.c = c
        s.tok, s.pos = nn.Embedding(V, c["n_embd"]), nn.Embedding(c["block"], c["n_embd"])
        s.blocks = nn.ModuleList(Block(c) for _ in range(c["n_layer"]))
        s.lnf, s.head = nn.LayerNorm(c["n_embd"]), nn.Linear(c["n_embd"], V)

    def forward(s, idx):
        x = s.tok(idx) + s.pos(torch.arange(idx.shape[1]))
        for b in s.blocks:
            x = b(x)
        return s.head(s.lnf(x))


def load_text():
    return "\n\n".join(p.read_text(encoding="utf-8") for p in sorted((here / "data").glob("*.txt")))


def train(budget):
    text = load_text()
    chars = sorted(set(text))
    stoi = {c: i for i, c in enumerate(chars)}
    data = torch.tensor([stoi[c] for c in text])
    m = GPT(len(chars))
    print(f"matn {len(text)} harf, lug'at {len(chars)}, parametrlar {sum(p.numel() for p in m.parameters()):,}")
    opt = torch.optim.AdamW(m.parameters(), lr=1e-3, weight_decay=0.1)
    T, t0, step = CFG["block"], time.time(), 0
    while time.time() - t0 < budget:
        lr = 2e-3 * min(1, step / 200) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * min(1, (time.time() - t0) / budget))))
        for g in opt.param_groups:
            g["lr"] = lr
        ix = torch.randint(len(data) - T - 1, (24,))
        x = torch.stack([data[i:i + T] for i in ix])
        y = torch.stack([data[i + 1:i + T + 1] for i in ix])
        loss = F.cross_entropy(m(x).view(-1, len(chars)), y.view(-1))
        opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(m.parameters(), 1.0); opt.step()
        if step % 250 == 0:
            print(f"qadam {step:5d}  xato {loss.item():.3f}  {time.time() - t0:.0f}s", flush=True)
        step += 1
    torch.save({"chars": "".join(chars), "state": m.state_dict(), "cfg": CFG}, here / "gpt.pt")
    print("saqlandi: gpt.pt")


@torch.no_grad()
def chat(q, temp=0.5):
    ck = torch.load(here / "gpt.pt")
    chars = ck["chars"]; stoi = {c: i for i, c in enumerate(chars)}
    m = GPT(len(chars), ck["cfg"]); m.load_state_dict(ck["state"]); m.eval()
    prompt = f"Savol: {q}\nJavob:"
    idx = torch.tensor([[stoi.get(c, stoi[" "]) for c in prompt]])
    out = ""
    for _ in range(400):
        logits = m(idx[:, -CFG["block"]:])[0, -1] / temp
        nxt = torch.multinomial(F.softmax(logits, -1), 1)
        out += chars[nxt.item()]
        if out.endswith("\n\n") or "Savol:" in out:
            break
        idx = torch.cat([idx, nxt.view(1, 1)], 1)
    return out.split("Savol:")[0].strip()


if __name__ == "__main__":
    if sys.argv[1] == "train":
        train(float(sys.argv[2]) if len(sys.argv) > 2 else 600)
    else:
        print(chat(" ".join(sys.argv[2:])))
