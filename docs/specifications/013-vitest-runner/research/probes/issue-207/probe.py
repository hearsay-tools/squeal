"""Throwaway, bounded issue-207 probe. Run from the Squeal checkout root."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

repo = Path.cwd()
cli = "/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal"
mode = sys.argv[1]
assert mode in ("control", "warning", "failure", "exit", "crash")
load = os.getloadavg()[0]
cpus = os.cpu_count()
if load > cpus:
    raise SystemExit(f"SKIP: load {load} > {cpus} CPUs")

with tempfile.TemporaryDirectory(prefix="squeal-issue-207-") as tmp:
    root = Path(tmp)
    files = {
        ".gitignore": "node_modules/\n",
        "package.json": json.dumps({"name": "issue-207-probe", "type": "module"}),
        "vitest.config.ts": "export default { test: { pool: 'forks', maxWorkers: 1, "
        + f"teardownTimeout: {10000 if mode == 'control' else 1}"
        + " } };\n",
        "subject.ts": "export function value() { return 1; }\n",
        "pass.test.ts": "import { test, expect } from 'vitest';\n"
        "import { value } from './subject.ts';\n"
        "test('completed pass', () => expect(value()).toBe(1));\n",
    }
    if mode == "failure":
        files["failure.test.ts"] = (
            "import { test, expect } from 'vitest';\n"
            "import { value } from './subject.ts';\n"
            "test('real assertion failure', () => expect(value()).toBe(99));\n"
        )
    if mode in ("exit", "crash"):
        files["crash.test.ts"] = (
            "import { test } from 'vitest';\n"
            "import { value } from './subject.ts';\n"
            "test('worker exits', () => { value(); "
            + ("process.exit(7);" if mode == "exit" else "process.kill(process.pid, 'SIGKILL');")
            + " });\n"
        )
    for path, content in files.items():
        (root / path).write_text(content)
    (root / "node_modules").symlink_to(repo / "node_modules", target_is_directory=True)
    def git(*args):
        subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)
    git("init", "-q", "-b", "main")
    git("add", *files.keys())
    git("-c", "user.name=Probe", "-c", "user.email=probe@example.invalid",
        "commit", "-qm", "probe baseline")
    (root / "subject.ts").write_text("export function value() { return 1 + 0; }\n")
    command = [cli, "code", "--base", "HEAD", "--json", "--timeout", "15"]
    started = time.monotonic()
    result = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=25)
    # Replace only the disposable root; preserve the report and stderr otherwise.
    print(json.dumps({
        "mode": mode, "load1": load, "cpus": cpus,
        "command": command, "squealVersion": subprocess.check_output(
            [cli, "--version"], text=True).strip(),
        "nodeVersion": subprocess.check_output(["node", "--version"], text=True).strip(),
        "vitestVersion": json.loads((repo / "node_modules/vitest/package.json").read_text())["version"],
        "seconds": round(time.monotonic() - started, 3), "exit": result.returncode,
        "stderr": result.stderr.replace(tmp, "<fixture>"),
        "stdout": result.stdout.replace(tmp, "<fixture>"),
    }, indent=2))
