# Per session: model requests, requests with the primer, distinct SQUEAL texts the model saw
# (as user messages, and as denied tool results), and every shell command the agent ran that
# runs tests. Usage: python3 -I stats.py <name>...
import json, re, sys

D = "/home/squeal-e2e/dogfood-009/logs/"
TEST = re.compile(r"\b(vitest|npm (run )?test|test:types|test:runtime|npx tsc|tsc )")
for name in sys.argv[1:]:
    reqs = [json.loads(l) for l in open(D + name + ".requests.jsonl")]
    reqs = [r for r in reqs if r.get("request")]
    primer = 0
    squeal_user, squeal_tool, cmds = {}, {}, []
    for r in reqs:
        msgs = r["request"]["messages"]
        s = msgs[0].get("content") if msgs else ""
        s = s if isinstance(s, str) else json.dumps(s)
        has = "Squeal runs this repository" in s
        primer += has
        if not has:
            print(f"  request {r['n']} has no primer; system prompt starts: {s[:90]!r}")
        for m in msgs:
            c = m.get("content")
            c = c if isinstance(c, str) else json.dumps(c, ensure_ascii=False)
            if "SQUEAL ·" in c and (m["role"] != "tool" or "was not applied" in c):
                head = c[c.find("SQUEAL ·"):][:120]
                (squeal_tool if m["role"] == "tool" else squeal_user).setdefault(head, r["n"])
            for tc in m.get("tool_calls") or []:
                if tc["function"]["name"] == "bash":
                    cmd = json.loads(tc["function"]["arguments"]).get("command", "")
                    if TEST.search(cmd) and cmd not in cmds:
                        cmds.append(cmd)
    print(f"{name}: {len(reqs)} requests, primer in {primer}; SQUEAL as user text {len(squeal_user)}, as a denied tool result {len(squeal_tool)}")
    for c in cmds:
        print(f"  ran tests itself: {c[:160]}")
