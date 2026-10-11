#!/usr/bin/env python3
"""Per armed run: did the watcher split it, did a change-invalidation of src/mod.ts land in its revert
window, did the adapter keep it; per repetition: attempts, final state, load."""
import json, os, sys, collections
out = sys.argv[1]
reps = []
for d in sorted(os.listdir(out)):
    p = os.path.join(out, d, "probe.jsonl")
    if not os.path.exists(p): continue
    ev = [json.loads(l) for l in open(p)]
    dump = json.load(open(os.path.join(out, d, "dump.json")))
    armed = []
    cur = None
    for e in ev:
        if e["ev"] == "run-start": run = {"id": e["runId"], "start": e["t"]}; last_run = run
        if e["ev"] == "armed": cur = {"t": e["t"], "attempt": e["attempt"], "run": last_run["id"], "inwindow": 0, "stamp": None}
        if e["ev"] == "stamp" and cur and cur["stamp"] is None: cur["stamp"] = e["t"]
        if e["ev"] == "invalidate" and cur and "restored" not in cur and any(p["path"] == "src/mod.ts" and p["kind"] == "change" for p in e["paths"]):
            cur["inwindow"] += 1
        if e["ev"] == "restored" and cur: cur["restored"] = e["t"]
        if e["ev"] == "run-end" and cur and e["runId"] == cur["run"]:
            cur["kept"] = bool(e["completed"]); cur["ran"] = len(e["ran"]); cur["heard"] = e["heard"]
            armed.append(cur); cur = None
    attempts = [e for e in ev if e["ev"] == "attempt"]
    reps.append(dict(id=d, attempts=len(attempts), split=sum(1 for a in attempts if not a["planted"]), state=dump["state"],
                     bad=any(s.startswith("current pass") for s in dump["state"]), load=dump["loadStart"][0],
                     armed=armed))
c = collections.Counter((r["attempts"], r["bad"]) for r in reps)
print("repetitions", len(reps), "by (attempts, bad):", dict(c))
print("load range", min(r["load"] for r in reps), max(r["load"] for r in reps))
ar = [a for r in reps for a in r["armed"]]
print("armed runs", len(ar), "kept", sum(1 for a in ar if a.get("kept")), "in-window invalidations", sum(1 for a in ar if a["inwindow"]),
      "window ms max", max((a.get("restored", 0) - (a["stamp"] or a["t"])) for a in ar) if ar else None)
for r in reps:
    if r["bad"] or any(a.get("kept") for a in r["armed"]): print(json.dumps(r))

# A revision naming src/mod.ts that landed after an attempt's settle returned yet is numbered at or
# below the next attempt's `at`: its runner part may fall inside the next armed run's revert window.
late = 0; latefirst = []
for d in sorted(os.listdir(out)):
    p = os.path.join(out, d, "probe.jsonl")
    if not os.path.exists(p): continue
    ev = [json.loads(l) for l in open(p)]
    dump = json.load(open(os.path.join(out, d, "dump.json")))
    attempts = [e for e in ev if e["ev"] == "attempt"]
    for prev, nxt in zip(attempts, attempts[1:]):
        for r in dump["revisions"]:
            if r["number"] <= nxt["at"] and r["created_at"] > prev["t"] and "src/mod.ts" in r["changes"]:
                late += 1; latefirst.append((d, nxt["attempt"], r["number"]))
print("late mod.ts revisions at or below the next attempt's at:", late, latefirst[:5])
