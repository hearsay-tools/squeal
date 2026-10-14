# Throwaway probe for 005-18 part 3. Not product code.
# Reads metric.mjs --json output and prints goal 6's rates per editing session, in 005-01's
# terms (research/adoption-baseline.md question 3): own runs, own runs outside a full-suite gate
# (reason != "gate"), test wall time, the gate's share of runs and wall time, sessions pulling
# Squeal, and workers' full-suite Vitest runs; overall, by role, by harness and by day.
#   python3 -I summarize-metric.py <metric.json>
import json
import sys
from collections import defaultdict

data = json.load(open(sys.argv[1]))
sessions = data["sessions"]


def rates(group):
    edit = [s for s in group if s.get("edits", 0) > 0]
    runs = [r for s in edit for r in s.get("runs", [])]
    gate = [r for r in runs if r.get("reason") == "gate"]
    wall = sum(r.get("wallMs") or 0 for r in runs) / 60000
    gate_wall = sum(r.get("wallMs") or 0 for r in gate) / 60000
    pulling = sum(1 for s in edit if s.get("pulls"))
    full_vitest = sum(1 for r in runs if r.get("runner") == "vitest" and r.get("scope") == "full")
    n = len(edit) or 1
    return {
        "editSessions": len(edit),
        "ownRunsPerSession": round(len(runs) / n, 2),
        "outsideGatePerSession": round((len(runs) - len(gate)) / n, 2),
        "wallMinPerSession": round(wall / n, 2),
        "gateShareRuns": round(len(gate) / (len(runs) or 1), 3),
        "gateShareWall": round(gate_wall / (wall or 1), 3),
        "sessionsPulling": round(pulling / n, 3),
        "fullVitestPerSession": round(full_vitest / n, 2),
        "sessionsWithOwnRun": round(sum(1 for s in edit if s.get("runs")) / n, 3),
    }


def show(label, group):
    print(label, json.dumps(rates(group)))


show("all", sessions)
by = defaultdict(list)
for s in sessions:
    by["role:" + s.get("role", "?")].append(s)
    by["harness:" + s.get("harness", "?")].append(s)
    first = min((r["t"] for r in s.get("runs", [])), default=None) or s.get("start") or ""
    by["day:" + str(first)[:10]].append(s)
for k in sorted(by):
    show(k, by[k])
