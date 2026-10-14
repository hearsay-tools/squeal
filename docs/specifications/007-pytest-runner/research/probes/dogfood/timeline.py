"""Throwaway probe for 007-18: a session's timeline from its timestamped transcript.

    python3 -I timeline.py <id>.jsonl [t0]

Each line of the input is `<epoch seconds> <JSON event>` (sessions.sh). Claude Code stream-json:
tool calls (Bash commands, edits by path), hook responses that carry Squeal text, the final
result. Codex exec --json: command executions, file changes, agent messages. Times are seconds
since the first line, or since t0. Output is one line per event, trimmed to 300 characters.
"""

import json
import sys

path = sys.argv[1]
lines = [l.split(" ", 1) for l in open(path, encoding="utf-8") if " " in l]
t0 = float(sys.argv[2]) if len(sys.argv) > 2 else float(lines[0][0])


def out(t, kind, text):
    text = " ".join(str(text).split())
    print(f"{float(t) - t0:7.1f} {kind:10s} {text[:300]}")


for t, raw in lines:
    try:
        e = json.loads(raw)
    except ValueError:
        continue
    typ = e.get("type")
    # Claude Code
    if typ == "assistant":
        for c in e.get("message", {}).get("content", []):
            if c.get("type") == "tool_use":
                i = c.get("input", {})
                what = i.get("command") or i.get("file_path") or i.get("pattern") or json.dumps(i)
                out(t, c.get("name", "tool"), what)
            elif c.get("type") == "text" and c.get("text", "").strip():
                out(t, "say", c["text"])
    elif typ == "user":
        for c in e.get("message", {}).get("content", []) if isinstance(e.get("message", {}).get("content"), list) else []:
            if c.get("type") == "tool_result":
                body = c.get("content")
                if isinstance(body, list):
                    body = " ".join(x.get("text", "") for x in body if isinstance(x, dict))
                if "SQUEAL" in str(body) or "squeal" in str(body):
                    out(t, "result", body)
    elif typ == "system" and e.get("subtype") == "hook_response":
        o = (e.get("output") or "") + (e.get("stdout") or "")
        if o.strip():
            out(t, f"hook:{e.get('hook_event')}", o)
    elif typ == "system" and e.get("subtype") == "init":
        out(t, "init", f"model {e.get('model')} plugins {e.get('plugins')}")
    elif typ == "result":
        out(t, "final", e.get("result", ""))
    # Codex
    elif typ in ("item.started", "item.completed"):
        it = e.get("item", {})
        k = it.get("type") or it.get("item_type")
        if k == "command_execution" and typ == "item.started":
            out(t, "exec", it.get("command"))
        elif k == "command_execution" and typ == "item.completed":
            o = it.get("aggregated_output", "")
            if "SQUEAL" in o or "squeal" in o.lower():
                out(t, "exec-out", o)
        elif k == "file_change" and typ == "item.completed":
            out(t, "edit", [c.get("path") for c in it.get("changes", [])])
        elif k in ("agent_message", "assistant_message") and typ == "item.completed":
            out(t, "say", it.get("text", ""))
        elif k == "reasoning":
            pass
        elif typ == "item.completed" and k not in ("command_execution",):
            out(t, k or "item", json.dumps(it)[:300])
    elif typ in ("turn.completed", "turn.failed", "error"):
        out(t, typ, json.dumps(e)[:300])
