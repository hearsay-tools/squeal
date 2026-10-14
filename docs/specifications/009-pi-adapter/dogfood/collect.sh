#!/bin/sh
# Copies the condensed record of each session into logs/ here: a timeline per session from the
# proxy log (condense.py), the counts (stats.py), the install, setup and update transcripts, the
# TUI screens, the process snapshot and the agent-dir trees. Raw request logs and Pi's session
# files stay in dogfood-009 (they hold the whole system prompt and file contents, no key).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
D=/home/squeal-e2e/dogfood-009
mkdir -p "$here/logs"
as() { sudo -n -u squeal-e2e "$@"; }
for s in s0-claude-refused s1-noext s2-astra s3-grok s4-sol s5-tui s6-pair; do
  as test -f "$D/logs/$s.requests.jsonl" || continue
  as python3 -I "$D/scripts/condense.py" "$s" >"$here/logs/$s.timeline.md"
done
as python3 -I "$D/scripts/stats.py" s2-astra s3-grok s4-sol s5-tui $(as test -f "$D/logs/s6-pair.requests.jsonl" && echo s6-pair) >"$here/logs/stats.txt"
for f in s0-claude-refused.txt s1-noext.txt install-0.1.172.txt setup-plan.txt setup.txt update-172-to-173.txt \
  update-173-to-174.txt s5-tui.screens.txt s5-tui.ps-before-quit.txt s6-pair.screens.txt tree-before-install.txt tree-after-install.txt; do
  as test -f "$D/logs/$f" && as cat "$D/logs/$f" >"$here/logs/$f"
done
for s in s2-astra s3-grok s4-sol; do
  as python3 -I -c '
import json, sys
for l in open(sys.argv[1]):
    e = json.loads(l)
    if e["kind"] == "event":
        ev = e["event"]; t = ev["type"]
        if t == "text": print(e["ms"], e["load"], "text", ev["text"][:300].replace("\n", " "))
        elif t == "tool-call": print(e["ms"], e["load"], "call", ev["tool"], json.dumps(ev["input"])[:160])
        elif t == "turn-end": print(e["ms"], e["load"], "TURN-END")
    elif e["kind"] == "ui" and e["type"] in ("turn.started", "turn.completed", "session.ended"): print(e["ms"], "ui", e["type"])
    elif e["kind"] in ("prompt", "end", "pid"): print(e["ms"], e["load"], e["kind"], e.get("text", e.get("pid", ""))[:200] if isinstance(e.get("text", e.get("pid", "")), str) else e.get("pid"))
    elif e["kind"] == "start": print(0, e["load"], "start", " ".join(e["args"]))
' "$D/logs/$s.events.jsonl" >"$here/logs/$s.cezar-events.txt"
done
