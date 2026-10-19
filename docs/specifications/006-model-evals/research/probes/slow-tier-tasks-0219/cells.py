# Throwaway (006-92): tabulate Luna and Sonnet cells of a2, a3, a8, a11 across four atomic runs,
# read only from results files. Usage: python3 -I cells.py <results.atomic.json>...
import json, re, sys
from collections import Counter

TASKS = ("a2-slow", "a3-harmless", "a8-load-hold", "a11-inherited-flake")

def cmds(cell):
    out = []
    for t in cell.get("transcript") or []:
        if t.startswith("$ "):
            first = t.split("\n", 1)[0]
            if "squeal" in first or "vitest" in first or "npm" in first:
                m = re.search(r"squeal\.mjs\\?\"? (\S+(?: \S+){0,3})", first)
                out.append(m.group(1).replace("'", "").replace('"', "") if m else first[2:90])
    return out

for path in sys.argv[1:]:
    d = json.load(open(path))
    print(f"### {d['run']} {d['squealVersion']}")
    for task in TASKS:
        for model in ("gpt-6-luna", "claude-sonnet-5-5"):
            cells = sorted((c for c in d["cells"] if c["task"] == task and c["model"] == model and c["variant"] == "p0"), key=lambda c: c["rep"])
            if not cells:
                continue
            ct = Counter(str(c["atomic"]["measures"].get("claim-true")) for c in cells)
            print(f"## {task} {model}: claim-true {dict(ct)}  claims {dict(Counter(c['claim'] for c in cells))}")
            for c in cells:
                tl = c.get("timeline") or []
                last = [s for s in tl if s.get("k") == "squeal"]
                ls = last[-1] if last else {}
                print(f"  r{c['rep']:<2} ct={c['atomic']['measures'].get('claim-true')!s:5} truth={c['truthPass']!s:5} "
                      f"last(rev={ls.get('revision')} pend={ls.get('pending')} slowNC={ls.get('slowNotCurrent')} fail={ls.get('failures')}) "
                      f"wall={c['wallS']}")
                print(f"      cmds: {cmds(c)}")
                print(f"      claim: {c['claimLine']}")
