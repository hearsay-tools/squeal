# Throwaway probe for 015-10 Part C. Not product code.
#   python3 -I summary.py <session dir>...
# Per session: each SQUEAL complexity line with its time, the last edit before it (an Edit,
# Write or MultiEdit call, or a Bash call that writes a file), the seconds from that edit's
# result to the delivery, the hook points between them that carried nothing, and the agent's
# next action. Then the Squeal `squeal code` calls the agent made itself.
import json
import re
import sys

WRITES = re.compile(r"open\([^)]*['\"]w['\"]|sed -i|perl -pi|\bcat >|\btee\b|write_text|writeFileSync|> *src/|> *packages/|> *test/")


def load(d):
    t0 = None
    rows = []
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
                ctx = (o.get("hookSpecificOutput") or {}).get("additionalContext") or o.get("reason") or ""
            except ValueError:
                ctx = out
            rows.append(("hook", t, ev.get("hook_name"), ctx))
        elif typ == "assistant":
            for c in ev.get("message", {}).get("content", []):
                if c.get("type") == "tool_use":
                    names[c["id"]] = c
                    rows.append(("tool", t, c["name"], c.get("input", {})))
                elif c.get("type") == "text" and c.get("text", "").strip():
                    rows.append(("text", t, None, c["text"].strip()))
        elif typ == "user" and isinstance(ev.get("message", {}).get("content"), list):
            for c in ev["message"]["content"]:
                if c.get("type") == "tool_result":
                    body = c.get("content")
                    if isinstance(body, list):
                        body = " ".join(x.get("text", "") for x in body if isinstance(x, dict))
                    rows.append(("done", t, names.get(c.get("tool_use_id")), str(body)))
    return rows


def is_edit(tool):
    if tool is None:
        return False
    if tool["name"] in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        return True
    return tool["name"] == "Bash" and bool(WRITES.search(tool["input"].get("command", "")))


def short(tool):
    i = tool["input"]
    return f'{tool["name"]}: {(i.get("file_path") or i.get("command") or "")[:90]!r}'


for d in sys.argv[1:]:
    rows = load(d)
    print(f"=== {d}")
    last_edit = None
    empty = []
    edits = 0
    for k, row in enumerate(rows):
        kind, t, name, body = row
        if kind == "done" and is_edit(name):
            last_edit = (t, name)
            edits += 1
            empty = []
        if kind == "hook" and last_edit is not None and "omplexity" not in body and name.startswith(("PostToolBatch", "PreToolUse")):
            empty.append(f"{name}@{t:.1f}")
        if kind == "hook" and ("omplexity" in body or "functions are not counted" in body):
            lines = [ln for ln in body.split("\n") if ("omplexity" in ln or "functions are not counted" in ln) and not ln.startswith("Complexity:")]
            reg = [ln for ln in body.split("\n") if ln.startswith("Complexity:")]
            for ln in reg:
                print(f"  {t:6.1f} {name}: {ln}")
            if not lines:
                continue
            nxt = next((r for r in rows[k + 1:] if r[0] in ("tool", "text")), None)
            nxt_s = "(end)" if nxt is None else (f"TOOL {short({'name': nxt[2], 'input': nxt[3]})}" if nxt[0] == "tool" else f"TEXT {nxt[3][:140]!r}")
            lat = "" if last_edit is None else f"edit {short(last_edit[1])} done {last_edit[0]:.1f}, +{t - last_edit[0]:.1f}s, empty points before: {empty}"
            for ln in lines:
                print(f"  {t:6.1f} {name}: {ln}")
            print(f"         after {lat}")
            print(f"         next: {nxt_s}")
            empty = []
    calls = [r for r in rows if r[0] == "tool" and r[2] == "Bash" and "squeal code" in r[3].get("command", "")]
    print(f"  edits: {edits}; agent's own `squeal code` calls: {len(calls)}")
    final = [r for r in rows if r[0] == "text"]
    if final:
        print(f"  final text, complexity sentences: {[s for s in re.split(r'(?<=[.!?])\s+', final[-1][3]) if 'omplex' in s or 'over 20' in s or 'limit' in s]}")
