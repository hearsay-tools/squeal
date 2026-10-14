# Throwaway probe for 005-18 part 1. Not product code.
# One row per graded cell under <cells dir>: run, cell, arm, warm or cold, harness and model,
# load at the session's start, its own test runs (each with D8 step 1's verdict on its shape, from
# d8-reach.py), D8 denies (the reason's "The command did not run." in the session's events), what
# the agent did next after a deny (accepted: no test command for the same files before its claim;
# reran: the next test command), the claim against ground truth, and the atomic measures.
# Run as squeal-e2e, which owns the cells, with d8-reach.py concatenated ahead:
#   (echo AS_LIBRARY = True; cat d8-reach.py analyze-part1.py) | python3 -I - <cells dir> [--json]
import json
import os
import sys

DENY = "The command did not run."


def cells(root):
    for d, dirs, fs in os.walk(root):
        if "grade.json" in fs and d.endswith("/out"):
            yield os.path.dirname(d)
        dirs[:] = [x for x in dirs if x not in ("work", "store", "harness", "home", "codex", "tmp")]


def denies(events):
    """(count, what followed the first): the deny reason may reach the model as a tool result."""
    n, after, seen = 0, None, False
    for line in open(events, errors="replace"):
        if DENY in line:
            n += 1
            seen = True
            continue
        if seen and after is None:
            for cmd in commands_in(line):
                if TEST.search(cmd):
                    after = "reran: " + cmd[:100]
    return n, after if n else None


def commands_in(line):
    try:
        e = json.loads(line)
    except ValueError:
        return []
    ev = e.get("event", e) if isinstance(e, dict) else {}
    out = []
    msg = ev.get("message") if isinstance(ev, dict) else None
    content = msg.get("content") if isinstance(msg, dict) else None
    if isinstance(content, list):
        out += [c.get("input", {}).get("command", "") for c in content
                if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") == "Bash"]
    item = ev.get("item") if isinstance(ev, dict) else None
    if isinstance(item, dict) and item.get("type") == "command_execution" and ev.get("type") == "item.started":
        out.append(item.get("command", ""))
    return out


rows = []
for cell in sorted(cells(sys.argv[1])):
    g = json.load(open(os.path.join(cell, "out", "grade.json")))
    if g.get("skipped"):
        continue
    runs = (g.get("timeline") or {}).get("runs", [])
    shapes = [classify(r.get("cmd", "")) for r in runs]
    n, after = denies(os.path.join(cell, "out", "events.jsonl"))
    a = g.get("atomic") or {}
    rows.append({
        "run": g["run"], "cell": g["id"], "arm": g["variant"], "cold": g.get("cold", False),
        "task": g["task"], "harness": g["harness"], "model": g["model"],
        "loadStart": (g.get("load") or {}).get("start"), "wallS": g.get("wallS"),
        "ownRuns": len(runs), "shapes": shapes, "cmds": [r.get("cmd", "")[:120] for r in runs],
        "d8Denies": n, "afterDeny": after or ("accepted" if n else None),
        "claim": g.get("claim"), "truthPass": (g.get("truth") or {}).get("pass"),
        "claimTrue": g.get("claimTrue"), "falsePass": g.get("falsePass"),
        "measures": a.get("measures"), "deliveries": g.get("deliveries"),
        "cost": g.get("cost"),
    })
if "--json" in sys.argv:
    print(json.dumps(rows, indent=1))
else:
    for r in rows:
        print("\t".join(str(x) for x in (
            r["run"][:15], r["cell"], f"load {r['loadStart']}", f"wall {r['wallS']}", f"own {r['ownRuns']}",
            f"d8 {r['d8Denies']}", r["afterDeny"], f"claim {r['claim']}", f"truth {'pass' if r['truthPass'] else 'fail'}",
            f"true {r['claimTrue']}", json.dumps(r["measures"]), "|".join(r["shapes"]))))
