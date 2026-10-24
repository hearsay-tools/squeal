"""Throwaway probe for row 011-181. Usage: python3 -I analyze-samples.py SAMPLES.jsonl [CLS.jsonl] [TREES.json] [EXCLUDE_TASK8...]

Reads sample-trees.py's output. Prints one JSON summary: the hours covered, the
host's mean busy and %nice cores, the cores of Squeal's trees, of test trees outside
Squeal, of the rest of agent trees and of other trees; then one line per test tree
outside Squeal with its project, task, agent kind, nice, CPU seconds and wall, and,
when CLS (classify.py's output over the same hours) has a run of the same task that
was running when the tree's runner process started, that run's role and class. A tree outside
a worktree takes its agent's task. TREES maps a cwd prefix or a tree id to [project, task, role, class, why]
for trees read by hand: runs started from a script file, which no transcript command names,
and runs still running at the cut, which a Codex transcript names only when they end.
A test tree whose cwd is in an EXCLUDE task (this session's own) is left out."""
import json, re, sys
from collections import defaultdict
from datetime import datetime, timezone

WT = re.compile(r"/home/agent/projects/([^/]+)/\.ai/cezar/(?:worktrees|t)/([0-9a-f]{8})")


def where(cwd):
    m = WT.search(cwd or "")
    if m:
        return m.group(1), m.group(2)
    m = re.match(r"/home/agent/projects/([^/]+)", cwd or "")
    if m:
        return m.group(1), None
    return ("tmp" if (cwd or "").startswith("/tmp") else "other"), None


def main():
    lines = [json.loads(l) for l in open(sys.argv[1])]
    args = sys.argv[2:]
    runs = [json.loads(l) for l in open(args.pop(0))] if args and args[0].endswith(".jsonl") else []
    hand = json.load(open(args.pop(0))) if args and args[0].endswith(".json") else {}
    exclude = set(args)
    agents = {l["id"]: l for l in lines if l.get("event") == "agent"}
    starts = {l["id"]: l for l in lines if l.get("event") == "test-start"}
    ends = {l["id"]: l for l in lines if l.get("event") == "test-end"}
    samples = [l for l in lines if "busy" in l]
    tot = defaultdict(float)
    tree_cpu = defaultdict(float)
    hours = sum(s["el"] for s in samples) / 3600
    for s in samples:
        w = s["el"]
        for k in ("busy", "nice", "user", "system", "accounted"):
            tot[k] += s[k] * w
        tot["squeal"] += sum(s["squeal"].values()) * w
        for i, (c, _) in s["tests"].items():
            tree_cpu[i] += c * w
            proj, task = where(starts.get(i, {}).get("cwd"))
            if task in exclude:
                continue
            tot["tests"] += c * w
        tot["agents"] += sum(s["agents"].values()) * w
        tot["other"] += sum(v for n, v in s["other"].items()) * w
    secs = sum(s["el"] for s in samples) or 1
    summary = {"hours": round(hours, 2), "samples": len(samples), "from": samples[0]["t"] if samples else None, "to": samples[-1]["t"] if samples else None}
    summary.update({f"{k}Cores": round(v / secs, 2) for k, v in tot.items()})
    saturated = [s for s in samples if s["busy"] >= 0.9 * 24]
    summary["saturatedMinutes"] = len(saturated)
    print(json.dumps(summary))
    by_class = defaultdict(float)
    for i, st in sorted(starts.items(), key=lambda x: x[1]["t"]):
        proj, task = where(st.get("cwd"))
        ag = agents.get(st.get("agent") or "", {})
        if task is None and ag:
            proj2, task = where(ag.get("cwd"))
            proj = proj2 if proj in ("tmp", "other") else proj
        if task in exclude:
            continue
        t0 = st["started"]
        match = None
        for r in runs:
            if r.get("task") != task:
                continue
            rt = datetime.fromisoformat(r["start"].replace("Z", "+00:00"))
            if rt.tzinfo is None:
                rt = rt.replace(tzinfo=timezone.utc)
            rt = rt.timestamp()
            span = (r.get("wallS") or 0) + 90
            if rt - 5 <= t0 <= rt + span:
                # a run whose command names the tree's /tmp copy, or none, matches first
                cwd = st.get("cwd") or ""
                tmp = re.search(r"(?:\bcd\s+|--root\s+|--dir\s+)[\"']?(/tmp/[^/\s'\"]+)", r.get("cmd") or "")
                same = (tmp.group(1) in cwd) if tmp else not cwd.startswith("/tmp")
                if match is None or (same, rt) > match[:2]:
                    match = (same, rt, r)
        match = match and match[2]
        cpu = round(tree_cpu[i], 1)
        e = ends.get(i, {})
        cls = match["class"] if match else None
        role, why = match and match["role"], match and match["why"]
        for prefix, (hp, ht, hr, hc, hw) in hand.items():
            if prefix == i or (prefix.startswith("/") and (st.get("cwd") or "").startswith(prefix)):
                proj, task, role, cls, why = hp, ht, hr, hc, hw
        by_class[cls] += cpu
        print(json.dumps({"t": st["t"], "project": proj, "task": task, "agent": ag.get("kind"), "kind": st.get("kind"), "nice": st.get("nice"),
                          "cpuS": cpu, "wallS": e.get("wallS"), "ended": bool(e), "role": role, "class": cls, "why": why}))
    print(json.dumps({"cpuSByClass": {str(k): round(v, 1) for k, v in by_class.items()}}))


main()
