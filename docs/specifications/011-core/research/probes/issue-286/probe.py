"""Throwaway issue-286 probe: one real daemon, one node:test file, no dependencies."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE / ".runtime"
CLI = Path("~/.codex/plugins/data/squeal-hearsay/bin/squeal").expanduser()
env = {k: v for k, v in os.environ.items()
       if not k.startswith(("SQUEAL_", "CEZ_", "PLUGIN_"))}

def emit(value):
    print(json.dumps(value).replace(str(Path.home()), "~").replace(str(ROOT), "<fixture>"), flush=True)

def run(args, timeout=70):
    start = time.monotonic()
    result = subprocess.run(list(map(str, args)), cwd=ROOT, env=env,
                            text=True, capture_output=True, timeout=timeout)
    emit({"argv": list(map(str, args)), "elapsedSeconds": round(time.monotonic()-start, 3),
          "exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
    return result

emit({"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
      "load": os.getloadavg(), "cpus": os.cpu_count()})
if os.getloadavg()[0] > os.cpu_count():
    raise SystemExit("SKIPPED: one-minute load exceeds CPU count")
ROOT.mkdir()  # Refuse to reuse an existing experiment.
started = False
try:
    run(["git", "init", "-q"])
    (ROOT / "package.json").write_text('{"name":"issue-286-probe","private":true,"type":"module"}\n')
    (ROOT / "squeal.config.json").write_text(json.dumps({
        "nodeTest": [{"name": "probe", "include": ["probe.test.mjs"]}],
        "baseline": {"onStart": "lookup-then-run-missing"},
        "complexity": {"enabled": False}, "coverage": {"enabled": False}
    }) + "\n")
    fixture = ROOT / "probe.test.mjs"
    fixture.write_text('import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("edit flips verdict", () => assert.equal(1, 1));\n')
    run(["node", "--version"])
    run([CLI, "--version"])
    started = True
    run([CLI, "start"])
    run([CLI, "checks"])
    seeded = run([CLI, "status", "--wait", "60000", "probe.test.mjs"])
    if seeded.returncode != 0:
        raise RuntimeError("No initial current pass; stop the bounded experiment")
    fixture.write_text(fixture.read_text().replace("assert.equal(1, 1)", "assert.equal(1, 2)"))
    emit({"edit": "assert.equal(1, 1) -> assert.equal(1, 2)", "load": os.getloadavg()})
    run([CLI, "status", "--wait", "60000", "probe.test.mjs"])
    run([CLI, "status", "--wait", "60000", "probe.test.mjs"])
finally:
    if started:
        stopped = run([CLI, "stop"])
        if stopped.returncode != 0:
            raise RuntimeError("Stop failed; retain fixture for cleanup")
    shutil.rmtree(ROOT)
    emit({"cleanup": "fixture daemon stopped; fixture removed", "load": os.getloadavg()})
