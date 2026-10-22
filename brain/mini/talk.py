"""python3 talk.py "Instagramda " — miya matnni davom ettiradi."""
import pathlib
import sys
from brain import Brain

b = Brain.load(pathlib.Path(__file__).parent / "brain.npz")
print(b.generate(sys.argv[1] if len(sys.argv) > 1 else "Instagramda ", n=300))
