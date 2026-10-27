"""Throwaway issue-111 probe. Run from the Squeal repository root."""
import datetime
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import time

source = Path.cwd()
cli = source / "plugins/claude-code/dist/cli/squeal.mjs"
load = os.getloadavg()
cpus = os.cpu_count()
print(json.dumps({"utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "load": load, "cpus": cpus,
                  "source": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()}), flush=True)
if load[0] > cpus:
    raise SystemExit("SKIPPED: one-minute load exceeds CPU count")

with tempfile.TemporaryDirectory(prefix="squeal-issue111-") as temp:
    root = Path(temp)
    repo = root / "repo"
    repo.mkdir()
    (repo / "test").mkdir()
    (repo / "node_modules").symlink_to(source / "node_modules", target_is_directory=True)
    (repo / ".gitignore").write_text("node_modules\nmarkers\n")
    (repo / "markers").mkdir()
    (repo / "package.json").write_text('{"name":"issue-111","private":true,"type":"module"}\n')
    (repo / "squeal.config.json").write_text(json.dumps({
        "baseline": {"onStart": "lookup-then-run-missing"},
        "coverage": {"enabled": False}, "complexity": {"enabled": False},
        "observe": {"runtimeInputs": False},
        "runner": {"tierSize": 2, "backlogTierSize": 2}
    }))
    (repo / "vitest.config.js").write_text(
        'export default {test: {include: ["test/*.test.js"], maxWorkers: 2, testTimeout: 30000}};\n')
    (repo / "test/fast.test.js").write_text(
        'import {test, expect} from "vitest";\ntest("fast", () => expect(1).toBe(1));\n')
    (repo / "test/slow.test.js").write_text(
        'import {test} from "vitest";\n'
        'import {writeFileSync, existsSync} from "node:fs";\n'
        'test("slow", async () => {\n'
        ' writeFileSync("markers/slow-started", "started");\n'
        ' const deadline = Date.now() + 25000;\n'
        ' while (!existsSync("markers/release") && Date.now() < deadline)\n'
        '   await new Promise(r => setTimeout(r, 50));\n'
        ' writeFileSync("markers/slow-ended", "ended");\n'
        '});\n')
    env = dict(os.environ)
    env["XDG_RUNTIME_DIR"] = str(root / "runtime")
    (root / "runtime").mkdir(mode=0o700)
    for key in ("CEZ_TASK_ID", "CEZ_HANDOFF_FILE", "SQUEAL_COMMAND"):
        env.pop(key, None)

    def run(args, timeout=45, verbose=True):
        result = subprocess.run(args, cwd=repo, env=env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        if verbose:
            print("$ " + shlex.join(map(str, args)), flush=True)
            print(result.stdout, end="", flush=True)
            if result.stderr:
                print(result.stderr, end="", flush=True)
            print("exit", result.returncode, flush=True)
        return result

    for args in (["git", "init", "-q"], ["git", "add", "."],
                 ["git", "-c", "user.name=Probe", "-c", "user.email=probe@example.invalid",
                  "commit", "-qm", "fixture"]):
        assert run(args, verbose=False).returncode == 0
    command = ["node", "--disable-warning=ExperimentalWarning", str(cli)]
    run(["node", "--version"])
    run(command + ["--version"])
    run(["node", "-p", 'require("vitest/package.json").version'])
    daemon_log = root / "daemon.log"
    print("$ " + shlex.join(command + ["daemon", str(repo)]), flush=True)
    with daemon_log.open("w") as log:
        daemon = subprocess.Popen(command + ["daemon", str(repo)], cwd=repo, env=env,
                                  stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 45
            snapshot = None
            while time.monotonic() < deadline:
                result = run(command + ["status", "--json", "test/fast.test.js", "test/slow.test.js"],
                             verbose=False)
                if '"ended": 1' in result.stdout:
                    snapshot = result
                    break
                if daemon.poll() is not None:
                    raise AssertionError("daemon exited: " + daemon_log.read_text())
                time.sleep(0.25)
            assert snapshot is not None, "no ended=1 snapshot: " + daemon_log.read_text()
            payload, _ = json.JSONDecoder().raw_decode(snapshot.stdout)
            entries = payload["named"]["testFiles"]
            assert {entry["path"] for entry in entries} == {"test/fast.test.js", "test/slow.test.js"}
            assert all(entry["state"] == "pending" and entry["ended"] == 1
                       and "verdict" not in entry for entry in entries)
            assert (repo / "markers/slow-started").exists()
            assert not (repo / "markers/slow-ended").exists()
            print("OBSERVED: slow test started and has not ended; tier reports one file ended.", flush=True)
            print("$ " + shlex.join(command + ["status", "--json", "test/fast.test.js", "test/slow.test.js"]), flush=True)
            print(snapshot.stdout, flush=True)
            print("exit", snapshot.returncode, flush=True)
            both = run(command + ["status", "--wait", "1000", "test/fast.test.js", "test/slow.test.js"])
            assert both.returncode == 3 and "1 of them ended" in both.stdout
            fast = run(command + ["status", "--wait", "1000", "test/fast.test.js"])
            assert fast.returncode == 3 and "1 of them ended" in fast.stdout
            assert not (repo / "markers/slow-ended").exists()
            (repo / "markers/release").write_text("release")
            final = run(command + ["status", "--wait", "20000", "test/fast.test.js", "test/slow.test.js"])
            assert final.returncode == 0, final.stdout
            print("PASS: ambiguity reproduced; fast-only wait has no verdict until slow file releases the tier.", flush=True)
        finally:
            (repo / "markers/release").write_text("release")
            daemon.terminate()
            try:
                daemon.wait(timeout=15)
            except subprocess.TimeoutExpired:
                daemon.kill()
                daemon.wait(timeout=5)
            print("Daemon log:\n" + daemon_log.read_text(), flush=True)
    print("Fixture removed on exit; no product files changed.", flush=True)
