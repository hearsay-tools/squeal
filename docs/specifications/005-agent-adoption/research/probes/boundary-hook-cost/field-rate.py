# Throwaway, row 005-110. Claude Code transcripts, read-only. A silent hook that ends in time leaves
# no record; so the denominator is counted from the transcript itself: tool batches (distinct assistant
# message ids with a tool_use) for PostToolBatch, and human prompts (user records that are not tool
# results or meta) for UserPromptSubmit. Prints cancelled / opportunities per repository and place.
# Usage: python3 -I field-rate.py [since-iso]
import json, os, sys, glob, collections
since = sys.argv[1] if len(sys.argv) > 1 else "2026-11-14"
root = os.path.expanduser("~/.claude/projects")
agg = collections.defaultdict(lambda: collections.Counter())
for d in glob.glob(root + "/*"):
    base = os.path.basename(d)
    repo = "cezar" if "projects-cezar" in base else "squeal" if "projects-squeal" in base else None
    if repo is None: continue
    where = "main" if base.endswith(("projects-cezar", "projects-squeal")) else "task"
    for f in glob.glob(d + "/*.jsonl"):
        batches = set(); prompts = 0; c = collections.Counter(); squeal = False
        with open(f, errors="replace") as fh:
            for line in fh:
                try: e = json.loads(line)
                except Exception: continue
                if e.get("timestamp", "") < since: continue
                if e.get("isSidechain"): continue
                a = e.get("attachment") or {}
                cmd = a.get("command") or ""
                if "post-tool-batch.mjs" in cmd: c["ptb_" + a.get("type", "")] += 1; squeal = True
                if "user-prompt-submit.mjs" in cmd: c["ups_" + a.get("type", "")] += 1
                if "session-start.mjs" in cmd: squeal = True
                m = e.get("message") or {}
                if e.get("type") == "assistant" and isinstance(m.get("content"), list) and any(b.get("type") == "tool_use" for b in m["content"] if isinstance(b, dict)):
                    batches.add(m.get("id"))
                if e.get("type") == "user" and not e.get("isMeta") and not e.get("toolUseResult"):
                    cont = m.get("content")
                    if isinstance(cont, str) or (isinstance(cont, list) and not any(isinstance(b, dict) and b.get("type") == "tool_result" for b in cont)):
                        prompts += 1
        if not squeal: continue
        k = (repo, where); agg[k]["sessions"] += 1; agg[k]["batches"] += len(batches); agg[k]["prompts"] += prompts
        agg[k].update(c)
print("repo where sessions batches ptb_cancelled ptb_success prompts ups_cancelled")
for k in sorted(agg):
    a = agg[k]; print(*k, a["sessions"], a["batches"], a["ptb_hook_cancelled"], a["ptb_hook_success"], a["prompts"], a["ups_hook_cancelled"])
