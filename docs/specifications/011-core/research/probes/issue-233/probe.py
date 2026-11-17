"""Throwaway issue-233 lifecycle probe; run from the Squeal checkout root."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import time

repo = Path.cwd()
parser = argparse.ArgumentParser()
parser.add_argument("--wait-ms", type=int, default=1500)
args = parser.parse_args()
cli = Path.home() / ".codex/plugins/data/squeal-hearsay/versions/0.1.531/dist/cli/squeal.mjs"
load = os.getloadavg()[0]
cpus = os.cpu_count()
if load > cpus:
    raise SystemExit(f"SKIP: load {load} > {cpus} CPUs")

root = Path(tempfile.mkdtemp(prefix="squeal-issue-233-"))
events = []

def clean(text):
    return text.replace(str(root), "<fixture>").replace(str(repo), "<checkout>").replace(str(Path.home()), "~")

def command(label, args, timeout=25):
    started = time.monotonic()
    result = subprocess.run(args, cwd=root, capture_output=True, text=True, timeout=timeout)
    event = {"label": label, "command": clean(" ".join(map(str, args))),
             "seconds": round(time.monotonic() - started, 3), "exit": result.returncode,
             "stdout": clean(result.stdout), "stderr": clean(result.stderr)}
    events.append(event)
    print(json.dumps(event), flush=True)
    return result

def squeal(label, *cli_args):
    return command(label, ["node", "--disable-warning=ExperimentalWarning", str(cli), *cli_args],
                   timeout=max(25, args.wait_ms / 1000 + 10))

def write_test(blocked, revision):
    body = "await new Promise(() => {});" if blocked else "expect(1).toBe(1);"
    (root / "small.test.ts").write_text(
        "import { test, expect } from 'vitest';\n"
        "import { writeFileSync } from 'node:fs';\n"
        f"// probe revision {revision}\n"
        "test('small file', async () => {\n"
        "writeFileSync('entered', 'yes');\n"
        f"{body}\n"
        "}, 600000);\n")

print(json.dumps({"time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "load1": load, "cpus": cpus,
                  "vitest": json.loads((repo / "node_modules/vitest/package.json").read_text())["version"]}), flush=True)
(root / "node_modules").symlink_to(repo / "node_modules", target_is_directory=True)
(root / ".gitignore").write_text("node_modules/\nentered\n")
(root / "package.json").write_text('{"name":"issue-233-probe","type":"module"}\n')
(root / "vitest.config.ts").write_text("export default { test: { maxWorkers: 1, pool: 'forks' } };\n")
(root / "squeal.config.json").write_text(json.dumps({
    "baseline": {"onStart": "lookup-only"},
    "complexity": {"enabled": False}
}) + "\n")
write_test(False, 0)
command("git-init", ["git", "init", "-q"])
command("git-add", ["git", "add", ".gitignore", "package.json", "vitest.config.ts", "squeal.config.json", "small.test.ts"])
command("git-commit", ["git", "-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", "probe"])
try:
    squeal("version", "--version")
    command("node-version", ["node", "--version"])
    squeal("start", "start")
    baseline = squeal("control", "status", "--wait", "10000", "small.test.ts")
    if baseline.returncode != 0:
        raise RuntimeError("control did not pass; no blocked-run inference is valid")
    squeal("control-why", "why", "small.test.ts")
    (root / "entered").unlink(missing_ok=True)
    write_test(True, 1)
    deadline = time.monotonic() + 10
    while not (root / "entered").exists() and time.monotonic() < deadline:
        time.sleep(0.1)
    print(json.dumps({"blocked_test_entered": (root / "entered").exists()}), flush=True)
    squeal("blocked-status", "status", "--wait", str(args.wait_ms), "small.test.ts")
    squeal("blocked-run", "run", "tests", "small.test.ts", "--wait", str(args.wait_ms))
    squeal("blocked-json", "status", "--json")
    stopped = squeal("stop-blocked", "stop", "--until-start")
    if stopped.returncode != 0:
        raise RuntimeError("stop did not confirm cleanup; preserve fixture")
    # Keep the blocking input: a new run is not a stale old run.
    squeal("restart-blocked", "start")
    squeal("after-restart", "status", "--wait", "1500", "small.test.ts")
    squeal("after-restart-json", "status", "--json")
    write_test(False, 2)
    squeal("recovery", "status", "--wait", "10000", "small.test.ts")
    squeal("recovery-why", "why", "small.test.ts")
finally:
    cleanup = squeal("cleanup", "stop", "--until-start")
    if cleanup.returncode == 0:
        shutil.rmtree(root)
    print(json.dumps({"load1_end": os.getloadavg()[0], "fixture_removed": cleanup.returncode == 0}), flush=True)
