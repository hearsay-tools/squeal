# Throwaway probe for 015-10 Part C. Not product code.
#   python3 -I timeline.py <session dir> [--all]
# A session's timeline from its stamped stream.jsonl: tool calls (Edit/Write paths, Bash
# commands), every hook text that holds SQUEAL, and the agent's text, in seconds from the first
# line. Complexity lines are marked `>>`. Without --all, SQUEAL texts print only their
# complexity lines and their first line.
import json
import sys

d = sys.argv[1]
full = "--all" in sys.argv
t0 = None
names = {}
for raw in open(f"{d}/stream.jsonl"):
    ts, _, line = raw.partition(" ")
    ts = int(ts)
    t0 = t0 or ts
    t = (ts - t0) / 1000
    try:
        ev = json.loads(line)
    except ValueError:
        continue
    typ = ev.get("type")
    if typ == "system" and ev.get("subtype") == "hook_response":
        out = ev.get("output") or ""
        ctx = ""
        try:
            o = json.loads(out) if out.strip().startswith("{") else {}
            hso = o.get("hookSpecificOutput") or {}
            ctx = hso.get("additionalContext") or o.get("systemMessage") or o.get("reason") or ""
            if o.get("decision"):
                ctx = f"[decision {o.get('decision')}] {o.get('reason', '')}"
        except ValueError:
            ctx = out
        ctx = ctx or ev.get("stdout") or ""
        if not ("SQUEAL" in ctx or "omplexity" in ctx):
            if full:
                print(f"{t:8.1f} HOOK {ev.get('hook_name')}: (no SQUEAL text)")
        else:
            lines = ctx.split("\n")
            print(f"{t:8.1f} HOOK {ev.get('hook_name')}: {lines[0][:160]}")
            for ln in lines[1:]:
                if "omplexity" in ln or "functions are not counted" in ln:
                    print(f"{'':8} >> {ln[:300]}")
                elif full:
                    print(f"{'':8}    {ln[:300]}")
    elif typ == "assistant":
        for c in ev.get("message", {}).get("content", []):
            if c.get("type") == "tool_use":
                i = c.get("input", {})
                names[c.get("id")] = c.get("name")
                what = i.get("file_path") or i.get("command") or i.get("pattern") or json.dumps(i)[:120]
                print(f"{t:8.1f} TOOL {c.get('name')}: {str(what)[:200]}")
            elif c.get("type") == "text" and c.get("text", "").strip():
                print(f"{t:8.1f} TEXT {c['text'].strip()[:300]!r}")
    elif typ == "user":
        for c in ev.get("message", {}).get("content", []) if isinstance(ev.get("message", {}).get("content"), list) else []:
            if c.get("type") == "tool_result":
                print(f"{t:8.1f} DONE {names.get(c.get('tool_use_id'), '?')}")
                body = c.get("content")
                if isinstance(body, list):
                    body = " ".join(x.get("text", "") for x in body if isinstance(x, dict))
                body = str(body)
                if "SQUEAL" in body or "omplexity" in body:
                    for ln in body.split("\n"):
                        if "omplexity" in ln or "SQUEAL" in ln:
                            print(f"{'':8} RESULT>> {ln[:300]}")
    elif typ == "result":
        print(f"{t:8.1f} RESULT {ev.get('subtype')} turns={ev.get('num_turns')} cost={ev.get('total_cost_usd')}")
