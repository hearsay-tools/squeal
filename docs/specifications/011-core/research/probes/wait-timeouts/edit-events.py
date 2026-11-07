"""Q4: one JSON line per file edit an agent made, with its time and worktree root. Throwaway, read only.
Claude: Edit, Write, MultiEdit and NotebookEdit tool calls (top-level and subagent transcripts), root from the file
path. Codex: each file an `apply_patch` call in an exec tool call adds, updates or deletes, root from the file path. Edits made
by other shell commands (sed -i, heredocs, git checkout) are not counted, so the rate is a lower bound.
Usage: python3 -I edit-events.py SINCE_ISO UNTIL_ISO OUT.jsonl
"""
import glob, json, os, re, sys
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
ROOT = re.compile(r"^(/home/agent/projects/[^/]+(?:/\.ai/cezar/worktrees/[^/]+)?)")


def ts_of(s):
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s / (1000 if s > 1e11 else 1), timezone.utc)
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


since, until, out = ts_of(sys.argv[1]), ts_of(sys.argv[2]), sys.argv[3]
fo = open(out, "w")
files = glob.glob(f"{HOME}/.claude/projects/*/*.jsonl") + glob.glob(f"{HOME}/.claude/projects/*/*/subagents/*.jsonl")
for f in files:
    if datetime.fromtimestamp(os.path.getmtime(f), timezone.utc) < since:
        continue
    for line in open(f, errors="replace"):
        if '"tool_use"' not in line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") != "assistant" or not d.get("timestamp"):
            continue
        t = ts_of(d["timestamp"])
        if not (since <= t < until):
            continue
        for c in (d.get("message") or {}).get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
                p = (c.get("input") or {}).get("file_path") or (c.get("input") or {}).get("notebook_path") or ""
                m = ROOT.match(p)
                if m:
                    fo.write(json.dumps({"t": t.timestamp(), "root": m.group(1)}) + "\n")
PATCH = re.compile(r"\*\*\* (?:Update|Add|Delete) File: (/[^\\\n\"]+)")
for f in glob.glob(f"{HOME}/.codex/sessions/*/*/*/*.jsonl"):
    if datetime.fromtimestamp(os.path.getmtime(f), timezone.utc) < since:
        continue
    for line in open(f, errors="replace"):
        if "Begin Patch" not in line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        p = d.get("payload") or {}
        if d.get("type") != "response_item" or p.get("type") != "custom_tool_call" or not d.get("timestamp"):
            continue
        t = ts_of(d["timestamp"])
        if not (since <= t < until):
            continue
        for path in PATCH.findall(str(p.get("input") or "")):
            m = ROOT.match(path)
            if m:
                fo.write(json.dumps({"t": t.timestamp(), "root": m.group(1)}) + "\n")
