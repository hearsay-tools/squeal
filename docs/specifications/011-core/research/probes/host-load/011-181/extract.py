"""Throwaway probe for row 011-181. Usage: python3 -I extract.py SINCE_ISO UNTIL_ISO OUT.jsonl

Reads Claude Code transcripts (~/.claude/projects/*/*.jsonl) and Codex rollouts
(~/.codex/sessions/YYYY/MM/DD/*.jsonl) modified since SINCE, read-only. Writes one
line per shell command that runs a test runner (Vitest, npm test, pytest,
node --test, jest, mocha) and started in [SINCE, UNTIL): the session, its cwd, its
first prompt's opening (for the role), the command, its wall and exit, and the
last SQUEAL message and the last `squeal` command output the session saw before it.
The output holds transcript text: keep it out of the repository."""
import glob, json, os, re, sys
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
WRAP = {"env", "timeout", "nice", "ionice", "setsid", "nohup", "time", "flock", "exec", "command", "stdbuf", "sudo", "xargs"}


def parse_ts(s):
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s / (1000 if s > 1e11 else 1), timezone.utc)
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")


def strip_heredocs(cmd):
    """Drop each here-document's body: its text is data, not commands."""
    out, lines, i = [], cmd.split("\n"), 0
    while i < len(lines):
        out.append(lines[i])
        tags = [m.group(2) for m in HEREDOC.finditer(lines[i])]
        i += 1
        for tag in tags:
            while i < len(lines) and lines[i].strip() != tag:
                i += 1
            i += 1
    return "\n".join(out)


def segments(cmd):
    """Split a shell command at unquoted ; & | newline ( ) and backquote."""
    segs, cur, q, i = [], [], None, 0
    while i < len(cmd):
        ch = cmd[i]
        if q:
            if ch == q:
                q = None
            elif ch == "\\" and q == '"' and i + 1 < len(cmd):
                cur.append(ch)
                i += 1
                ch = cmd[i]
            cur.append(ch)
        elif ch in "'\"":
            q = ch
            cur.append(ch)
        elif ch == "\\" and i + 1 < len(cmd):
            cur.append(cmd[i + 1] if cmd[i + 1] != "\n" else " ")
            i += 1
        elif ch == "$" and cmd[i + 1 : i + 2] == "(" and (cur and not cur[-1].isspace()):
            depth, j = 0, i + 1
            while j < len(cmd):
                depth += {"(": 1, ")": -1}.get(cmd[j], 0)
                if depth == 0:
                    break
                j += 1
            cur.append(cmd[i : j + 1])
            i = j
        elif ch in ";&|\n()`":
            segs.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    segs.append("".join(cur))
    return segs


def runner_in(cmd):
    """The runner kinds a shell command starts, by segment."""
    kinds = []
    for seg in segments(strip_heredocs(cmd)):
        seg = re.sub(r"\$\([^()]*\)", "SUB", seg)
        w = seg.strip().split()
        i = 0
        while i < len(w):
            t = w[i].strip("'\"")
            if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t) or t in ("-u", "-n", "-c3", "-c", "-k", "-s", "-E") and i > 0:
                i += 1
                if t in ("-u", "-n", "-k", "-s") and i < len(w):
                    i += 1
                continue
            b = t.rsplit("/", 1)[-1]
            if b in WRAP:
                i += 1
                if b == "flock" and i < len(w):
                    i += 1  # the lock path
                if b in ("timeout", "nice") and i < len(w) and re.match(r"^-?\d+[smh]?$", w[i]):
                    i += 1
                continue
            if b.startswith("-"):
                i += 1
                continue
            break
        inner = re.match(r"^(?:\S*/)?(?:ba)?sh\s+(?:-\w+\s+)*-c\s+(['\"])(.*)\1", " ".join(seg.strip().split()[i:]), re.S)
        if inner:
            kinds += runner_in(inner.group(2))
            continue
        w = [x.strip("'\"") for x in w[i:]]
        if not w:
            continue
        b0 = w[0].rsplit("/", 1)[-1]
        rest = [x for x in w[1:] if not x.startswith("-")]
        if b0 == "npx" and rest[:1] and rest[0].rsplit("/", 1)[-1] in ("vitest", "jest", "mocha"):
            kinds.append(rest[0].rsplit("/", 1)[-1])
        elif b0 in ("vitest",) and rest[:1] != ["list"]:
            kinds.append("vitest")
        elif b0 in ("npm", "pnpm", "yarn", "bun") and (rest[:1] in (["test"], ["t"]) or (rest[:1] == ["run"] and rest[1:2] and re.match(r"^test", rest[1]))):
            kinds.append(f"{b0}-" + (rest[1] if rest[:1] == ["run"] else "test"))
        elif b0 in ("npm", "pnpm") and rest[:2] == ["exec", "vitest"]:
            kinds.append("vitest")
        elif b0.startswith("node") and rest[:1] and rest[0].rsplit("/", 1)[-1] in ("vitest", "vitest.mjs") and rest[1:2] != ["list"]:
            kinds.append("vitest")
        elif b0.startswith("node") and "--test" in w[1:next((j for j, x in enumerate(w[1:], 1) if not x.startswith("-") and w[j - 1] not in ("--import", "--require", "-r")), len(w))]:
            kinds.append("node-test")
        elif b0 in ("pytest", "py.test") or (b0.startswith("python") and w[1:3] == ["-m", "pytest"]) or (b0 == "uv" and "pytest" in w[1:4]):
            kinds.append("pytest")
    return kinds


EDITISH = re.compile(r"\bsed -i|write_text\(|apply_patch|\bgit (checkout|apply|cherry-pick|merge|rebase|reset|pull|switch|am|restore)\b|\b(cp|mv|rm|tee|patch)\s|cat\s*>\s*[^/&]|\b(npm ci|pnpm install)\b")


def squeal_cmd(cmd):
    """True when a segment of the command starts the squeal CLI (status, run, why, retry)."""
    for seg in segments(strip_heredocs(cmd)):
        w = [x.strip("'\"") for x in seg.strip().split()]
        while w and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w[0]) or w[0] in ("env", "-u", "PLUGIN_ROOT", "PLUGIN_DATA", "timeout", "nice")):
            w = w[1:]
        if w and w[0].rsplit("/", 1)[-1] in ("squeal", "squeal.mjs") and w[1:2] and w[1] in ("status", "run", "why", "retry"):
            return True
    return False


MARKS = re.compile(r"Selected skill: /[a-z:-]+|Use /[a-z-]+|Fix GitHub issue|Handle main CI failure|owned cezar worker|Your job in THIS step is \"[a-z-]+\"|/dev-flow|^Coordinate ")


def marks(text):
    return sorted(set(MARKS.findall(text)))


def first_text(content):
    if isinstance(content, str):
        return content
    for c in content or []:
        if isinstance(c, dict) and c.get("type") in ("text", "input_text"):
            return c.get("text", "")
    return ""


def tool_text(content):
    if isinstance(content, str):
        return content
    out = []
    for c in content or []:
        if isinstance(c, dict) and c.get("type") in ("text", "input_text"):
            out.append(c.get("text", ""))
    return "\n".join(out)


def claude(since, until, emit):
    for f in glob.glob(f"{HOME}/.claude/projects/*/*.jsonl") + glob.glob(f"{HOME}/.claude/projects/*/*/subagents/*.jsonl"):
        if datetime.fromtimestamp(os.path.getmtime(f), timezone.utc) < since:
            continue
        cwd = sid = prompt = None
        squeal_msg = squeal_out = last_edit = None
        prompts = []
        pending = {}
        sq_calls = {}
        for line in open(f, errors="replace"):
            try:
                d = json.loads(line)
            except ValueError:
                continue
            ts = d.get("timestamp")
            cwd = d.get("cwd") or cwd
            sid = d.get("sessionId") or sid
            t = d.get("type")
            if t == "attachment":
                a = d.get("attachment", {})
                if a.get("type") == "hook_additional_context":
                    for c in a.get("content") or []:
                        if isinstance(c, str) and "SQUEAL" in c[:20]:
                            squeal_msg = (ts, a.get("hookEvent"), c[:1500])
                continue
            msg = d.get("message") or {}
            if t == "user":
                content = msg.get("content")
                if len(prompts) < 3 and not d.get("isMeta") and first_text(content):
                    prompts.append(" ".join(marks(first_text(content))) + " :: " + first_text(content)[:1500])
                    prompt = prompts[0][:600]
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "tool_result":
                            tid = c.get("tool_use_id")
                            text = tool_text(c.get("content"))
                            if tid in pending:
                                r = pending.pop(tid)
                                r["end"] = ts
                                r["isError"] = bool(c.get("is_error"))
                                r["resultHead"] = text[:400]
                                r["resultTail"] = text[-600:]
                                emit(r)
                            if tid in sq_calls:
                                squeal_out = (ts, sq_calls.pop(tid), text[:1500])
            elif t == "assistant":
                for c in msg.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
                        last_edit = ts
                    if not isinstance(c, dict) or c.get("type") != "tool_use" or c.get("name") != "Bash":
                        continue
                    cmd = (c.get("input") or {}).get("command", "")
                    if squeal_cmd(cmd):
                        sq_calls[c.get("id")] = cmd[:300]
                    kinds = runner_in(cmd)
                    if not kinds or not ts:
                        if EDITISH.search(strip_heredocs(cmd)) or "write_text(" in cmd:
                            last_edit = ts
                        continue
                    start = parse_ts(ts)
                    edit_before = last_edit
                    if re.search(r"open\([^)]*['\"][wa]['\"]|\.write\(|write_text\(|sed -i|cat\s*>|\b(cp|mv)\s|git (checkout|restore|apply)", cmd):
                        last_edit = ts
                    if not (since <= start < until):
                        continue
                    pending[c.get("id")] = {
                        "src": "claude", "file": f.replace(HOME, "~"), "session": sid, "cwd": cwd, "prompt": prompt,
                        "start": ts, "cmd": cmd, "kinds": kinds, "background": bool((c.get("input") or {}).get("run_in_background")),
                        "squealMsg": squeal_msg, "squealOut": squeal_out, "lastEdit": edit_before, "prompts": prompts,
                    }
        for r in pending.values():
            r["end"] = None
            emit(r)


def codex(since, until, emit):
    for f in glob.glob(f"{HOME}/.codex/sessions/*/*/*/*.jsonl"):
        if datetime.fromtimestamp(os.path.getmtime(f), timezone.utc) < since:
            continue
        cwd = sid = prompt = None
        squeal_msg = squeal_out = last_edit = None
        prompts = []
        for line in open(f, errors="replace"):
            try:
                d = json.loads(line)
            except ValueError:
                continue
            p = d.get("payload") or {}
            ts = d.get("timestamp")
            if d.get("type") == "session_meta":
                cwd, sid = p.get("cwd"), p.get("id")
                continue
            if d.get("type") == "response_item" and p.get("type") == "message" and p.get("role") in ("developer", "user"):
                tx = first_text(p.get("content"))
                i = tx.find("SQUEAL ·")
                if 0 <= i < 200:
                    squeal_msg = (ts, p.get("role"), tx[i : i + 1500])
                continue
            if p.get("type") != "item_completed":
                continue
            it = p.get("item") or {}
            ty = it.get("type")
            if ty == "UserMessage" and len(prompts) < 3:
                prompts.append(" ".join(marks(first_text(it.get("content")))) + " :: " + first_text(it.get("content"))[:1500])
                prompt = prompts[0][:600]
            elif ty == "FileChange":
                last_edit = ts
            elif ty == "HookPrompt":
                for fr in it.get("fragments") or []:
                    tx = fr.get("text", "")
                    if "SQUEAL" in tx[:20]:
                        squeal_msg = (ts, "HookPrompt", tx[:1500])
            elif ty == "CommandExecution":
                argv = it.get("command") or []
                cmd = argv[-1] if isinstance(argv, list) and argv else str(argv)
                out = (it.get("stdout") or "") + (it.get("aggregated_output") or "")
                if squeal_cmd(cmd):
                    squeal_out = (ts, cmd[:300], out[:1500])
                kinds = runner_in(cmd)
                if not kinds:
                    if EDITISH.search(strip_heredocs(cmd)) or "write_text(" in cmd:
                        last_edit = ts
                    continue
                st = it.get("started_at_ms") or p.get("started_at_ms")
                start = parse_ts(int(st)) if st else parse_ts(ts)
                edit_before = last_edit
                if re.search(r"open\([^)]*['\"][wa]['\"]|\.write\(|write_text\(|sed -i|cat\s*>|\b(cp|mv)\s|git (checkout|restore|apply)", cmd):
                    last_edit = ts
                if not (since <= start < until):
                    continue
                emit({
                    "src": "codex", "file": f.replace(HOME, "~"), "session": sid, "cwd": (it.get("cwd") or cwd or "").replace("file://", ""), "prompt": prompt,
                    "start": start.isoformat(), "end": ts, "durationMs": it.get("duration_ms") or it.get("durationMs"), "exit": it.get("exit_code", it.get("exitCode")),
                    "status": it.get("status"), "cmd": cmd, "kinds": kinds, "resultTail": out[-600:],
                    "squealMsg": squeal_msg, "squealOut": squeal_out, "lastEdit": edit_before, "prompts": prompts,
                })


def main():
    since, until, out = parse_ts(sys.argv[1]), parse_ts(sys.argv[2]), sys.argv[3]
    n = 0
    with open(out, "w") as fo:
        def emit(r):
            nonlocal n
            n += 1
            fo.write(json.dumps(r) + "\n")
        claude(since, until, emit)
        codex(since, until, emit)
    print(n)


main()
