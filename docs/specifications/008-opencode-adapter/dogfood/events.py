# Condenses a cezar-drive.mjs event log: one line per text, tool call, turn boundary, error,
# prompt and end, with ms since start, wall time and the 1-minute load.
# Usage: python3 -I events.py <events.jsonl>
import json, sys

for l in open(sys.argv[1]):
    e = json.loads(l)
    k = e["kind"]
    pre = "%8d %s load %5s" % (e["ms"], e["at"][11:23], e["load"])
    if k == "event":
        ev = e["event"]
        t = ev["type"]
        if t == "text":
            print(pre, "text", ev["text"][:400].replace("\n", " "))
        elif t == "tool-call":
            print(pre, "call", ev.get("tool") or ev.get("name"), json.dumps(ev.get("input"))[:200])
        elif t in ("turn-end", "done"):
            print(pre, t.upper())
        elif t in ("error", "note"):
            print(pre, t, ev.get("message", "")[:300].replace("\n", " "))
    elif k == "ui" and e["type"] in ("turn.started", "turn.completed", "session.started", "session.ended"):
        print(pre, "ui", e["type"])
    elif k == "prompt":
        print(pre, "PROMPT", e["text"][:200])
    elif k in ("end", "pid"):
        print(pre, k, e.get("turns", e.get("pid")))
    elif k == "start":
        print(pre, "start", e["scenario"].get("model"), e["scenario"].get("prompts", [""])[0][:200])
    elif k == "result":
        print(pre, "result session", e.get("sessionId"))
