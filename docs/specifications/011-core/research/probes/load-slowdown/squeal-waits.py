"""Q4: the wall each agent session spent in `squeal status --wait` and `squeal run ... --wait` commands, and the
sessions that ran any shell command in a Squeal-validated project. Throwaway, read only.

Usage: python3 -I squeal-waits.py SINCE_ISO UNTIL_ISO OUT.jsonl
Reads the same transcripts as ../host-load/011-181/extract.py, in the same way. One line per squeal command
(session, cwd, start, end, wall seconds, kind: status-wait, run-wait, other) and one per session (`session` lines:
cwd, first and last command time, commands). Writes no transcript text beyond the squeal command's first 120
characters.
"""
import glob, json, os, re, sys
from datetime import datetime, timezone

HOME = os.path.expanduser("~")


def ts_of(s):
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s / (1000 if s > 1e11 else 1), timezone.utc)
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


SQ = re.compile(r"(?:^|[\s;&|(/])squeal\s+(status|run|retry|why)\b([^\n;&|]*)")


def kind(cmd):
    m = SQ.search(cmd)
    if not m:
        return None
    verb, rest = m.group(1), m.group(2)
    if verb == "status" and "--wait" in rest:
        return "status-wait"
    if verb == "run" and "--wait" in rest:
        return "run-wait"
    return verb


def main():
    since, until, out = ts_of(sys.argv[1]), ts_of(sys.argv[2]), sys.argv[3]
    fo = open(out, "w")
    sessions = {}

    def note(sid, cwd, t):
        s = sessions.setdefault(sid, {"cwd": cwd, "first": t, "last": t, "commands": 0})
        s["first"], s["last"] = min(s["first"], t), max(s["last"], t)
        s["commands"] += 1

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
                        if since <= t < until:
                            note(sid, cwd, t.isoformat())
                            k = kind(cmd)
                            if k:
                                pending[c.get("id")] = {"src": "claude", "session": sid, "cwd": cwd, "start": t, "kind": k, "cmd": cmd[:120]}
            elif d.get("type") == "user" and isinstance(msg.get("content"), list):
                for c in msg["content"]:
                    if isinstance(c, dict) and c.get("type") == "tool_result" and c.get("tool_use_id") in pending and ts:
                        r = pending.pop(c["tool_use_id"])
                        e = ts_of(ts)
                        fo.write(json.dumps({**r, "start": r["start"].isoformat(), "end": e.isoformat(), "wall": (e - r["start"]).total_seconds()}) + "\n")
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
            st = it.get("started_at_ms") or p.get("started_at_ms")
            e = ts_of(d.get("timestamp"))
            s = ts_of(int(st)) if st else e
            if not (since <= s < until):
                continue
            c = (it.get("cwd") or cwd or "").replace("file://", "")
            note(sid, c, s.isoformat())
            k = kind(cmd)
            if k:
                dur = it.get("duration_ms") or it.get("durationMs")
                wall = dur / 1000 if dur else (e - s).total_seconds()
                fo.write(json.dumps({"src": "codex", "session": sid, "cwd": c, "start": s.isoformat(), "end": e.isoformat(), "wall": wall, "kind": k, "cmd": cmd[:120]}) + "\n")
    for sid, s in sessions.items():
        fo.write(json.dumps({"sessionLine": True, "session": sid, **s}) + "\n")


main()
