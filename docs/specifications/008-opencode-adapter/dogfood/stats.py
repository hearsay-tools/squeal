# Per session: model requests (title requests left out), requests with the primer, distinct
# Squeal texts the model saw as user text and appended to tool results, denied edits, and every
# shell command the agent ran that runs tests. Usage: python3 -I stats.py <name>...
import json, re, sys

D = "/home/squeal-e2e/dogfood-008/logs/"
TEST = re.compile(r"\b(vitest|npm (run )?test|test:types|test:runtime|npx tsc|tsc )")

def text(c):
    return c if isinstance(c, str) else "\n".join(p.get("text", "") for p in (c or []) if isinstance(p, dict))

for name in sys.argv[1:]:
    reqs = [json.loads(l) for l in open(D + name + ".requests.jsonl")]
    reqs = [r for r in reqs if r.get("request")]
    reqs = [r for r in reqs if not any("title generator" in text(m.get("content")) for m in r["request"]["messages"] if m["role"] == "system")]
    primer = 0
    as_user, in_tool, denied, cmds = {}, {}, {}, []
    for r in reqs:
        msgs = r["request"]["messages"]
        s = "\n".join(text(m.get("content")) for m in msgs if m["role"] == "system")
        has = "Squeal runs this repository" in s
        primer += has
        if not has:
            print(f"  request {r['n']} has no primer")
        for m in msgs:
            c = text(m.get("content"))
            if m["role"] == "user" and "SQUEAL" in c:
                as_user.setdefault(c[c.find("SQUEAL"):][:120], r["n"])
            elif m["role"] == "tool" and "SQUEAL ·" in c:
                head = c[c.find("SQUEAL ·"):][:120]
                (denied if "was not applied" in c else in_tool).setdefault(head, r["n"])
            for tc in m.get("tool_calls") or []:
                if tc["function"]["name"] == "bash":
                    try:
                        cmd = json.loads(tc["function"]["arguments"]).get("command", "")
                    except Exception:
                        cmd = tc["function"]["arguments"]
                    if TEST.search(cmd) and cmd not in cmds:
                        cmds.append(cmd)
    print(f"{name}: {len(reqs)} requests, primer in {primer}; SQUEAL as user text {len(as_user)}, after a tool result {len(in_tool)}, as a denied edit {len(denied)}")
    for c in cmds:
        print("  ran tests itself: " + re.sub(r'"[^"]*node" [^"]*"[^"]*squeal\.mjs"', "squeal", c)[:200])
