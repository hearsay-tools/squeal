# Throwaway (005-04): trims each subject session to what the findings cite: Claude Code's init
# (version, squeal plugin entry, squeal skills, AskUserQuestion in tools), its Bash calls and
# result; Codex's tool calls from the rollout. Usage: python3 -I extract.py <W>
import json, sys, glob, os
W = sys.argv[1]
for f in sorted(glob.glob(f"{W}/logs/cc*.jsonl")):
    print(f"## {os.path.basename(f)[:-6]}")
    for line in open(f):
        d = json.loads(line)
        if d.get("subtype") == "init":
            sq = [p for p in d.get("plugins", []) if p.get("name") == "squeal"]
            print(f"init: claude {d.get('claude_code_version')} model {d.get('model')}; squeal plugin {sq}; "
                  f"squeal skills {[s for s in d.get('skills', []) if 'squeal' in s or 'ask' in s]}; "
                  f"AskUserQuestion in tools: {'AskUserQuestion' in d.get('tools', [])}")
        if d.get("type") == "assistant":
            for c in d["message"].get("content", []):
                if c.get("type") == "tool_use":
                    print(f"tool_use {c['name']}: {json.dumps(c['input'])[:200]}")
        if d.get("type") == "result":
            print(f"result: {d.get('result', '')[:700]!r}")
    print()
for f in sorted(glob.glob(f"{W}/codex/sessions/**/*.jsonl", recursive=True)):
    rows = [json.loads(l) for l in open(f)]
    prompt = next((r["payload"].get("message", "") for r in rows if r.get("payload", {}).get("type") == "user_message"), "")
    print(f"## codex {os.path.basename(f)}\nprompt: {prompt[:160]!r}")
    for r in rows:
        p = r.get("payload", {})
        if p.get("type") in ("custom_tool_call", "function_call"):
            print(f"{r['timestamp']} call {p.get('name')}: {(p.get('input') or p.get('arguments') or '')[:220]!r}")
        if p.get("type") in ("custom_tool_call_output", "function_call_output"):
            out = p.get("output")
            out = " ".join(o.get("text", "") for o in out) if isinstance(out, list) else str(out)
            print(f"{r['timestamp']} output: {out[:220]!r}")
        if p.get("type") == "agent_message":
            print(f"agent: {p.get('message', '')[:300]!r}")
    print()
for f in sorted(glob.glob(f"{W}/logs/cx*.jsonl")):
    print(f"## {os.path.basename(f)[:-6]} (codex exec --json)")
    for line in open(f):
        d = json.loads(line)
        it = d.get("item", {})
        if d.get("type") == "item.completed":
            print(f"{it.get('type')}: {(it.get('command') or '')[:200]} {(it.get('aggregated_output') or it.get('text') or '')[:300]!r}")
    print()
# what the cx2 model saw: the skill roots table and the injected skill block
for f in glob.glob(f"{W}/codex/sessions/**/*.jsonl", recursive=True):
    text = open(f).read()
    if "squeal:squeal Following" in text:
        import re
        print("## cx2 rollout, model-visible skill text")
        for pat in [r"### Skill roots.{0,160}", r"- squeal:squeal: [^\n]{0,400}", r"<skill>.{0,200}"]:
            m = re.search(pat, text.replace("\\n", "\n"), re.S)
            print(m.group(0).replace("\n", " | ") if m else f"(no match for {pat})")
