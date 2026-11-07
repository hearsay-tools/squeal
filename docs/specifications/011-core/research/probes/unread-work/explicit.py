"""Explicit readers, failures and removal delays for classify.py's records. Throwaway, read only.

Usage: python3 -I explicit.py REC.jsonl SESSIONS [KNEE=16]

Explicit read of a record (inferred): before the result is replaced or the worktree removed, a session in its root
(a) asked for it: `squeal status --wait` / `squeal run` naming the file or a folder above it ("named"), or naming no
path or --all ("bare"); or (b) got a SQUEAL message whose FAIL lines name the file; or (c) another worktree used it
(classify.py `other`). Otherwise the result reached sessions only as silence (hook counts, Stop) or not at all.
"""
import bisect, collections, json, os, sys

REC, SESS = sys.argv[1:3]
KNEE = float(sys.argv[3]) if len(sys.argv) > 3 else 16
BG = ("baseline", "backlog")
asks = collections.defaultdict(list)  # root -> [(t, paths|None)]
fails = collections.defaultdict(list)  # root -> [(t, set)]
for line in open(SESS):
    s = json.loads(line)
    for t, k, d in s["events"]:
        if k == "ask":
            ps = [os.path.relpath(p, s["root"]) if p.startswith("/") else p.lstrip("./") or "." for p in d["paths"]]
            asks[s["root"]].append((t * 1000, None if d["all"] else ps))
        elif k == "fail":
            fails[s["root"]].append((t * 1000, set(d)))
for d in (asks, fails):
    for k in d:
        d[k].sort(key=lambda x: x[0])


def rel(f):
    a, sep, b = f.partition(":")
    return b if sep and "/" not in a else f


def covers(p, f):
    p = p.rstrip("/")
    return p in (".", "") or f == p or f.startswith(p + "/")


recs = [json.loads(l) for l in open(REC)]
# speed: precompute ask times per root
ask_t = {k: [a[0] for a in v] for k, v in asks.items()}
def first_read_fast(r):
    f = rel(r["f"])
    lim = min(x for x in (r["sup"], r["rm"], 1e18) if x is not None)
    named = bare = fail = None
    lst = asks.get(r["root"], [])
    for t, ps in lst[bisect.bisect_right(ask_t.get(r["root"], []), r["e"]):]:
        if t >= lim:
            break
        if ps is None:
            bare = bare or t
        elif any(covers(p, f) for p in ps):
            named = t
            break
    for t, fs in fails.get(r["root"], []):
        if r["e"] < t < lim and any(x.endswith(f) or f.endswith(x) for x in fs):
            fail = t
            break
    return named, bare, fail


def h(x): return round(x / 3600, 1)
def pct(a, b): return round(100 * a / b, 1) if b else None
for label, sel in (("all/bg", lambda r: r["kind"] in BG), ("cezar/bg", lambda r: r["p"] == "cezar" and r["kind"] in BG),
                   ("squeal/bg", lambda r: r["p"] == "squeal" and r["kind"] in BG), ("all/baseline", lambda r: r["kind"] == "baseline"),
                   ("all/backlog", lambda r: r["kind"] == "backlog"), ("all/edit", lambda r: r["kind"] == "edit")):
    rows = [r for r in recs if sel(r)]
    T = sum(r["sec"] for r in rows); A = sum(r["sec"] for r in rows if (r["busy"] or 0) > KNEE)
    c, ca = collections.Counter(), collections.Counter()
    for r in rows:
        named, bare, fail = first_read_fast(r)
        k = ("named" if named else "fail-msg" if fail else "other-wt" if r["other"] else "bare-wait" if bare
             else "silence" if r["why"] == "read" else "nobody")
        c[k] += r["sec"]
        if (r["busy"] or 0) > KNEE:
            ca[k] += r["sec"]
    print(json.dumps({"label": label, "h": h(T), "aboveKnee_h": h(A),
                      **{k: [h(c[k]), pct(c[k], T), pct(ca[k], A)] for k in ("named", "fail-msg", "other-wt", "bare-wait", "silence", "nobody")}}))

# Failures in background records: are they first failures, and who read them.
print("--- failing background records (result row with a fail)")
prev = {}
for r in sorted(recs, key=lambda r: r["s"]):
    key = (r["p"], r["wt"], r["f"])
    r["first_fail"] = bool(r["fails"]) and not prev.get(key, False)
    prev[key] = bool(r["fails"])
fl = [r for r in recs if r["kind"] in BG and r["fails"]]
c = collections.Counter()
for r in fl:
    named, bare, fail = first_read_fast(r)
    c[("first" if r["first_fail"] else "repeat", "nosession" if r["nos"] else "session",
       "read" if (named or fail or r["other"] or bare or r["why"] == "read") else "nobody", "msg" if fail else "-")] += 1
for k, v in sorted(c.items()):
    print(k, v)
print("records with a result row:", sum(1 for r in recs if r["kind"] in BG and r["row"]), "failing:", len(fl))

# First failures (the file's first fail in its worktree) per explicit class, background only.
print("--- first failures per explicit class (background)")
prev = {}
c, secs = collections.Counter(), collections.Counter()
for r in sorted(recs, key=lambda r: r["s"]):
    key = (r["p"], r["wt"], r["f"])
    ff = bool(r["fails"]) and not prev.get(key, False)
    prev[key] = bool(r["fails"])
    if r["kind"] not in BG:
        continue
    named, bare, fail = first_read_fast(r)
    k = ("named" if named else "fail-msg" if fail else "other-wt" if r["other"] else "bare-wait" if bare
         else "silence" if r["why"] == "read" else "nobody")
    secs[k] += r["sec"]
    if ff:
        c[k] += 1
for k in ("named", "fail-msg", "other-wt", "bare-wait", "silence", "nobody"):
    print(k, "first fails", c[k], "per 100 h", round(100 * c[k] / (secs[k] / 3600), 1) if secs[k] else None)
