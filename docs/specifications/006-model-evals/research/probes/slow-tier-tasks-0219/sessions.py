# Throwaway (006-92): each Luna cell's Codex thread id (the cell's events.jsonl), its regraded
# claim-true (the results file) and its claim line, for a2, a3 and a8 in runs 4fc7da (0.1.216,
# regraded by 006-91) and cd33f5 (0.1.219). Reads only. Usage: python3 -I sessions.py
import json, re

RUNS = [
    ("98beb8cd9f3b/20261018T184306Z-4fc7da", "/tmp/rel-0216-results/regraded/2026-10-18-0.1.216.20261018T184306Z-4fc7da.atomic.json"),
    ("9902354698a8/20261018T211619Z-cd33f5", "/tmp/rel-0219-results/2026-10-18-0.1.219.20261018T211619Z-cd33f5.atomic.json"),
]
for cells, results in RUNS:
    print(f"### {cells}")
    by = {c["id"]: c for c in json.load(open(results))["cells"]}
    for task in ("a2-slow", "a3-harmless", "a8-load-hold"):
        for r in range(1, 11):
            cid = f"{task}.p0.codex-gpt-6-luna.e-medium.r{r}"
            events = open(f"/tmp/squeal-evals-1001/cells/{cells}/{cid}/out/events.jsonl").read()
            tid = re.search(r'"thread_id":"([^"]+)"', events).group(1)
            c = by[cid]
            print(f"{tid} {task} r{r} claim-true={c['atomic']['measures']['claim-true']} | {c['claimLine']}")
