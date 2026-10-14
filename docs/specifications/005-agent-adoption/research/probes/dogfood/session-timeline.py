# Throwaway probe for 005-18 part 2. Not product code.
# One line per event of a part 2 session (part2-sessions.sh writes each JSON line behind its arrival
# time): seconds since the first line, then a command the agent ran, a file it edited, a SQUEAL
# delivery it received, or its text. Claude Code stream-json and Codex `exec --json` both. Flags each
# command that reaches into Squeal's internals (its store, sockets, daemon logs, plugin source) and
# each test command the agent ran itself. Reads the file only; prints no environment.
#   python3 -I session-timeline.py <session.jsonl> [--full]
import json
import re
import sys

# Running the CLI by its plugin path is how Codex is told to call it; reading the plugin's files,
# the store, the sockets or the daemon's logs is probing.
INTERNAL = re.compile(r"store\.sqlite|\.git/squeal|/xdg/|squeal-\d+\.sock|daemon\.log|sqlite3|"
                      r"\b(?:cat|sed|grep|rg|head|tail|less|ls|find)\b[^|;&]*(?:plugins/(?:claude-code|codex)|"
                      r"plugins/cache|\.claude/plugins|/dist/cli)")
TEST = re.compile(r"(?:^|[\s;&|(])(?:npx\s+)?vitest(?=\s|$)|\bnpm\s+(?:run\s+)?test\b|\bpnpm\s+(?:run\s+)?test\b|"
                  r"node\s[^|;&\n]*--test\b")
# A heredoc's body is data (a script that edits a file naming `npm test`), not a command.
HEREDOC = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?.*?\n.*?\n\1(?=\n|$)", re.S)
WIDTH = None if "--full" in sys.argv else 220


def cut(s):
    s = " ".join(str(s).split())
    return s if WIDTH is None else s[:WIDTH]


def events(path):
    for line in open(path, errors="replace"):
        stamp, _, body = line.partition(" ")
        try:
            yield float(stamp), json.loads(body)
        except ValueError:
            continue


def describe(e):
    out = []
    t = e.get("type")
    if t == "assistant":
        for c in e["message"].get("content", []):
            if c.get("type") == "tool_use":
                i = c.get("input", {})
                if c.get("name") == "Bash":
                    out.append(("cmd", i.get("command", "")))
                elif c.get("name") in ("Edit", "Write", "MultiEdit"):
                    out.append(("edit", i.get("file_path", "")))
                else:
                    out.append(("tool", f"{c.get('name')} {json.dumps(i)[:160]}"))
            elif c.get("type") == "text" and c.get("text", "").strip():
                out.append(("text", c["text"]))
    elif t == "user":
        for c in (e.get("message") or {}).get("content", []) if isinstance((e.get("message") or {}).get("content"), list) else []:
            text = c.get("content") if isinstance(c, dict) else None
            if isinstance(text, list):
                text = " ".join(x.get("text", "") for x in text if isinstance(x, dict))
            if isinstance(text, str) and "SQUEAL" in text:
                out.append(("squeal", text[text.index("SQUEAL"):]))
    elif t == "system" and e.get("subtype") in ("hook_response", "hook_started"):
        body = json.dumps(e)
        if "SQUEAL" in body and e.get("subtype") == "hook_response":
            s = e.get("output") or e.get("stdout") or body
            out.append(("hook", s[s.find("SQUEAL"):] if "SQUEAL" in s else s))
    elif t == "result":
        out.append(("result", e.get("result", "")))
    elif t in ("item.started", "item.completed"):
        item = e.get("item", {})
        kind = item.get("type")
        if kind == "command_execution" and t == "item.started":
            out.append(("cmd", item.get("command", "")))
        elif kind == "command_execution" and t == "item.completed":
            o = item.get("aggregated_output", "")
            if "SQUEAL" in o:
                out.append(("squeal", o[o.index("SQUEAL"):]))
        elif kind == "file_change" and t == "item.completed":
            out.append(("edit", ", ".join(c.get("path", "") for c in item.get("changes", []))))
        elif kind == "agent_message" and t == "item.completed":
            out.append(("text", item.get("text", "")))
    elif t == "hook" or "hook" in str(t):
        body = json.dumps(e)
        if "SQUEAL" in body:
            out.append(("hook", body[body.index("SQUEAL"):]))
    return out


t0 = None
counts = {"cmd": 0, "internal": 0, "test": 0, "edit": 0, "squeal": 0, "hook": 0}
for at, e in events(sys.argv[1]):
    t0 = at if t0 is None else t0
    for kind, text in describe(e):
        flags = ""
        if kind == "cmd":
            counts["cmd"] += 1
            if INTERNAL.search(text):
                counts["internal"] += 1
                flags += " [INTERNAL]"
            if TEST.search(HEREDOC.sub("", text)):
                counts["test"] += 1
                flags += " [TEST]"
        elif kind in counts:
            counts[kind] += 1
        print(f"{at - t0:7.1f}s {kind:6}{flags} {cut(text)}")
print("counts", json.dumps(counts))
