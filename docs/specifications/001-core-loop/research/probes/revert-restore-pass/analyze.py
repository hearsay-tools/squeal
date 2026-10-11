#!/usr/bin/env python3
"""Per repetition: attempts, the armed run, its fate, and which run stored the final state."""
import json, os, sys
out = sys.argv[1]
rows = []
for d in sorted(os.listdir(out)):
    p = os.path.join(out, d, "probe.jsonl")
    if not os.path.exists(p): continue
    ev = [json.loads(l) for l in open(p)]
    dump = json.load(open(os.path.join(out, d, "dump.json")))
    attempts = [e for e in ev if e["ev"] == "attempt"]
    armed_t = [e["t"] for e in ev if e["ev"] == "armed"]
    runs = {}
    for e in ev:
        if e["ev"] == "run-start": runs[e["runId"]] = {"start": e["t"]}
        if e["ev"] == "run-end" and e["runId"] in runs:
            runs[e["runId"]].update(end=e["t"], ran=len(e["ran"]), heard=e["heard"], completed=e["completed"])
        if e["ev"] == "fly" and e["runId"] in runs:
            runs[e["runId"]].update(stored=e["completed"], touched=e["touchedInputs"] + e["observedTouched"], changed=e["changed"])
    armed_runs = [rid for rid, r in runs.items() if any(r["start"] <= t <= r.get("end", 1e20) for t in armed_t)]
    cur = [r for r in dump["known"] if r["test_path"] == "test/reverting.test.ts"]
    final_runs = {r["run_id"] for r in dump["results"] if r["test_path"] == "test/reverting.test.ts"}
    rows.append(dict(id=d, attempts=len(attempts), planted=dump["planted"], state=dump["state"],
        load=round(dump["loadStart"][0],1), armed=[(rid[:8], runs[rid].get("completed"), runs[rid].get("stored"), runs[rid].get("ran"), runs[rid].get("heard"), runs[rid].get("touched")) for rid in armed_runs]))
for r in rows: print(json.dumps(r))
