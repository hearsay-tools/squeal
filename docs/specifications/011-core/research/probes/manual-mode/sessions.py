"""Q1/Q4: one JSON line per agent session in a Squeal project, with the events manual mode depends on. Throwaway,
read only. Reads Claude Code transcripts (top-level, with their subagents' edits and asks) and Codex sessions.

Usage: python3 -I sessions.py SINCE_ISO UNTIL_ISO EXCLUDE_ID OUT.jsonl

Events, each [t_s, kind, data]:
- `prompt`: a user turn starts (Claude: a user message that is not a tool result; Codex: event_msg task_started).
- `stop`: the turn's Stop hook ran (Claude: system stop_hook_summary of the main agent; Codex: event_msg task_complete).
- `edit`: a code file an edit tool changed (Claude Edit/Write/MultiEdit/NotebookEdit; Codex apply_patch). Absolute path.
  Code = .ts .tsx .js .jsx .mjs .cjs .mts .cts .vue .svelte .json. Shell edits are not seen (a lower bound).
- `ask`: `squeal status ... --wait` or `squeal run ...` in a shell command: data = {"paths": [...], "all": bool},
  `all` when it names no path (a bare wait covers every pending file) or has --all.
- `fail`: a SQUEAL hook message (not a command's output) with `FAIL` lines: data = the failing test files.
- `act`: any other tool call, for activity spans.
Root = the worktree root of the session's cwd. Only roots under ~/projects/{squeal,cezar,toolkit-dev}. Text content
is not stored: paths and times only.
"""
import glob, json, os, re, shlex, sys
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
ROOT = re.compile(r"^(/home/agent/projects/(?:squeal|cezar|toolkit-dev)(?:/\.ai/cezar/worktrees/[^/]+)?)(?:/|$)")
CODE = re.compile(r"\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|json)$")
SQ = re.compile(r"(?:^|[\s;&|(/])squeal\s+(status|run)\b([^\n;&|]*)")
FAILLINE = re.compile(r"^FAIL (?:\[[^\]]*\] )?(\S+)", re.M)


def ts_of(s):
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s / (1000 if s > 1e11 else 1), timezone.utc).timestamp()
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def ask_of(cmd):
    out = []
    for m in SQ.finditer(cmd):
        verb, rest = m.group(1), m.group(2)
        if verb == "status" and "--wait" not in rest:
            continue
        try:
            toks = shlex.split(rest)
        except ValueError:
            toks = rest.split()
        paths, skip, alls = [], False, "--all" in toks
        for t in toks:
            if skip:
                skip = False
                continue
            if t in (">", "2>", "<", "--reason", "--timeout"):
                skip = True
                continue
            if t.startswith("-") or t.isdigit() or t.startswith(("2>", ">")) or t in ("2>&1",):
                continue
            paths.append(t)
        out.append({"verb": verb, "paths": paths, "all": alls or not paths})
    return out


def text_of(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(x.get("text", "") if isinstance(x, dict) else str(x) for x in c)
    return ""


def emit(fo, src, sid, root, ev):
    if root and ev:
        ev.sort(key=lambda e: e[0])
        fo.write(json.dumps({"src": src, "session": sid, "root": root, "events": ev}) + "\n")


def claude(since, until, exclude, fo):
    for f in glob.glob(f"{HOME}/.claude/projects/*/*.jsonl"):
        if datetime.fromtimestamp(os.path.getmtime(f), timezone.utc).timestamp() < since:
            continue
        sid = os.path.basename(f)[:-6]
        if exclude in f:
            continue
        root, ev = None, []
        subs = glob.glob(f"{f[:-6]}/subagents/*.jsonl")
        for path, main in [(f, True)] + [(s, False) for s in subs]:
            for line in open(path, errors="replace"):
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                t = d.get("timestamp")
                if not t:
                    continue
                t = ts_of(t)
                if main and d.get("cwd") and not root:
                    m = ROOT.match(d["cwd"])
                    root = m.group(1) if m else None
                if not (since <= t < until):
                    continue
                typ = d.get("type")
                msg = d.get("message") or {}
                if typ == "assistant":
                    for c in msg.get("content") or []:
                        if not (isinstance(c, dict) and c.get("type") == "tool_use"):
                            continue
                        inp = c.get("input") or {}
                        if c.get("name") in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
                            p = inp.get("file_path") or inp.get("notebook_path") or ""
                            if CODE.search(p) and ROOT.match(p):
                                ev.append([t, "edit", p])
                                continue
                        elif c.get("name") == "Bash":
                            asks = ask_of(inp.get("command", ""))
                            for a in asks:
                                ev.append([t, "ask", a])
                            if asks:
                                continue
                        ev.append([t, "act", None])
                elif main and typ == "user" and not d.get("isMeta"):
                    cont = msg.get("content")
                    if isinstance(cont, list) and any(isinstance(x, dict) and x.get("type") == "tool_result" for x in cont):
                        continue
                    txt = text_of(cont)
                    if txt.startswith("<local-command") or txt.startswith("<command-name>") or "<task-notification>" in txt[:200]:
                        continue
                    ev.append([t, "prompt", None])
                elif main and typ == "system" and d.get("subtype") == "stop_hook_summary":
                    ev.append([t, "stop", None])
                elif typ == "attachment":
                    a = d.get("attachment") or {}
                    if a.get("type") == "hook_additional_context":
                        txt = text_of(a.get("content"))
                        if "SQUEAL" in txt:
                            fails = sorted(set(FAILLINE.findall(txt)))
                            if fails:
                                ev.append([t, "fail", fails])
        emit(fo, "claude", sid, root, ev)


def codex(since, until, exclude, fo):
    PATCH = re.compile(r"\*\*\* (?:Update|Add|Delete) File: (/[^\\\n\"]+)")
    for f in glob.glob(f"{HOME}/.codex/sessions/*/*/*/*.jsonl"):
        if datetime.fromtimestamp(os.path.getmtime(f), timezone.utc).timestamp() < since:
            continue
        root = sid = None
        ev = []
        for line in open(f, errors="replace"):
            try:
                d = json.loads(line)
            except ValueError:
                continue
            p = d.get("payload") or {}
            if d.get("type") == "session_meta":
                sid = p.get("id")
                m = ROOT.match(p.get("cwd") or "")
                root = m.group(1) if m else None
                continue
            t = d.get("timestamp")
            if not t:
                continue
            t = ts_of(t)
            if not (since <= t < until):
                continue
            pt = p.get("type")
            if d.get("type") == "event_msg" and pt == "task_started":
                ev.append([t, "prompt", None])
            elif d.get("type") == "event_msg" and pt == "task_complete":
                ev.append([t, "stop", None])
            elif d.get("type") == "response_item" and pt == "custom_tool_call" and "Begin Patch" in str(p.get("input")):
                for path in PATCH.findall(str(p.get("input") or "")):
                    if CODE.search(path.strip()) and ROOT.match(path.strip()):
                        ev.append([t, "edit", path.strip()])
            elif d.get("type") == "event_msg" and pt == "item_completed" and (p.get("item") or {}).get("type") == "CommandExecution":
                argv = p["item"].get("command") or []
                cmd = argv[-1] if isinstance(argv, list) and argv else str(argv)
                asks = ask_of(cmd)
                for a in asks:
                    ev.append([t, "ask", a])
                if not asks:
                    ev.append([t, "act", None])
            elif d.get("type") == "response_item" and pt == "message" and p.get("role") == "developer":
                txt = text_of(p.get("content"))
                if txt.startswith("SQUEAL"):
                    fails = sorted(set(FAILLINE.findall(txt)))
                    if fails:
                        ev.append([t, "fail", fails])
        if sid and exclude in (sid or ""):
            continue
        emit(fo, "codex", sid, root, ev)


since, until, exclude, out = ts_of(sys.argv[1]), ts_of(sys.argv[2]), sys.argv[3], sys.argv[4]
with open(out, "w") as fo:
    claude(since, until, exclude, fo)
    codex(since, until, exclude, fo)
