# Condenses one session's proxy log (what reached the model) into a readable timeline.
# Usage: python3 -I condense.py <name>   (reads dogfood-008/logs/<name>.requests.jsonl)
# Per request: time, the new messages since the previous request of the same conversation, the
# tool calls the model answered with, whether a system message carries the Squeal primer (and
# the CLI it names), and every text that names Squeal, with its role. OpenCode's title requests
# (system prompt "You are a title generator") are listed in one line each.
import json, re, sys

D = "/home/squeal-e2e/dogfood-008/logs/"
name = sys.argv[1]
reqs = [json.loads(l) for l in open(D + name + ".requests.jsonl")]
reqs = [r for r in reqs if r.get("request")]

def text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""

def answer(resp):
    out, calls = "", {}
    for line in (resp or "").splitlines():
        if not line.startswith("data: ") or line == "data: [DONE]":
            continue
        try:
            d = json.loads(line[6:])
        except Exception:
            continue
        for ch in d.get("choices", []):
            delta = ch.get("delta", {})
            out += delta.get("content") or ""
            for tc in delta.get("tool_calls") or []:
                c = calls.setdefault(tc.get("index", 0), {"name": "", "args": ""})
                f = tc.get("function", {})
                c["name"] += f.get("name") or ""
                c["args"] += f.get("arguments") or ""
    return out, list(calls.values())

def short(s, n):
    s = s.strip()
    return s if len(s) <= n else s[:n] + " [...]"

def squealy(t):
    return "SQUEAL" in t or t.lstrip().startswith("Squeal")

def is_title(q):
    return any("title generator" in text(m.get("content")) for m in q.get("messages", []) if m.get("role") == "system")

prev = []
for r in reqs:
    q = r["request"]
    msgs = q.get("messages", [])
    if is_title(q):
        print(f"\n(title request {r['n']} at {r['at'][11:19]}, model {q.get('model')})")
        continue
    sys_ = "\n".join(text(m.get("content")) for m in msgs if m.get("role") == "system")
    primer = "Squeal runs this repository" in sys_
    cli = re.search(r'"[^"]*node"[^\n`]*?squeal\.mjs"', sys_)
    print(f"\n## request {r['n']} at {r['at'][11:19]} ({r.get('ms')} ms, status {r.get('status')}), model {q.get('model')}, {len(msgs)} messages, primer {'yes' if primer else 'NO'}" + (f", CLI …{cli.group(0)[-70:]}" if cli else ""))
    # New messages: those after the longest common prefix with the previous request.
    k = 0
    while k < min(len(prev), len(msgs)) and prev[k] == msgs[k]:
        k += 1
    if k < len(prev) and k > 0:
        print(f"  (history differs from the previous request from message {k}: compaction or another conversation)")
    for m in msgs[max(k, 1):]:
        t = text(m.get("content"))
        role = m.get("role")
        if role == "system":
            continue
        if role == "assistant":
            tcs = m.get("tool_calls") or []
            names = ", ".join(f"{c['function']['name']}({short(c['function']['arguments'], 160)})" for c in tcs)
            print(f"- assistant: {short(t, 300)}" + (f" | calls {names}" if names else ""))
        elif role == "tool":
            i = t.find("Squeal")
            flag = " **SQUEAL**" if i >= 0 and ("SQUEAL ·" in t or "\n\nSqueal" in t) else ""
            print(f"- tool result{flag}: {short(t, 160)}" + (f"\n    …{short(t[max(0, t.find(chr(10) + chr(10) + 'Squeal') ):], 1500)}" if flag else ""))
        else:
            flag = " **SQUEAL**" if squealy(t) else ""
            print(f"- {role}{flag}: {short(t, 1500 if flag else 500)}")
    prev = msgs
    out, calls = answer(r.get("response"))
    if out.strip() or calls:
        print(f"  => answered: {short(out, 500)}" + "".join(f"\n     call {c['name']}({short(c['args'], 200)})" for c in calls))
