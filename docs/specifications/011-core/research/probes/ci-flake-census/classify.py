#!/usr/bin/env python3
"""Throwaway probe (row 011-428). Reads census.csv and scope.json, assigns each failed test to a
cause group, and prints the per-group counts the findings file quotes.

    python3 -I classify.py <scope.json> census.csv > groups.txt

A failure counts as intermittent when its job passed on the same commit (another attempt or
another run), or when its test has such a sighting elsewhere in the window, or a board row names
it. Everything else is listed as "not shown intermittent" and left out of the rates.
"""
import collections
import csv
import json
import re
import sys

scope_path, census_path = sys.argv[1:3]

# (group, file regex, test regex or None). First match wins.
RULES = [
    # G3 first: a folder removed while a process started under it still writes (ENOTEMPTY).
    ("G3", r".*", r"ENOTEMPTY"),
    ("G3", r"\(outside a test\)", r"Unhandled Errors"),
    # G7: the CI machine: the e2e fixtures' offline npm install, a whole e2e shard at once.
    ("G7", r".*", r"ENOTCACHED"),
    ("G7", r"e2e/(lifecycle|ps|pytest)\.test", r"waiting for (a passing baseline|a snapshot)"),
    # G1: the test measures wall-clock or CPU time on a shared 4-vCPU runner: a fixed bound,
    # Vitest's 5 s default, or a short --wait against a cold start.
    ("G1", r"code/coverage/writer-(turns|pace)", None),
    ("G1", r"code/crap/chain-load", None),
    ("G1", r"code/gate/keep-early", None),
    ("G1", r"code/gate/lanes-stored-rerun", None),
    ("G1", r"daemon/busy-requests", None),
    ("G1", r"daemon/departure", None),
    ("G1", r"daemon/lifecycle", r"SIGKILL a replacement"),
    ("G1", r"scheduler/backlog-slots", None),
    ("G1", r"scheduler/backlog-tiers", None),
    ("G1", r"scheduler/environment-growth-siblings", None),
    ("G1", r"runners/vitest/ci-map-client-clock", None),
    ("G1", r"runners/node-test/graph-cost", None),
    ("G1", r"store/prune-vacuum", None),
    ("G1", r"lint/provider/program-build", None),
    ("G1", r"cli/wait-reads", r"polls once a second"),
    ("G1", r"cli/status-paths", None),
    ("G1", r"cli/status-at-now-daemon", None),
    ("G1", r"cli/warmup", None),
    ("G1", r"cli/status-wait-paused", None),
    ("G1", r"cli/run-group", None),
    ("G1", r"retry/records", r"past the limit"),
    ("G1", r"status/not-current", None),
    ("G1", r"status/why-unknown-standing", None),
    ("G1", r"cli/wait-stale-start", None),
    ("G1", r"harness/stop-slow-wait", None),
    ("G1", r"lint/wiring/stop-group-mixed", None),
    ("G1", r"daemon/helpers\.ts|harness/hung-daemon", r"SIGSTOPped"),
    # G2: the test acts on the first sign of readiness (a file that exists, a line, a pid, one
    # /proc/locks read) before the process that writes the state has settled.
    ("G2", r"store-process/logs", r"own log file"),
    ("G2", r"harness/hand-off", None),
    ("G2", r"cli/stop-at", None),
    ("G2", r"runners/pytest/run/run", r"hung test"),
    ("G2", r"code/store\.test", r"WAL"),
    ("G2", r"code/crap/seed-failed", None),
    ("G2", r"scheduler/group-lanes-moments", None),
    ("G2", r"scheduler/tier-yields-(overrun|kept)", None),
    ("G2", r"scheduler/handover-batches", None),
    ("G2", r"daemon/handover\.test", None),
    ("G2", r"daemon/handover-gap", None),
    ("G2", r"code/gate/keep-(busy|daemon)", None),
    ("G2", r"cli/ci-record\.test", None),
    ("G2", r"daemon/scratch-(children|identity)", None),
    ("G2", r"daemon/low-priority", None),
    ("G2", r"integration/optimizer-start", None),
    ("G2", r"cli/proof(-copy|-green-daemon)?\.test", None),
    ("G2", r"runner-host/daemon-host", None),
    ("G2", r"keys/validity/compare", None),
    # G4: the node:test busy-loop fixture: a whole stream the signal made is read as an early end.
    ("G4", r"runners/node-test/(run|fixtures)\.test", r"busy loop"),
    # G5: a product deadline is missed on a slow runner and the owed news is never re-armed.
    ("G5", r"e2e/pi\.test", None),
    ("G5", r"integration/pi-(events|wake)", None),
    ("G5", r"helpers/pi-wake-trace", None),
    ("G5", r"harness/opencode-(wake|continued|dispose)", None),
    ("G5", r"integration/node-test\.test", None),
    # G6: product: a hook reports a handover claimed without storing the claim; start spawns a second.
    ("G6", r"daemon/handover-tier", None),
    # G8: Vitest keeps a crashed worker's cancellation pending (row 011-281; repaired by 011-289).
    ("G8", r"scheduler/runs\.test", r"(stalled|timed out in 120000)"),
]


def group_of(file, test, error):
    for group, fre, tre in RULES:
        if re.search(fre, file) and (tre is None or re.search(tre, f"{test} {error}")):
            return group
    return None


scope = json.load(open(scope_path))
done = [r for r in scope if r["conclusion"] in ("success", "failure")]
by_run = {str(r["databaseId"]): r for r in scope}
rows = list(csv.DictReader(open(census_path)))

# A test with a same-commit pass anywhere marks all its sightings intermittent.
def test_key(r):
    return (r["file"], re.sub(r"^\[\w[\w-]*\] \S+ > ", "", r["test"])[:60])

shown = {test_key(r) for r in rows if r["same_commit_passed"]}
BOARD_EXTRA = [r"store-process/logs", r"opencode-wake", r"environment-growth-siblings", r"handover-gap",
               r"prune-vacuum", r"proof-copy", r"stop-at"]

# A run that failed in three or more jobs with no same-commit pass broke for real (cand/0.1.600,
# 45070829138, failed 10 files across 6 jobs): its sightings are not counted as intermittent.
jobs_failed = collections.defaultdict(set)
for r in rows:
    jobs_failed[r["run"]].add(r["job"])
# Runs a board row cites (board-runs.txt, from the rows' evidence) stay in.
board_runs = set(open("board-runs.txt").read().split())
broken = (
    {run for run, jobs in jobs_failed.items() if len(jobs) >= 3}
    - {r["run"] for r in rows if r["same_commit_passed"]}
    - board_runs
)

out = collections.defaultdict(list)
unexplained = []
for r in rows:
    # Fixture files a nested Vitest printed (`test/fails.test.ts:2`), and planted fixtures.
    if not r["file"] or r["file"].startswith("test/fixtures/") or re.search(r":\d+$", r["file"]):
        continue
    intermittent = r["run"] not in broken and (
        r["same_commit_passed"]
        or test_key(r) in shown
        or any(re.search(b, r["file"]) for b in BOARD_EXTRA)
    )
    if not intermittent:
        continue
    g = group_of(r["file"], r["test"], r["error"])
    if g is None:
        unexplained.append(r)
    else:
        out[g].append(r)

n_runs = len(done)
n_main = sum(1 for r in done if r["headBranch"] == "main" and r["event"] != "schedule")
print(f"completed runs {n_runs}; main push runs {n_main}; runs left out as broken: {sorted(broken)}")
for g in sorted(out):
    rs = out[g]
    runs = {r["run"] for r in rs}
    jobs = {(r["run"], r["attempt"], r["job"]) for r in rs}
    strong = {r["run"] for r in rs if r["same_commit_passed"]}
    main_reruns = {
        r["run"] for r in rs
        if by_run[r["run"]]["headBranch"] == "main" and by_run[r["run"]]["attempt"] > 1 and r["attempt"] == "1"
    }
    node = collections.Counter(re.match(r"Node (\d+)", r["job"]).group(1) for r in rs if r["job"].startswith("Node"))
    files = collections.Counter(r["file"] for r in rs)
    last = max(r["created"] for r in rs)[:10]
    print(f"\n{g}: {len(runs)} runs ({100 * len(runs) / n_runs:.1f} per 100 runs), {len(jobs)} failed jobs, "
          f"{len(strong)} runs with a same-commit pass, {len(main_reruns)} main runs re-run to green, "
          f"node {dict(node)}, last {last}")
    for f, c in files.most_common():
        print(f"   {c:3d} {f}")
print("\nintermittent but in no group:")
for r in unexplained:
    print("  ", r["run"], r["file"], "|", r["test"][:80], "|", r["error"][:80])

# The last seven days alone: what still fails after the repairs that landed in the window.
since = "2026-11-20T00:00:00Z"
recent = [r for r in done if r["createdAt"] >= since]
print(f"\nsince {since[:10]}: {len(recent)} completed runs")
for g in sorted(out):
    rs = [r for r in out[g] if r["created"] >= since]
    runs = {r["run"] for r in rs}
    print(f"  {g}: {len(runs)} runs ({100 * len(runs) / len(recent):.1f} per 100), files {sorted(collections.Counter(r['file'] for r in rs).items(), key=lambda x: -x[1])}")

# Jobs where two or more G1 files failed together: one slow runner, not several bad bounds.
together = collections.defaultdict(set)
for r in out.get("G1", []):
    together[(r["run"], r["attempt"], r["job"])].add(r["file"])
print("\nG1 jobs with two or more files failing together:")
for k, files in together.items():
    if len(files) > 1:
        print("  ", k, sorted(files))

# Totals across groups: runs with any intermittent sighting, and the main runs green only after
# a re-run, split by the groups their first attempt failed in.
all_runs = {r["run"] for g in out for r in out[g]}
g12 = {r["run"] for g in ("G1", "G2") for r in out[g]}
print(f"\nruns with an intermittent sighting: {len(all_runs)}; in G1 or G2: {len(g12)}")
reran = [r for r in done if r["headBranch"] == "main" and r["event"] != "schedule"
         and r["attempt"] > 1 and r["conclusion"] == "success"]
first = collections.defaultdict(set)
for g in out:
    for r in out[g]:
        if r["attempt"] == "1":
            first[r["run"]].add(g)
split = collections.Counter("+".join(sorted(first.get(str(r["databaseId"]), {"none"}))) for r in reran)
print(f"main runs green after a re-run: {len(reran)}; by groups of attempt 1: {dict(split)}")
