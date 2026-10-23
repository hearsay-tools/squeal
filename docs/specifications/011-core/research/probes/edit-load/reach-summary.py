# 011-143 probe (throwaway): reach.json per revision. A test file is reached when it executed a changed
# line of any path the revision changed; not reached when every changed path was evaluable for it and
# none ran; otherwise not evaluable. Also lists new failures in files not reached, with a mechanism guess.
# Usage: python3 -I reach-summary.py <reach.json> <checkout>
import json, sys, re, os, collections
r = json.load(open(sys.argv[1])); tree = sys.argv[2]
revs = collections.defaultdict(list)
for e in r: revs[(e["worktree"], e["revision"])].append(e)
def cls(es):
    src = [e for e in es if not e["isTest"] and e["path"].startswith("src/")]
    if not src: return "test file" if any(e["isTest"] for e in es) else "other"
    n = max(e["rekeyed"] for e in src)
    return "src leaf (<200 re-keyed)" if n < 200 else "src mid (200-600)" if n <= 600 else "src hub (>600)"
tot = collections.defaultdict(collections.Counter); cnt = collections.defaultdict(collections.Counter)
nrev = collections.Counter(); fails = []
for key, es in revs.items():
    c = cls(es); nrev[c] += 1
    files = {}
    for e in es:
        for f in e["files"]: files.setdefault(f["tf"], []).append((e, f))
    for tf, lst in files.items():
        reaches = [f["reach"] for _, f in lst]
        if any(e["path"] == tf for e, _ in lst) or "own" in reaches: k = "own test file"
        elif "executed" in reaches: k = "reached"
        elif all(x in ("module-not-loaded", "loaded-not-executed", "no-code-line-changed") for x in reaches): k = "not reached"
        else: k = "not evaluable"
        d = lst[0][1]["dur"]; tot[c][k] += d; cnt[c][k] += 1
        if k == "not reached" and any(f["newFail"] for _, f in lst):
            txt = open(os.path.join(tree, tf)).read() if os.path.exists(os.path.join(tree, tf)) else ""
            mech = "reads sources (bundle, package)" if re.search(r"package|plugin|bundle", tf) else "spawns a process" if re.search(r"spawn|execFile|fork\(|Daemon|squeal\.mjs", txt) else "other"
            fails.append((c, key[1], tf, mech, sorted({e["path"] for e in es})))
for c in nrev:
    T = sum(tot[c].values()); ev = tot[c]["reached"] + tot[c]["not reached"]
    print(f"== {c}: {nrev[c]} revisions; file-seconds {T:.0f}")
    for k in ("own test file", "reached", "not reached", "not evaluable"):
        print(f"   {k:15s} files {cnt[c][k]:6d}  file-s {tot[c][k]:9.0f}  share of all {100*tot[c][k]/max(T,1):5.1f}%")
    print(f"   not reached / evaluable file-seconds: {100*tot[c]['not reached']/max(ev,1):.1f}%")
print("== new failures in files not reached")
for x in fails: print(*x)
