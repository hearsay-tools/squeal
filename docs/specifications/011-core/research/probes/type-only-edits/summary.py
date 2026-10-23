# 011-149 probe (throwaway): summarizes replay.py output, for one store, all history or since a time.
# Usage: python3 -I summary.py <replay.json> [since ms]
import collections, json, sys
d = json.load(open(sys.argv[1])); since = int(sys.argv[2]) if len(sys.argv) > 2 else 0
TS = (".ts", ".tsx", ".mts", ".cts")
edits = [e for e in d["edits"]]
files = [f for f in d["files"] if f["t"] >= since]
revs_in = {(f["w"], f["n"]) for f in files}
print("== path edits of code files (watch revisions)")
for size in (True, False):
    es = [e for e in edits if e["small"] == size and e["path"].endswith(TS)]
    c = collections.Counter(e["cls"] for e in es)
    bare = sum(1 for e in es if e["cls"] == "differs" and e["bare"])
    known = len(es) - c["unknown"]
    print(f"  {'agent (<=3 paths)' if size else 'bulk (>3 paths)'} TS edits {len(es)}, evaluable {known}: same {c['same']}, "
          f"moved {c['moved']}, differs {c['differs']} (of which same without comments {bare}), unknown {c['unknown']}")
    if known:
        print(f"    shares of evaluable: K1 {c['same']/known:.1%}, K2 {(c['same']+c['moved'])/known:.1%}, K3 {(c['same']+c['moved']+bare)/known:.1%}")
print("== re-keyed test files at those revisions" + (f" since {since}" if since else ""))
for size in (True, False, None):
    fs = [f for f in files if size is None or f["small"] == size]
    tot, ran = sum(f["dur"] for f in fs), sum(f["ranS"] for f in fs)
    print(f"  {'agent' if size else 'bulk' if size is False else 'all'}: {len(fs)} file re-keys over {len({(f['w'], f['n']) for f in fs})} revisions, "
          f"last-duration {tot:,.0f} s, stored results in window {ran:,.0f} s ({sum(f['ranN'] for f in fs)} runs)")
    for k in ("K1", "K2", "K3"):
        kf = [f for f in fs if f["keep"][k]]
        s, r = sum(f["dur"] for f in kf), sum(f["ranS"] for f in kf)
        print(f"    {k}: keep {len(kf)} ({len(kf)/max(len(fs),1):.1%}), last-duration {s:,.0f} s ({s/max(tot,1):.1%}), "
              f"ran {r:,.0f} s ({r/max(ran,1):.1%}); to FAIL {sum(len(f['toFail']) for f in kf)}, to PASS {sum(len(f['toPass']) for f in kf)}")
print("== only file re-keys whose every changed closure path has a known emission class")
for size in (True, False):
    fs = [f for f in files if f["small"] == size and f["known"]]
    tot = sum(f["dur"] for f in fs)
    print(f"  {'agent' if size else 'bulk'}: {len(fs)} file re-keys over {len({(f['w'], f['n']) for f in fs})} revisions, {tot:,.0f} s; " +
          ", ".join(f"{k} keeps {sum(f['dur'] for f in fs if f['keep'][k]):,.0f} s ({sum(f['dur'] for f in fs if f['keep'][k])/max(tot,1):.1%})" for k in ("K1", "K2", "K3")))
print("== agent revisions: files whose every changed closure path emits equal code (K2) yet re-key, by how the paths enter")
fs = [f for f in files if f["small"]]
via = collections.Counter()
for f in fs:
    if not f["keep"]["K2"] and f["allK2"]: via[",".join(f["via"])] += f["dur"]
print("  ", {k: round(v) for k, v in via.most_common(8)})
print("== transitions in files a variant keeps")
for k in ("K1", "K2", "K3"):
    for f in files:
        if f["keep"][k] and (f["toFail"] or f["toPass"]):
            print(f"  {k} {f['w'][:8]} rev {f['n']} {f['project']}:{f['test']} via {f['via']} toFail {f['toFail'][:3]} toPass {f['toPass'][:3]}")
