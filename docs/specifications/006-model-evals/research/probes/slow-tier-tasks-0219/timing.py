# Throwaway (006-92): seconds from each session's last edit to its final message, from the cell's
# events.jsonl (`t`, ms since the session start), for a2, a3 and a8 in run cd33f5 (0.1.219).
# Codex: the last completed `file_change` item to the last `agent_message`. Claude: the last
# Edit/Write/MultiEdit tool_use to the `result` event. Reads only. Usage: python3 -I timing.py
import json, statistics

BASE = "/tmp/squeal-evals-1001/cells/9902354698a8/20261018T211619Z-cd33f5"
for task in ("a2-slow", "a3-harmless", "a8-load-hold"):
    for model in ("codex-gpt-6-luna", "claude-claude-sonnet-5-5"):
        gaps = []
        for r in range(1, 11):
            edit = end = None
            for line in open(f"{BASE}/{task}.p0.{model}.e-medium.r{r}/out/events.jsonl"):
                e = json.loads(line)
                if e.get("type") == "item.completed":
                    kind = e["item"].get("type")
                    if kind == "file_change": edit = e["t"]
                    if kind == "agent_message": end = e["t"]
                msg = e.get("message"); msg = msg if isinstance(msg, dict) else {}
                for block in msg.get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") in ("Edit", "Write", "MultiEdit"):
                        edit = e["t"]
                if e.get("type") == "result": end = e["t"]
            gaps.append(None if edit is None or end is None else round((end - edit) / 1000, 1))
        ok = [g for g in gaps if g is not None]
        print(f"{task} {model}: edit-to-claim s {gaps}; median {statistics.median(ok) if ok else None}; >=17.5 s: {sum(g >= 17.5 for g in ok)}/{len(ok)}")
