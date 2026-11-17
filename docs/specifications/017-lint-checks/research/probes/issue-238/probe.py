"""Throwaway issue-238 probe: one daemon, two lintable files, one node:test file."""
import json
import os
from pathlib import Path
import subprocess
import time

raise SystemExit("Observation only: dependency isolation must be fixed before replay; see README.md")

base = Path(__file__).resolve().parent
repo = base.parents[5]
fixture = base / "fixture"
cli = Path.home() / ".codex/plugins/data/squeal-hearsay/bin/squeal"
load = os.getloadavg()[0]
cpus = os.cpu_count()
print(json.dumps({"load1": load, "cpus": cpus}), flush=True)
if load > cpus:
    raise SystemExit("SKIPPED: load1 exceeds CPU count")
fixture.mkdir(exist_ok=True)
(fixture / "src").mkdir(exist_ok=True)
(fixture / "test").mkdir(exist_ok=True)
files = {
    ".gitignore": "node_modules/\n",
    "package.json": json.dumps({"name": "issue-238-probe", "private": True, "type": "module"}),
    "squeal.config.json": json.dumps({
        "baseline": {"onStart": "lookup-then-run-missing"},
        "nodeTest": [{"name": "unit", "include": ["test/*.test.mjs"]}],
        "lint": {"enabled": True, "include": ["src/**", "test/**"]},
        "checks": [{"name": "lint", "lint": True, "at": "edit"}],
        "complexity": {"enabled": False}, "coverage": {"enabled": False},
        "runner": {"tierSize": 1},
    }),
    "eslint.config.js": "export default [{ files: ['**/*.mjs'], rules: { 'no-unused-vars': 'error' } }];\n",
    "src/value.mjs": "export const value = 2;\nconst unused = 1;\n",
    "test/value.test.mjs": "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../src/value.mjs';\ntest('value', () => assert.equal(value, 2));\n",
}
for name, body in files.items():
    (fixture / name).write_text(body)
modules = fixture / "node_modules"
if not modules.exists():
    modules.symlink_to(repo / "node_modules", target_is_directory=True)

def command(args, timeout=30):
    return subprocess.run(args, cwd=fixture, capture_output=True, text=True, timeout=timeout)

command(["git", "init", "-q"])
command(["git", "add", "."])
print("version:", command([str(cli), "--version"]).stdout.strip(), flush=True)
started = time.monotonic()
try:
    answer = command([str(cli), "start"], 45)
    print("start:", answer.returncode, answer.stdout.strip(), answer.stderr.strip(), flush=True)
    for i in range(25):
        status = command([str(cli), "status", "--json"])
        try:
            data = json.loads(status.stdout)
        except ValueError:
            print("unread status:", status.returncode, status.stdout[:300], flush=True)
            time.sleep(5)
            continue
        print(json.dumps({"elapsed": round(time.monotonic()-started, 2), "revision": data.get("revision"),
                          "counts": data.get("counts"), "lint": data.get("lint"),
                          "load1": os.getloadavg()[0]}), flush=True)
        lint = data.get("lint", {})
        if lint.get("files", 0) > 0 and sum(lint.get(k, 0) for k in ["pending", "unknown", "stale"]) == 0:
            break
        if time.monotonic() - started >= 120:
            break
        time.sleep(5)
    for args in [["status", "--wait", "10000", "test/value.test.mjs"],
                 ["lint", "src/value.mjs", "test/value.test.mjs", "--json"],
                 ["run", "lint", "--wait", "120000"]]:
        t = time.monotonic()
        answer = command([str(cli), *args], 135)
        print("command:", " ".join(args), "elapsed:", round(time.monotonic()-t, 2),
              "exit:", answer.returncode, "output:", answer.stdout.strip(), answer.stderr.strip(), flush=True)
finally:
    answer = command([str(cli), "stop", "--until-start"], 30)
    print("cleanup:", answer.returncode, answer.stdout.strip(), flush=True)
