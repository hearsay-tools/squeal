"""One JSON line per `squeal status --wait` command in agent transcripts, with its full printed output.
Throwaway, read only. Same transcripts and selection as ../load-slowdown/squeal-waits.py (top-level Claude
sessions and Codex sessions), plus the output text, the exit code where the transcript has it, the limit and the
named paths. The output holds Squeal's own report text only (test file names and verdict lines); keep it in scratch.

Usage: python3 -I extract-waits.py SINCE_ISO UNTIL_ISO OUT.jsonl
"""
import glob, json, os, re, shlex, sys
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
SQ = re.compile(r"(?:^|[\s;&|(/])squeal\s+status\b([^\n;&|]*)")


def ts_of(s):
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s / (1000 if s > 1e11 else 1), timezone.utc)
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def parse(cmd):
    """(limit_ms or None, named paths) of the first `squeal status ... --wait` in cmd, or None."""
    m = SQ.search(cmd)
    if not m or "--wait" not in m.group(1):
        return None
    try:
        toks = shlex.split(m.group(1), comments=False)
    except ValueError:
        toks = m.group(1).split()
    limit, paths, i = None, [], 0
    while i < len(toks):
        t = toks[i]
        if t == "--wait":
            if i + 1 < len(toks) and toks[i + 1].isdigit():
                limit = int(toks[i + 1]); i += 1
            else:
                limit = -1
        elif t.startswith("--wait="):
            limit = int(t.split("=", 1)[1]) if t.split("=", 1)[1].isdigit() else -1
        elif t.startswith("-") or t in ("2>&1", ">", "2>", "<"):
            if t in (">", "2>", "<"):
                i += 1
        elif t.startswith(("2>", ">")):
            pass
        else:
            paths.append(t)
        i += 1
    return limit, paths


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


def main():
    since, until, out = ts_of(sys.argv[1]), ts_of(sys.argv[2]), sys.argv[3]
    fo = open(out, "w")
    for f in glob.glob(f"{HOME}/.claude/projects/*/*.jsonl"):
        if datetime.fromtimestamp(os.path.getmtime(f), timezone.utc) < since:
            continue
        cwd = sid = None
        pending = {}
        for line in open(f, errors="replace"):
            try:
                d = json.loads(line)
            except ValueError:
                continue
            ts = d.get("timestamp")
            cwd = d.get("cwd") or cwd
            sid = d.get("sessionId") or sid
            msg = d.get("message") or {}
            if d.get("type") == "assistant":
                for c in msg.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") == "Bash" and ts:
                        cmd = (c.get("input") or {}).get("command", "")
                        t = ts_of(ts)
                        p = parse(cmd)
                        if p and since <= t < until:
                            pending[c.get("id")] = {"src": "claude", "session": sid, "cwd": cwd, "start": t, "limit": p[0], "paths": p[1], "cmd": cmd[:400]}
            elif d.get("type") == "user" and isinstance(msg.get("content"), list):
                for c in msg["content"]:
                    if isinstance(c, dict) and c.get("type") == "tool_result" and c.get("tool_use_id") in pending and ts:
                        r = pending.pop(c["tool_use_id"])
                        e = ts_of(ts)
                        tr = d.get("toolUseResult") if isinstance(d.get("toolUseResult"), dict) else {}
                        txt = text_of(c.get("content"))
                        m = re.match(r"Exit code (\d+)", txt)
                        fo.write(json.dumps({**r, "start": r["start"].isoformat(), "end": e.isoformat(), "wall": (e - r["start"]).total_seconds(),
                                             "exit": int(m.group(1)) if m else (None if c.get("is_error") else 0), "interrupted": tr.get("interrupted"), "out": txt}) + "\n")
    for f in glob.glob(f"{HOME}/.codex/sessions/*/*/*/*.jsonl"):
        if datetime.fromtimestamp(os.path.getmtime(f), timezone.utc) < since:
            continue
        cwd = sid = None
        for line in open(f, errors="replace"):
            try:
                d = json.loads(line)
            except ValueError:
                continue
            p = d.get("payload") or {}
            if d.get("type") == "session_meta":
                cwd, sid = p.get("cwd"), p.get("id")
                continue
            if p.get("type") != "item_completed":
                continue
            it = p.get("item") or {}
            if it.get("type") != "CommandExecution":
                continue
            argv = it.get("command") or []
            cmd = argv[-1] if isinstance(argv, list) and argv else str(argv)
            pr = parse(cmd)
            if not pr:
                continue
            st = it.get("started_at_ms") or p.get("started_at_ms")
            e = ts_of(d.get("timestamp"))
            s = ts_of(int(st)) if st else e
            if not (since <= s < until):
                continue
            c = (it.get("cwd") or cwd or "").replace("file://", "")
            dur = it.get("duration") or {}
            wall = dur.get("secs", 0) + dur.get("nanos", 0) / 1e9 if isinstance(dur, dict) and dur else (it.get("duration_ms") or 0) / 1000 or (e - s).total_seconds()
            if not st:
                s = datetime.fromtimestamp(e.timestamp() - wall, timezone.utc)
            ex = it.get("exit_code")
            fo.write(json.dumps({"src": "codex", "session": sid, "cwd": c, "start": s.isoformat(), "end": e.isoformat(), "wall": wall,
                                 "limit": pr[0], "paths": pr[1], "cmd": cmd[:400], "exit": int(ex) if ex not in (None, "") else None,
                                 "interrupted": None, "out": it.get("aggregated_output") or ""}) + "\n")


main()
