# Throwaway probe for 017-13 (after 015-10 Part C's summary.py). Not product code.
#   python3 -I summary.py <session dir>...
# Per session, from stream.jsonl (each line stamped with epoch ms): every hook text that names
# lint, with its time from the session start; for each lint line the last edit before it (an
# Edit, Write or MultiEdit call, or a Bash call that writes a file), the seconds from that edit's
# result to the delivery, the hook points between them that carried no lint line, and the
# agent's next action. Then the agent's own lint and `squeal` calls, and its final text.
import json
import re
import sys

WRITES = re.compile(r"open\([^)]*['\"]w['\"]|sed -i|perl -pi|\bcat >|\btee\b|write_text|writeFileSync|> *src/|> *packages/|> *test/")
LINT = re.compile(r"\blint\b|Lint", re.I)


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
                ctx = (o.get("hookSpecificOutput") or {}).get("additionalContext") or o.get("reason") or o.get("systemMessage") or ""
            except ValueError:
                ctx = out
            rows.append(("hook", t, ev.get("hook_name"), ctx, ts))
        elif typ == "assistant":
            for c in ev.get("message", {}).get("content", []):
                if c.get("type") == "tool_use":
                    names[c["id"]] = c
                    rows.append(("tool", t, c["name"], c.get("input", {}), ts))
                elif c.get("type") == "text" and c.get("text", "").strip():
                    rows.append(("text", t, None, c["text"].strip(), ts))
        elif typ == "user" and isinstance(ev.get("message", {}).get("content"), list):
            for c in ev["message"]["content"]:
                if c.get("type") == "tool_result":
                    body = c.get("content")
                    if isinstance(body, list):
                        body = " ".join(x.get("text", "") for x in body if isinstance(x, dict))
                    rows.append(("done", t, names.get(c.get("tool_use_id")), str(body), ts))
    return rows, t0


def is_edit(tool):
    if tool is None:
        return False
    if tool["name"] in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        return True
    return tool["name"] == "Bash" and bool(WRITES.search(tool["input"].get("command", "")))


def short(tool):
    i = tool["input"]
    return f'{tool["name"]}: {(i.get("file_path") or i.get("command") or "")[:100]!r}'



def main():
    for d in sys.argv[1:]:
        rows, t0 = load(d)
        print(f"=== {d} (t0 {t0})")
        last_edit = None
        empty = []
        edits = 0
        for k, row in enumerate(rows):
            kind, t, name, body, ts = row
            if kind == "done" and is_edit(name):
                last_edit = (t, name, ts)
                edits += 1
                empty = []
                print(f"  {t:6.1f} EDIT done {short(name)} (epoch {ts})")
            if kind == "hook" and last_edit is not None and not LINT.search(body) and name.startswith(("PostToolBatch", "PreToolUse", "PostToolUse", "Stop")):
                empty.append(f"{name}@{t:.1f}")
            if kind == "hook" and LINT.search(body):
                lines = [ln for ln in body.split("\n") if LINT.search(ln)]
                nxt = next((r for r in rows[k + 1:] if r[0] in ("tool", "text")), None)
                nxt_s = "(end)" if nxt is None else (f"TOOL {short({'name': nxt[2], 'input': nxt[3]})}" if nxt[0] == "tool" else f"TEXT {nxt[3][:160]!r}")
                lat = "" if last_edit is None else f"edit {short(last_edit[1])} done {last_edit[0]:.1f}, +{t - last_edit[0]:.1f}s, empty points before: {empty}"
                title = body.split("\n")[0][:160]
                print(f"  {t:6.1f} {name} [{title}]")
                for ln in lines:
                    print(f"         | {ln}")
                print(f"         after {lat}")
                print(f"         next: {nxt_s}")
                empty = []
        own = [r for r in rows if r[0] == "tool" and r[2] == "Bash" and re.search(r"eslint|squeal|nx lint|pnpm lint|npm run lint", r[3].get("command", ""))]
        print(f"  edits: {edits}; agent's own lint or squeal calls: {[(round(r[1], 1), r[3]['command'][:120]) for r in own]}")
        final = [r for r in rows if r[0] == "text"]
        if final:
            print(f"  final text: {final[-1][3][:1500]!r}")


if __name__ == "__main__":
    main()
