"""Throwaway probe for row 011-181. Usage: python3 -I eval-runs.py RESULT.json...

Reads eval result files (their parsed cell timelines, read-only) and counts each
subject's test runs (`run` events) by the class it would have outside an eval:
2 when the fixture's Squeal does not cover the runner (ledgerline covers Vitest
only), 3 when the last `squeal` event before it had no daemon, a pending, stale,
unknown or slow-not-current count, or came before an edit, else 4. As host load
every one is class 5: the eval made it on purpose."""
import json, sys
from collections import Counter

for path in sys.argv[1:]:
    d = json.load(open(path))
    c, scope = Counter(), Counter()
    for cell in d["cells"]:
        last, edited = None, False
        for e in cell.get("timeline") or []:
            if e["k"] == "edit":
                edited = True
            elif e["k"] == "squeal":
                last, edited = e, False
            elif e["k"] == "run":
                scope["full" if e["scope"].get("full") else "focused"] += 1
                if e["runner"] != "vitest":
                    k = "2 runner not covered"
                elif last is None or not last.get("daemon") or last.get("revision") is None:
                    k = "3 no daemon or no answer"
                elif edited:
                    k = "3 edit since last message"
                elif any(last.get(x) for x in ("pending", "stale", "unknown", "slowNotCurrent")):
                    k = "3 not current"
                else:
                    k = "4 current"
                c[(cell["harness"], k)] += 1
    print(json.dumps({"run": d["run"], "kind": d.get("kind"), "cells": len(d["cells"]), "cellHours": round(sum(x.get("wallS") or 0 for x in d["cells"]) / 3600, 2),
                      "runs": sum(c.values()), "scope": dict(scope), "classes": {f"{h} {k}": v for (h, k), v in sorted(c.items())}}))
