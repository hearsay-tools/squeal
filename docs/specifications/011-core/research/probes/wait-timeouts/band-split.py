"""Q4: per load band, the mean seconds a named 60 s wait spent (up to its own end or 60 s) with a run holding a
named file running, with only other runs of the worktree running, and with no run of the worktree running.
Throwaway. Usage: python3 -I band-split.py TL_ALL.jsonl   (timeline.mjs ... all)"""
import json, sys
EDG = ["0-6", "6-12", "12-16", "16-20", "20-24"]
x = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
x = [r for r in x if r["storeHasWorktree"] and r["nTests"] > 0]
print("named waits with named test files and runs in the store:", len(x))
base = None
print("band | n | mean wait s | named run running | other runs only | no run | timed out")
for b in range(5):
    xb = [r for r in x if r["band"] == b]
    n = len(xb)
    c = sum(r["covered"] for r in xb) / n; o = sum(r["other"] for r in xb) / n; i = sum(r["idle"] for r in xb) / n
    if base is None:
        base = (c, o, i)
    print(f"{EDG[b]} | {n} | {c + o + i:.1f} | {c:.1f} (+{c - base[0]:.1f}) | {o:.1f} (+{o - base[1]:.1f}) | {i:.1f} (+{i - base[2]:.1f}) | {sum(r['timedOut'] for r in xb) / n:.0%}")
