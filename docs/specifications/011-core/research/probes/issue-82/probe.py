#!/usr/bin/env python3
"""Throwaway real-CLI probe. Usage: python3 probe.py /absolute/squeal.mjs."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

cli = str(Path(sys.argv[1]).resolve())
cpus = os.cpu_count()
load = os.getloadavg()[0]
print(f"Start: load={load}, CPUs={cpus}", flush=True)
if load > cpus:
    sys.exit("Skipped: load exceeds CPU count")
scratch = Path(tempfile.mkdtemp(prefix="issue82-"))
seed = scratch / "seed"
receiver = scratch / "receiver"
seed.mkdir()
env = os.environ.copy()
for key in ("CLAUDE_SESSION_ID", "CODEX_THREAD_ID", "PI_SESSION_ID", "SQUEAL_SESSION_ID"):
    env.pop(key, None)
# Keep the host runtime directory and capacity pool. Only user config is isolated.
env["XDG_CONFIG_HOME"] = str(scratch / "config")


def command(cwd, args, expected=0):
    print(f"$ (cd {cwd}; {' '.join(args)})", flush=True)
    started = time.monotonic()
    result = subprocess.run(args, cwd=cwd, env=env, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
    print(result.stdout, end="", flush=True)
    print(f"[exit {result.returncode}; {time.monotonic() - started:.2f}s]", flush=True)
    if expected is not None and result.returncode != expected:
        raise RuntimeError(f"Expected exit {expected}, got {result.returncode}")
    return result.stdout


def sq(cwd, *args, expected=0):
    return command(cwd, ["node", "--disable-warning=ExperimentalWarning", cli, *args], expected)


try:
    sq(seed, "--version")
    command(seed, ["git", "init", "-q"])
    (seed / "package.json").write_text('{"name":"issue82","private":true,"type":"module"}\n')
    policy = {"baseline": {"onStart": "lookup-only"},
              "nodeTest": [{"name": "unit", "include": ["tests/*.test.mjs"]}],
              "runner": {"tierSize": 1, "backlogTierSize": 1}}
    (seed / "squeal.config.json").write_text(json.dumps(policy, indent=2) + "\n")
    (seed / "tests").mkdir()
    (seed / "value.mjs").write_text("export const value = 1;\n")
    for name in ("selected", "unselected", "unchanged"):
        imported = 'import { value } from "../value.mjs";\n' if name != "unchanged" else 'const value = 1;\n'
        (seed / "tests" / f"{name}.test.mjs").write_text(
            'import { test } from "node:test";\nimport assert from "node:assert/strict";\n'
            + imported + f'test("{name}", () => assert.equal(value, 1));\n')
    command(seed, ["git", "add", "."])
    command(seed, ["git", "-c", "user.name=Probe", "-c", "user.email=probe@example.invalid",
                   "commit", "-qm", "fixture"])
    sq(seed, "start")
    sq(seed, "run", "--all", "--wait", "60000")
    sq(seed, "stop")
    command(seed, ["git", "worktree", "add", "--detach", str(receiver), "HEAD"])
    sq(receiver, "start")
    sq(receiver, "status", "--full")
    inherited = sq(receiver, "why", "[unit] tests/selected.test.mjs > selected")
    if "Origin: inherited from" not in inherited:
        raise RuntimeError("No inherited origin for the selected check")
    sq(receiver, "status", "--wait", "60000", "tests/selected.test.mjs")
    sq(receiver, "stop")
    print("$ append a comment to receiver/value.mjs while its daemon is stopped", flush=True)
    with (receiver / "value.mjs").open("a") as output:
        output.write("// Controlled input change for the probe.\n")
    sq(receiver, "start")
    sq(receiver, "status", "--full")
    stale = sq(receiver, "status", "--wait", "60000", "tests/selected.test.mjs", expected=3)
    if "lookup-only" not in stale or "stale" not in stale.lower():
        raise RuntimeError("Did not reach the requested stale lookup-only state")
    sq(receiver, "retry", "--help")
    sq(receiver, "run", "--help")
    sq(receiver, "retry", "tests/selected.test.mjs", "--wait", "60000", expected=2)
    sq(receiver, "run", "--all", "--wait", "60000", "tests/selected.test.mjs", expected=2)
    sq(receiver, "retry", "tests/selected.test.mjs")
    sq(receiver, "status", "--wait", "60000", "tests/selected.test.mjs")
    sq(receiver, "status", "tests/unselected.test.mjs", expected=3)
    sq(receiver, "status", "tests/unchanged.test.mjs")
    sq(receiver, "status", "--full")
    print("VERDICT: inherited PASS -> stale; named wait exits 3; retry then wait passes; unselected stays stale.", flush=True)
finally:
    for root in (receiver, seed):
        if root.exists():
            sq(root, "stop", expected=None)
    print(f"End: load={os.getloadavg()[0]}, CPUs={cpus}; scratch={scratch}", flush=True)
    # Keep only the transcript; delete this probe's fixture and its store.
    shutil.rmtree(scratch)
