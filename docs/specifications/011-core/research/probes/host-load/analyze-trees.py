"""Who made the load in one sample-trees.py sample. Usage: python3 -I analyze-trees.py TREES.jsonl [TOP]

Row 011-186. Reads sample-trees.py's output and, for each of its lines, prints the
host's busy cores and idle share, then the TOP (default 5) largest trees of each
kind (squeal, test, agent, other) at 0.1 core or more, one line each: kind,
cores, nice values, project, task (the worktree's id8), role, agent kind and what
the tree is. Then one JSON summary line per sample line.

- project and task: from the daemon's root (squeal) or the cwd (test, agent);
  a test tree outside a project (`/tmp`) takes its agent's.
- role: the agent session's role from sample-trees.py (`?` when its argv names
  none, as for Codex). A squeal tree takes the role of an agent session in the
  same worktree; a test tree takes its own agent's.
- saturated: idle under 10% of the CPUs, as C1 counts a sar sample."""
import json, re, sys

WT = re.compile(r"/([^/]+)/\.ai/cezar/(?:worktrees|t)/([0-9a-f]{8})")
KINDS = ("squeal", "test", "agent", "other")
ROW = "  {:6} {:>6}  {:5}  {:7} {:8}  {:22}  {}"


def short(path):
    return re.sub(r"^.*/projects/", "", path or "?")


def where(path):
    m = WT.search(path or "")
    if m:
        return m.group(1), m.group(2)
    m = re.search(r"/projects/([^/]+)", path or "")
    if m:
        return m.group(1), None
    return ("tmp" if (path or "").startswith("/tmp") else "other"), None


def main():
    events = [json.loads(l) for l in open(sys.argv[1])]
    top = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    start = next((e for e in events if e.get("event") == "start"), {})
    cpus = start.get("cpus") or 1
    agents = {e["id"]: e for e in events if e.get("event") == "agent"}
    tests = {e["id"]: e for e in events if e.get("event") == "test-start"}
    by_task = {}
    for a in agents.values():
        by_task.setdefault(where(a["cwd"]), a)

    def session(a):
        return {"role": (a.get("role") or "?") if a else None, "agent": a.get("kind") if a else None}

    for line in (e for e in events if "busy" in e):
        trees = []
        for root, (c, n) in line["squeal"].items():
            p, t = where(root)
            trees.append({"kind": "squeal", "cores": c, "nice": n, "project": p, "task": t, **session(t and by_task.get((p, t))), "what": f"daemon {short(root)}"})
        for i, (c, procs, n) in line["tests"].items():
            st, a = tests.get(i, {}), agents.get(tests.get(i, {}).get("agent") or "")
            p, t = where(st.get("cwd"))
            if t is None and a:
                ap, t = where(a["cwd"])
                p = ap if p in ("tmp", "other") else p
            via = " via flock" if "flock" in st.get("via", []) else ""
            cmd = (st.get("cmd") or "?").replace((st.get("cwd") or "?") + "/", "")
            trees.append({"kind": "test", "cores": c, "nice": n, "project": p, "task": t, **session(a), "what": f"{st.get('kind')}, {procs} procs{via}, in {short(st.get('cwd'))}: {cmd}"[:200]})
        for i, (c, n) in line["agents"].items():
            a = agents.get(i)
            p, t = where(a["cwd"]) if a else (None, None)
            trees.append({"kind": "agent", "cores": c, "nice": n, "project": p, "task": t, **session(a), "what": "agent session" if a else "agents under 0.05 core each"})
        for nm, (c, n) in line["other"].items():
            trees.append({"kind": "sampler" if nm == "sampler" else "other", "cores": c, "nice": n, "project": None, "task": None, "role": None, "agent": None, "what": nm})
        idle = max(0.0, cpus - line["busy"] - line["iowait"])
        sat = idle < 0.1 * cpus
        print(f"{line['t']} {line['el']} s: busy {line['busy']} of {cpus} cores (idle {100 * idle / cpus:.0f}%{', saturated' if sat else ''}), "
              f"%nice {line['nice']}, %system {line['system']}; the trees explain {line['accounted']}")
        print(ROW.format("kind", "cores", "nice", "project", "task", "role (agent)", "what"))
        shown = []
        for kind in KINDS:
            rows = sorted((r for r in trees if r["kind"] == kind and r["cores"] >= 0.1), key=lambda r: -r["cores"])[:top]
            for r in rows:
                who = f"{r['role']} ({r['agent']})" if r["agent"] else (r["role"] or "-")
                print(ROW.format(kind, f"{r['cores']:.2f}", ",".join(map(str, r["nice"])) or "-", r["project"] or "-", r["task"] or "-", who, r["what"]))
            shown += rows
        by_kind = {k: round(sum(r["cores"] for r in trees if r["kind"] == k), 2) for k in KINDS + ("sampler",)}
        print(json.dumps({"t": line["t"], "windowSeconds": line["el"], "busyCores": line["busy"], "idlePct": round(100 * idle / cpus, 1), "saturated": sat,
                          "squealShareOfBusy": round(100 * by_kind["squeal"] / line["busy"]) if line["busy"] > 0 else None,
                          "niceCores": line["nice"], "accountedCores": line["accounted"], "coresByKind": by_kind,
                          "top": [{k: r[k] for k in ("kind", "cores", "nice", "project", "task", "role", "agent", "what")} for r in shown]}))


main()
