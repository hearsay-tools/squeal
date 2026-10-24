"""Throwaway probe for row 011-181. Usage: python3 -I classify.py RUNS.jsonl OUT.jsonl [OVERRIDES.json]

Reads extract.py's output and gives each run a project, a session role, a scope and
one of the five classes of row 011-181, by the rules in ../../../host-load/011-181.md
("Method"). OVERRIDES maps "<session8> <start>" to [class, reason] for a run read by
hand. The output keeps the command and Squeal's last statement: it holds transcript
text, so keep it out of the repository. Prints the summary tables."""
import json, re, sys
from collections import Counter, defaultdict
from datetime import datetime

sys.path.insert(0, __file__.rsplit("/", 1)[0])
src = open(__file__.rsplit("/", 1)[0] + "/extract.py").read().replace("\nmain()\n", "\n")
EX = {}
exec(compile(src, "extract.py", "exec"), EX)

WT = re.compile(r"^/home/agent/projects/([^/]+)/\.ai/cezar/worktrees/([0-9a-f]{8})")
COUNTS = re.compile(r"(\d+) current[^,]*, (\d+) pending[^,]*, (\d+) stale[^,]*, (\d+) unknown")


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def project(cwd):
    m = WT.match(cwd or "")
    if m:
        return m.group(1), m.group(2), "worktree"
    m = re.match(r"^/home/agent/projects/([^/]+)/\.ai/cezar/t/([0-9a-f]{8})", cwd or "")
    if m:
        return m.group(1), m.group(2), "scratch"
    m = re.match(r"^/home/agent/projects/([^/]+)", cwd or "")
    if m:
        # a second clone of a project (cezar-task-settings-1596) counts as that project
        return re.sub(r"^(cezar|squeal)-.*", r"\1", m.group(1)), None, "checkout"
    if (cwd or "").startswith("/tmp/"):
        name = cwd[5:].split("/")[0]
        return ("cezar" if "cezar" in name else "squeal" if re.search(r"squeal|w31b|review", name) else "tmp"), None, "tmp"
    return "other", None, "other"


def role(r):
    t = " ".join(r.get("prompts") or [])
    if re.search(r"Selected skill: /reviewer|Use /reviewer|\"check-code-quality\"", t):
        return "reviewer"
    if re.search(r"Selected skill: /researcher|Use /researcher", t):
        return "researcher"
    if re.search(r"Selected skill: /coordinator|Use /coordinator|^Coordinate ", t) or re.search(r"/\.ai/cezar/t/[0-9a-f]{8}/int", r.get("cwd") or ""):
        return "coordinator"
    if re.search(r"Selected skill: /worker|Use /worker|Selected skill: /dev-flow|/dev-flow|Fix GitHub issue|Handle main CI failure|\"dev-flow\"|owned cezar worker", t):
        return "worker"
    return "other"


def scope(r):
    """full, or the count of file and name filters the runner got."""
    cmd = EX["strip_heredocs"](r["cmd"])
    if re.search(r"test:e2e|test/e2e|\.e2e\.ts|test:package", cmd):
        return "e2e"
    files = re.findall(r"[\w./*-]+\.(?:test|spec)\.[cm]?[jt]sx?|[\w./*-]+_test\.py|test_[\w]+\.py|tests?/[\w./*-]+", cmd)
    if "-t " in cmd or "--testNamePattern" in cmd or "-k " in cmd:
        return f"focused ({len(set(files)) or '?'} files, name filter)"
    if files:
        return f"focused ({len(set(files))} files)"
    if re.search(r"--config\s", cmd):
        return "scratch config"
    if "--shard" in cmd:
        return "full (shard)"
    return "full"


def squeal_said(r):
    """(time, text) of the later of the last hook message and the last squeal command output."""
    best = None
    for k in ("squealMsg", "squealOut"):
        v = r.get(k)
        if v and v[0] and (best is None or ts(v[0]) > ts(best[0])):
            best = (v[0], v[2] if k == "squealMsg" else f"$ {v[1]}\n{v[2]}")
    return best


def current(text):
    """True when Squeal's statement gave a current answer for the whole worktree."""
    if re.search(r"has not listed|A daemon is starting|daemon is not running|no daemon|dirty: \d+ pending|runner part of revision \d+ is pending", text):
        return False
    if re.search(r"no check pending, stale or unknown", text):
        return not re.search(r"without checks: \d+ pending|\d+ unknown", text)
    m = COUNTS.search(text)
    if m:
        return int(m.group(2)) + int(m.group(3)) + int(m.group(4)) == 0 and int(m.group(1)) > 0
    if re.search(r"Known failures: \d+; all [\d ]*test files current", text):
        return True
    if re.search(r"not current: \d+", text):
        return False
    if re.search(r"Known state: \w+, current", text):
        return True
    return None


INLINE_EDIT = re.compile(r"open\([^)]*['\"][wa]['\"]|\.write\(|write_text\(|sed -i|perl -pi|cat\s*>>?\s*[^/\s&]|>>\s*(src|test|packages)/|\b(cp|mv)\s|git (checkout|restore|apply|cherry-pick|stash)|apply_patch|--write\b")
RUNNER_AT = re.compile(r"\b(npx vitest|vitest(\.mjs)? run|npm (run )?test|npm exec|pnpm exec vitest|node --import|pytest)\b")


def edits_first(raw):
    """True when the command writes a file before its first runner starts."""
    m = RUNNER_AT.search(raw)
    return bool(INLINE_EDIT.search(raw[: m.start()] if m else raw))


def named(text, files):
    for line in text.split("\n"):
        if any(f in line for f in files) and re.search(r"^\s*(FAIL|PASS|✗|✓|×)|Known state|^Check:", line):
            return True
    return False


def classify(r, proj, kind, rl, sc):
    cmd = EX["strip_heredocs"](r["cmd"])
    k = set(r["kinds"])
    if re.search(r"--root\s+/tmp|--dir\s+/tmp|\bcd\s+[\"']?/tmp|--config\s+[\"']?/tmp", cmd):
        kind = "tmp"
    if re.search(r"--repeat|hyperfine", cmd) or any(RUNNER_AT.search(body) for body in re.findall(r"\bdo\b(.*?)\bdone\b", cmd, re.S)):
        return 5, "a test run repeated in a loop (timing, flake or mutation)"
    if r.get("eval"):
        return 5, "eval subject"
    if proj == "squeal":
        if "flock" in cmd and "squeal-full-run.lock" in cmd and rl == "reviewer":
            return 1, "reviewer's locked full run (reviewer skill, docs/process.md)"
        if kind == "worktree" and rl == "reviewer":
            return 1, "reviewer's independent rerun in the candidate (the skill bars Squeal's results)"
        if rl == "coordinator" and re.search(r"key-format\.test\.ts", cmd) and re.search(r"version-sensitive", cmd):
            return 1, "coordinator's integration check (docs/process.md)"
        if kind == "scratch" and re.search(r"/t/[0-9a-f]{8}/(int|docs)", r["cwd"]):
            return 3, "an integration tree no daemon validates"
        if kind != "worktree":
            return 2, "outside a Squeal worktree"
        if k & {"pytest", "node-test"} and not k & {"vitest"}:
            return 2, "pytest or node:test: Squeal covers only Vitest here"
        if sc == "e2e":
            return 2, "test/e2e: squeal.config.json excludes it"
    if proj == "cezar":
        if kind == "tmp" or re.search(r"--config\s+[\"']?\S*(\.ai/qa|proof)|proof_dir", cmd):
            return 1, "red/green proof in a disposable tree or scratch config (cezar AGENTS.md)"
        if kind not in ("worktree", "checkout"):
            return 2, "outside a Squeal worktree"
    if proj not in ("squeal", "cezar"):
        return 2, "a project without Squeal"
    if sc.startswith("full") and re.search(r"Handle main CI failure", " ".join(r.get("prompts") or [])):
        return 1, "full run to investigate a CI failure (cezar SDLC.md)"
    if re.search(r"--coverage", cmd):
        return 2, "a coverage run, which Squeal does not collect"
    if re.search(r"--config\s+[\"']?(\$\w+|/tmp|\S*/\.ai/cezar/t/)", cmd) and proj == "squeal":
        return 2, "a scratch config outside the suite"
    if re.search(r"\b[A-Z_]*UPDATE=1|--update\b", r["cmd"]):
        return 2, "a run that rewrites a baseline, which Squeal does not make"
    if re.search(r"git worktree add[^\n]*(/tmp|\$\w+/tree)", r["cmd"]) and proj == "cezar":
        return 1, "red/green proof in a disposable tree or scratch config (cezar AGENTS.md)"
    m = RUNNER_AT.search(cmd)
    if "squeal stop" in (cmd[: m.start()] if m else cmd):
        return 3, "the session stopped Squeal first"
    if r.get("ownTask") and kind == "worktree" and project(r["cwd"])[1] != r["ownTask"]:
        return 3, "a worktree other than the session's own, which its Squeal messages do not cover"
    said = squeal_said(r)
    if not said:
        return 3, "Squeal said nothing in the session before it"
    t_said, text = said
    if ts(t_said) >= ts(r["start"]):
        return 3, "Squeal's last statement came after the run started"
    if r.get("lastEdit") and ts(r["lastEdit"]) > ts(t_said):
        return 3, "an edit after Squeal's last statement"
    if edits_first(r["cmd"]):
        return 3, "the command edits before it runs"
    files = re.findall(r"[\w.-]+\.(?:test|spec|e2e)\.[cm]?[jt]sx?", cmd)
    if files and named(text, files):
        return 4, "Squeal had named the file's result"
    c = current(text)
    if c:
        return 4, "Squeal's last statement: every check current"
    return 3, "Squeal's last statement was not current"


def main():
    runs = [json.loads(l) for l in open(sys.argv[1])]
    over = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
    out = open(sys.argv[2], "w")
    cls, per_role, per_proj, wall = Counter(), Counter(), Counter(), defaultdict(float)
    roles = {}
    for r in runs:
        rl = role(r)
        if rl != "other" or r["session"] not in roles:
            roles[r["session"]] = rl if roles.get(r["session"], "other") == "other" else roles[r["session"]]
    for r in runs:
        r["ownTask"] = project(r["cwd"])[1]
        raw = EX["strip_heredocs"](r["cmd"])
        m = RUNNER_AT.search(raw)
        cds = re.findall(r"\bcd\s+[\"']?(/[^\s\"';&|]+)", raw[: m.start()] if m else raw)
        if cds and not cds[-1].startswith("/tmp"):
            r["cwd"] = cds[-1]
        proj, task, kind = project(r["cwd"])
        rl = "eval subject" if r.get("eval") else roles[r["session"]]
        sc = r.get("scope") or scope(r)
        c, why = classify(r, proj, kind, rl, sc)
        key = f"{(r['session'] or '')[:8]} {r['start'][:19]}"
        if key in over:
            c, why = over[key]
        w = None
        if r.get("durationMs"):
            w = int(r["durationMs"]) / 1000
        elif r.get("end"):
            w = (ts(r["end"]) - ts(r["start"])).total_seconds()
        said = squeal_said(r)
        rec = {"key": key, "src": r["src"], "project": proj, "task": task, "tree": kind, "role": rl, "start": r["start"], "wallS": w,
               "background": r.get("background"), "kinds": r["kinds"], "scope": sc, "class": c, "why": why, "cmd": r["cmd"], "said": said}
        out.write(json.dumps(rec) + "\n")
        cls[c] += 1
        per_role[(rl, c)] += 1
        per_proj[(proj, c)] += 1
        wall[c] += w or 0
    print("class runs wallS:", {c: (cls[c], round(wall[c])) for c in sorted(cls)})
    print("by role:", dict(sorted(per_role.items())))
    print("by project:", dict(sorted(per_proj.items())))


main()
