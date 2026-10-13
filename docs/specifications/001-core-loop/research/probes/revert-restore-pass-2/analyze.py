#!/usr/bin/env python3
"""Probe 001-343 (throwaway): classifies every armed run of the revert-restore probe.

Usage: python3 -I analyze.py <out dir> [-v]. For each repetition and attempt: the armed run (the
store's run whose span holds the armed time), whether the adapter kept it, the runner-part
invalidates of src/mod.ts that landed while it ran and what Vite held of the module then
(`cached`: a transform, so `hold` keeps its stamp, 001-264; `in flight`: no transform, 001-343),
the revisions after `at` that name the test file or the module, and which run's result line 195 read.
"""
import json, os, sys

out = sys.argv[1]
verbose = "-v" in sys.argv
tot = dict(reps=0, bad=0, planted=0, attempts=0, armed=0, kept=0, kept_cached=0, kept_inflight=0,
           kept_other=0, split_test=0, split_mod=0, inv_window=0, current_from_armed=0, current_from_later=0)
for rid in sorted(os.listdir(out)):
    d = os.path.join(out, rid)
    if not os.path.isdir(d) or not os.path.exists(f"{d}/dump.json"):
        continue
    tot["reps"] += 1
    probe = [json.loads(l) for l in open(f"{d}/probe.jsonl")]
    daemon = [json.loads(l) for l in open(f"{d}/daemon.jsonl")] if os.path.exists(f"{d}/daemon.jsonl") else []
    dump = json.load(open(f"{d}/dump.json"))
    attempts = [e for e in probe if e["ev"] == "attempt"]
    bad = attempts[-1]["planted"] and "current pass" in dump["state"]
    tot["bad"] += bad
    tot["planted"] += attempts[-1]["planted"]
    lines = [f"== {rid} planted={attempts[-1]['planted']} state={dump['state']} bad={bad} load={attempts[0]['load'][0]:.1f}..{attempts[-1]['load'][0]:.1f}"]
    # Adapter runs, start to end, from the daemon log.
    runs, cur = [], None
    for e in daemon:
        if e["ev"] == "run-start":
            cur = {"start": e["t"], "loadedSince": e["loadedSince"], "files": e["files"], "inv": []}
            runs.append(cur)
        elif e["ev"] == "invalidate" and cur is not None and "end" not in cur and e["running"]:
            cur["inv"].append(e)
        elif e["ev"] == "run-end" and cur is not None:
            cur.update(end=e["t"], completed=e["completed"], ran=e["ran"], heard=e["heard"], failure=e["failure"])
    current_keys = {r["key"] for r in dump["results"] if r["test_path"] == "test/reverting.test.ts"}
    last_result = max((r for r in dump["results"] if r["test_path"] == "test/reverting.test.ts"), key=lambda r: r["recorded_at"], default=None)
    for a in attempts:
        tot["attempts"] += 1
        revs = [r for r in dump["revisions"] if r["number"] > a["at"]]
        nxt = next((b for b in attempts if b["attempt"] == a["attempt"] + 1), None)
        if nxt:
            revs = [r for r in revs if r["number"] <= nxt["at"]]
        names = lambda path: [r["number"] for r in revs if any(c["path"] == path for c in json.loads(r["changes"]))]
        test_revs, mod_revs = names("test/reverting.test.ts"), names("src/mod.ts")
        tot["split_test"] += len(test_revs) > 1
        tot["split_mod"] += len(mod_revs) > 0
        armed = a["armedAt"]
        run = next((r for r in runs if armed and r["start"] <= armed <= r.get("end", 1e20)), None)
        desc = f"  attempt {a['attempt']} at={a['at']} loaded={a['loaded']} planted={a['planted']} test-revs={test_revs} mod-revs={mod_revs}"
        if run is None:
            lines.append(desc + " armed run: none found")
            continue
        tot["armed"] += 1
        kept = "test/reverting.test.ts" in (run.get("completed") or [])
        window = [i for i in run["inv"] if any(p.startswith("src/mod.ts:change") for p in i["paths"]) and armed <= i["t"] <= (a["restoredAt"] or 1e20) + 50]
        tot["inv_window"] += bool(window)
        held = ["cached" if any(m["cached"] for m in i["mod"]) else ("in flight" if i["mod"] else "no module") for i in window]
        if kept:
            tot["kept"] += 1
            if "in flight" in held: tot["kept_inflight"] += 1
            elif "cached" in held: tot["kept_cached"] += 1
            else: tot["kept_other"] += 1
        lines.append(desc + f" armed run +{run['start'] - probe[0]['t']}..+{run.get('end', 0) - probe[0]['t']} kept={kept} mid-window src/mod.ts invalidates={held} ran={len(run.get('ran') or [])} heard={run.get('heard')}")
    if last_result:
        span = next((r for r in dump["runs"] if r["id"] == last_result["run_id"]), None)
        from_armed = span is not None and any(a["armedAt"] and span["started_at"] <= a["armedAt"] <= (span["ended_at"] or 1e20) for a in attempts)
        if "current pass" in dump["state"]:
            tot["current_from_armed" if from_armed else "current_from_later"] += 1
        lines.append(f"  last stored result of test/reverting.test.ts: {last_result['outcome']} from {'an armed' if from_armed else 'an unarmed'} run {last_result['run_id'][:8]} at revision {last_result['revision']}")
    if verbose or bad:
        print("\n".join(lines))
print(json.dumps(tot))
