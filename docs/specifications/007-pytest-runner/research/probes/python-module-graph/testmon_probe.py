"""Throwaway: testmon overhead and selection on edits, against static and observed closures.

python3 testmon_probe.py <fixture> <static graph.json> <truth dir> <edits.json> <out.json>
edits.json: [{"name":..., "path":..., "op": "append"|"replace"|"create", "text":..., "old":...}]
"""
import json, os, re, subprocess, sys, time
fix, gpath, truth_dir, edits_path, out = sys.argv[1:6]
fix = os.path.realpath(fix)
sys.argv = [sys.argv[0], fix, gpath, truth_dir]
exec(open(os.path.join(os.path.dirname(__file__), "compare_lib.py")).read())
py = os.path.join(fix, ".venv/bin/python")
env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")

def run(*args):
    t = time.perf_counter()
    p = subprocess.run([py, "-m", "pytest", "-v", *args], cwd=fix, capture_output=True, text=True, env=env)
    dt = time.perf_counter() - t
    ran = sorted({m.group(1) for l in p.stdout.splitlines() for m in [re.match(r"^(\S+\.py) [.FEsxX]+", l)] if m})
    tail = [l for l in p.stdout.splitlines() if " in " in l and ("passed" in l or "deselected" in l or "no tests" in l)]
    return dt, ran, (tail[-1] if tail else p.stdout[-300:])

res = {"timing": {}, "edits": []}
for f in [".testmondata", ".testmondata-shm", ".testmondata-wal"]:
    if os.path.exists(os.path.join(fix, f)):
        os.remove(os.path.join(fix, f))
res["timing"]["plain"] = [run()[0] for _ in range(3)]
res["timing"]["testmon_cold"] = run("--testmon")[0]
res["timing"]["testmon_nochange"] = [run("--testmon")[0] for _ in range(2)]
res["timing"]["testmon_forceall_coverage"] = [run("--testmon-noselect")[0] for _ in range(2)]
res["db_bytes"] = os.path.getsize(os.path.join(fix, ".testmondata"))
for e in json.load(open(edits_path)):
    p = os.path.join(fix, e["path"])
    orig = open(p).read() if os.path.exists(p) else None
    if e["op"] == "append":
        open(p, "a").write(e["text"])
    elif e["op"] == "replace":
        open(p, "w").write(orig.replace(e["old"], e["text"], 1))
    elif e["op"] == "create":
        open(p, "w").write(e["text"])
    dt, ran, tail = run("--testmon")
    static = sorted(affected_static(e["path"]))
    observed = sorted(affected_observed(e["path"]))
    res["edits"].append({"name": e["name"], "testmon_files": ran, "testmon_n": len(ran), "static_n": len(static),
                         "observed_n": len(observed), "testmon_minus_observed": sorted(set(ran) - set(observed))[:5],
                         "observed_minus_testmon_n": len(set(observed) - set(ran)), "tail": tail, "seconds": dt})
    if orig is None:
        os.remove(p)
    else:
        open(p, "w").write(orig)
    run("--testmon")  # settle the db back to the original tree
json.dump(res, open(out, "w"), indent=1)
print(json.dumps(res["timing"]), res["db_bytes"])
for e in res["edits"]:
    print(e["name"], "testmon", e["testmon_n"], "static", e["static_n"], "observed", e["observed_n"], "observed-not-testmon", e["observed_minus_testmon_n"], "|", e["tail"])
