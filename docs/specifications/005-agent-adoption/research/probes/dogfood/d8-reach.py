# Throwaway probe for 005-18. Not product code.
# D8's reach: of the test commands agents actually issued, how many has step 1 (recognize the
# command, narrowly) a chance to answer? A port of src/harness/shared/test-command.ts
# `shellWords` and `vitestCommand` (read, not imported), plus `npm test` / `npm run test` with no
# arguments, which this repository's and ledgerline's `test` script ("vitest run") allows.
# Every other command falls through by design; the first reason found is counted.
#   python3 -I d8-reach.py <dir or .jsonl>...   (Claude Code transcripts, Codex rollouts or
#   `codex exec --json` / `claude -p --output-format stream-json` output)
import json
import os
import re
import sys
from collections import Counter

SPECIAL = re.compile(r"[|&;()<>$`\\#*?\[\]{}~!\n\r]")
SILENT = {"true", "false", "yes", "no", "passed-only"}
TEST = re.compile(r"(?:^|[\s;&|(])(?:npx\s+(?:-\S+\s+)*)?(?:node_modules/\.bin/)?vitest(?=\s|$)|(?:^|[\s;&|(])npm\s+(?:run\s+)?test(?=[\s:;&|]|$)|(?:^|[\s;&|(])node\s[^|;&\n]*--test(?=\s|$)")


def shell_words(text):
    words, word, i = [], None, 0
    while i < len(text):
        c = text[i]
        if c in " \t":
            if word is not None:
                words.append(word)
            word = None
        elif c in "'\"":
            end = text.find(c, i + 1)
            if end == -1:
                return None, "unclosed quote"
            quoted = text[i + 1 : end]
            if c == '"' and re.search(r"[$`\\]", quoted):
                return None, "expansion"
            word = (word or "") + quoted
            i = end
        elif SPECIAL.match(c):
            kind = (
                "pipe" if c == "|" and text[i : i + 2] != "||" else
                "chain" if c in ";&\n\r" or text[i : i + 2] == "||" else
                "redirect" if c in "<>" else
                "subshell or expansion" if c in "()$`" else
                "glob or other"
            )
            return None, kind
        else:
            word = (word or "") + c
        i += 1
    if word is not None:
        words.append(word)
    if not words:
        return None, "empty"
    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", words[0]):
        return None, "leading assignment"
    return words, None


def vitest_ok(words):
    start = 1 if words[0] == "npx" else 0
    if words[start : start + 2] != ["vitest", "run"]:
        return "not `vitest run` first" if "vitest" in words else None
    rest, i = words[start + 2 :], 0
    while i < len(rest):
        w = rest[i]
        if w == "--silent":
            if i + 1 < len(rest) and not rest[i + 1].startswith("-"):
                if rest[i + 1] not in SILENT:
                    return "flag"
                i += 1
        elif w.startswith("--silent="):
            if w.split("=", 1)[1] not in SILENT:
                return "flag"
        elif w == "--reporter":
            if i + 1 >= len(rest) or rest[i + 1].startswith("-"):
                return "flag"
            i += 1
        elif w.startswith("--reporter="):
            if w == "--reporter=":
                return "flag"
        elif w.startswith("-") or w == "" or re.search(r":\d+(-\d+)?$", w):
            return "flag or line filter"
        i += 1
    return "recognized"


def classify(cmd):
    words, why = shell_words(cmd.strip())
    if words is None:
        return why
    if words[0] == "npm":
        if words[1:] in (["test"], ["run", "test"], ["t"]):
            return "recognized (npm test)"
        return "npm with arguments or another script"
    first = words[0]
    if first in ("timeout", "cd", "env", "time", "bash", "sh"):
        return f"prefix ({first})"
    v = vitest_ok(words)
    return v or "another runner"


def commands(path):
    for line in open(path, errors="replace"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        ev = e.get("event", e)
        msg = ev.get("message") if isinstance(ev, dict) else None
        content = msg.get("content") if isinstance(msg, dict) else None
        if isinstance(content, list):
            for c in content:
                if c.get("type") == "tool_use" and c.get("name") == "Bash":
                    yield c.get("input", {}).get("command", "")
        p = ev.get("payload") if isinstance(ev, dict) else None
        item = (p or {}).get("item") or ev.get("item") if isinstance(ev, dict) else None
        if isinstance(item, dict) and item.get("type") in ("CommandExecution", "command_execution"):
            if (p or {}).get("type", "item_completed") != "item_completed" and ev.get("type") != "item.completed":
                continue
            c = item.get("command")
            yield c[-1] if isinstance(c, list) else (c or "")


def files(args):
    for a in args:
        if os.path.isfile(a):
            yield a
        else:
            for d, _, fs in os.walk(a, followlinks=True):
                for f in fs:
                    if f.endswith(".jsonl"):
                        yield os.path.join(d, f)


counts, sessions_with = Counter(), Counter()
examples = {}
for f in files(sys.argv[1:]):
    seen = set()
    for cmd in commands(f):
        if not cmd or not TEST.search(cmd):
            continue
        k = classify(cmd)
        counts[k] += 1
        seen.add(k)
        examples.setdefault(k, cmd[:160].replace("\n", " ⏎ "))
    for k in seen:
        sessions_with[k] += 1
total = sum(counts.values())
print(f"test commands: {total}")
for k, n in counts.most_common():
    print(f"  {n:5d} {n / total:6.1%}  sessions {sessions_with[k]:4d}  {k}   e.g. {examples[k]}")
