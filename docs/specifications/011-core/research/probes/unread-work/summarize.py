"""Shares of recorded file seconds per class, per project and kind, and above the knee. Throwaway, read only.
Usage: python3 -I summarize.py REC.jsonl [KNEE=16]"""
import collections, json, sys
KNEE = float(sys.argv[2]) if len(sys.argv) > 2 else 16
recs = [json.loads(l) for l in open(sys.argv[1])]
BG = ("baseline", "backlog")
def h(x): return round(x / 3600, 1)
def pct(a, b): return round(100 * a / b, 1) if b else None
tot = collections.Counter(); unk = collections.Counter()
for r in recs:
    tot[(r["p"], r["kind"])] += r["sec"]
    if r["root"] is None: unk[(r["p"], r["kind"])] += r["sec"]
print("hours by project/kind (no root):", {f"{p}/{k}": (h(v), h(unk[(p, k)])) for (p, k), v in sorted(tot.items())})
def table(sel, label):
    rows = [r for r in recs if sel(r) and r["root"] is not None]
    T = sum(r["sec"] for r in rows); A = sum(r["sec"] for r in rows if (r["busy"] or 0) > KNEE)
    out = {"label": label, "h": h(T), "above_knee_h": h(A), "n": len(rows)}
    def cls(name, f):
        x = sum(r["sec"] for r in rows if f(r)); y = sum(r["sec"] for r in rows if f(r) and (r["busy"] or 0) > KNEE)
        out[name] = (h(x), pct(x, T), h(y), pct(y, A))
    cls("1 nosession(gap)", lambda r: r["nos"])
    cls("1 nosession(any)", lambda r: r["nos_any"])
    cls("read_local", lambda r: r["why"] == "read")
    cls("read_strict", lambda r: r["read_strict"])
    cls("read_other", lambda r: r["other"])
    cls("2 removed before event", lambda r: r["why"] == "removed")
    cls("2 removed before event, no other", lambda r: r["why"] == "removed" and not r["other"])
    cls("3 superseded before event", lambda r: r["why"] == "superseded")
    cls("3 superseded, no other", lambda r: r["why"] == "superseded" and not r["other"])
    cls("no later event", lambda r: r["why"] == "no-later-event")
    cls("4 unread (no local, no other)", lambda r: r["why"] != "read" and not r["other"])
    cls("4 unread strict (no strict local, no other)", lambda r: not r["read_strict"] and not r["other"])
    cls("no row", lambda r: not r["row"])
    print(json.dumps(out))
for p in ("all", "cezar", "squeal"):
    for k in ("bg", "baseline", "backlog", "edit", "run-all"):
        table(lambda r, p=p, k=k: (p == "all" or r["p"] == p) and (r["kind"] in BG if k == "bg" else r["kind"] == k), f"{p}/{k}")
