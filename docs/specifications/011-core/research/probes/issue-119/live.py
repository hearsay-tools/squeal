"""Throwaway two-file node:test fixture, real bundled CLI and daemon."""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

load = os.getloadavg()[0]
print(json.dumps({"started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "load": load, "cpus": os.cpu_count()}), flush=True)
if load > os.cpu_count():
    print("SKIP: one-minute load exceeds CPUs")
    raise SystemExit(77)
cli = pathlib.Path("plugins/claude-code/dist/cli/squeal.mjs").resolve()
edit_case = "--edit" in sys.argv
node = shutil.which("node")
with tempfile.TemporaryDirectory(prefix="sq119-live-") as tmp:
    base = pathlib.Path(tmp)
    root = base / "repo"
    root.mkdir()
    runtime = base / "run"
    runtime.mkdir(mode=0o700)
    env = {"PATH": os.environ["PATH"], "XDG_RUNTIME_DIR": str(runtime), "LANG": "C.UTF-8"}
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    (root / "package.json").write_text('{"name":"issue-119-probe","type":"module"}')
    (root / "squeal.config.json").write_text(json.dumps({
        "baseline": {"onStart": "lookup-then-run-missing"},
        "nodeTest": [{"name": "unit", "include": ["fast.test.mjs", "slow.test.mjs"]}],
        "slow": {"include": ["slow.test.mjs"], "quietMs": 0, "maxParallel": 1, "maxWorkers": 1},
        "complexity": {"enabled": False},
        "coverage": {"enabled": False}
    }))
    marker = base / "fast-started"
    fast_text = "import { test } from 'node:test';\nimport { writeFileSync } from 'node:fs';\ntest('fast lane backlog', async () => { writeFileSync(" + json.dumps(str(marker)) + ", 'started'); await new Promise(r => setTimeout(r, DELAY)); });\n"
    (root / "fast.test.mjs").write_text(fast_text.replace("DELAY", "0" if edit_case else "12000"))
    (root / "slow.test.mjs").write_text("import { test } from 'node:test';\ntest('slow lane', async () => { await new Promise(r => setTimeout(r, 1000)); });\n")
    def command(args, timeout=40):
        argv = [node, "--disable-warning=ExperimentalWarning", str(cli), *args]
        start = time.monotonic()
        result = subprocess.run(argv, cwd=root, env=env, capture_output=True, text=True, timeout=timeout)
        print(json.dumps({"command": argv, "elapsedMs": round((time.monotonic()-start)*1000), "exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr}), flush=True)
        return result
    with (base / "daemon.log").open("w+") as log:
        daemon = subprocess.Popen([node, "--disable-warning=ExperimentalWarning", str(cli), "daemon", str(root)], cwd=root, env=env, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 25
            while not marker.exists() and time.monotonic() < deadline and daemon.poll() is None:
                time.sleep(.1)
            if not marker.exists():
                raise RuntimeError("fast fixture did not start")
            if edit_case:
                baseline = command(["status", "--wait", "20000", "fast.test.mjs", "slow.test.mjs"])
                assert baseline.returncode == 0
                marker.unlink()
                (root / "fast.test.mjs").write_text(fast_text.replace("DELAY", "12000"))
                with (root / "slow.test.mjs").open("a") as slow:
                    slow.write("// edited alongside the fast file\n")
                deadline = time.monotonic() + 20
                while not marker.exists() and time.monotonic() < deadline:
                    time.sleep(.1)
                assert marker.exists(), "edited fast file did not start"
            command(["status", "--json"])
            result = command(["run", "--slow", "--wait", "3000000"])
            assert result.returncode == 0, "live wait did not finish successfully"
            assert "has its result" in result.stdout, "slow result missing from wait"
        finally:
            daemon.terminate()
            try:
                daemon.wait(timeout=15)
            except subprocess.TimeoutExpired:
                daemon.kill()
                daemon.wait()
            log.seek(0)
            print(json.dumps({"daemonExit": daemon.returncode, "daemonLog": log.read()}), flush=True)
