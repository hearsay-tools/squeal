# Condenses one session's proxy log (what reached the model) and driver events into a
# readable timeline. Usage: python3 -I condense.py <name>   (reads dogfood-009/logs/<name>.*)
# Per request: time, load is in the events log; here the new messages since the previous
# request, the tool calls the model answered with, whether the system prompt carries the
# Squeal primer, and every text that names SQUEAL, with its role.
import json, re, sys

D = "/home/squeal-e2e/dogfood-009/logs/"
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

t0 = None
prev = 0
for r in reqs:
    q = r["request"]
    msgs = q.get("messages", [])
    sys_ = text(msgs[0].get("content")) if msgs and msgs[0].get("role") in ("system", "developer") else ""
    primer = "Squeal runs this repository" in sys_
    cli = re.search(r'"[^"]*node"[^\n]*?squeal\.mjs"', sys_)
    print(f"\n## request {r['n']} at {r['at'][11:19]} ({r.get('ms')} ms, status {r.get('status')}), {len(msgs)} messages, primer {'yes' if primer else 'NO'}" + (f", CLI {cli.group(0)[-60:]}" if cli else ""))
    for m in msgs[max(prev, 1):]:
        t = text(m.get("content"))
        role = m.get("role")
        if role == "assistant":
            tcs = m.get("tool_calls") or []
            names = ", ".join(f"{c['function']['name']}({short(c['function']['arguments'], 160)})" for c in tcs)
            print(f"- assistant: {short(t, 300)}" + (f" | calls {names}" if names else ""))
        elif role == "tool":
            flag = " **SQUEAL**" if "SQUEAL" in t else ""
            print(f"- tool result{flag}: {short(t, 600 if flag else 160)}")
        else:
            flag = " **SQUEAL**" if "SQUEAL" in t else ""
            print(f"- {role}{flag}: {short(t, 1500 if flag else 400)}")
    prev = len(msgs)
    out, calls = answer(r.get("response"))
    if out.strip() or calls:
        print(f"  => answered: {short(out, 400)}" + "".join(f"\n     call {c['name']}({short(c['args'], 200)})" for c in calls))
