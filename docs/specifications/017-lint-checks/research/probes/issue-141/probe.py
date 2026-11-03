"""Throwaway release-bundle probe. No installs, builds, or live-store access."""
import datetime
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time

repo = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
node = shutil.which("node")
oxlint = (repo / "node_modules/oxlint").resolve(strict=True)
output = {"date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "node": subprocess.check_output([node, "--version"], text=True).strip(),
          "oxlint": json.loads((oxlint / "package.json").read_text())["version"],
          "cpus": os.cpu_count(), "load": os.getloadavg(), "runs": []}

with tempfile.TemporaryDirectory(prefix="sq141-", dir="/tmp") as temporary:
    base = Path(temporary)
    for version in ["0.1.390", "0.1.392"]:
        load = os.getloadavg()
        if load[0] > os.cpu_count():
            output["runs"].append({"version": version, "skipped": "load exceeds CPUs", "load": load})
            continue
        root = base / version
        root.mkdir()
        for name in ["home", "runtime", "config", "tmp", "project", "release"]:
            (root / name).mkdir()
        env = {"PATH": os.environ["PATH"], "HOME": str(root / "home"),
               "XDG_RUNTIME_DIR": str(root / "runtime"), "XDG_CONFIG_HOME": str(root / "config"),
               "TMPDIR": str(root / "tmp"), "LANG": "C.UTF-8"}
        project = root / "project"
        run = {"version": version, "load": load, "commands": []}
        output["runs"].append(run)

        def command(args, cwd=project, timeout=20):
            result = subprocess.run([str(a) for a in args], cwd=cwd, env=env,
                                    capture_output=True, text=True, timeout=timeout)
            run["commands"].append({"argv": [str(a) for a in args], "exit": result.returncode,
                                    "stdout": result.stdout, "stderr": result.stderr})
            return result

        tag = "squeal--v" + version
        run["commit"] = command(["git", "rev-parse", tag + "^{commit}"], repo).stdout.strip()
        archive = subprocess.check_output(["git", "archive", tag, "plugins/claude-code/dist"], cwd=repo)
        subprocess.run(["tar", "-x", "-C", str(root / "release")], input=archive, check=True)
        command(["git", "init", "-q"])
        (project / ".gitignore").write_text("node_modules/\n")
        (project / "package.json").write_text(json.dumps({"name": "issue-141", "type": "module", "private": True,
                                                        "devDependencies": {"oxlint": output["oxlint"]}}))
        (project / "squeal.config.json").write_text(json.dumps({"lint": {"enabled": True, "tools": ["oxlint"]},
                                                              "complexity": {"enabled": False},
                                                              "coverage": {"enabled": False}}))
        (project / ".oxlintrc.json").write_text(json.dumps({"rules": {"no-unused-vars": "error"}}))
        (project / "a.js").write_text("const unused = 1;\n")
        (project / "node_modules").mkdir()
        (project / "node_modules/oxlint").symlink_to(oxlint, target_is_directory=True)
        command(["git", "add", ".gitignore", "package.json", "squeal.config.json", ".oxlintrc.json", "a.js"])
        command([node, oxlint / "bin/oxlint", "--format", "json", "--threads", "1", "a.js"])
        cli = root / "release/plugins/claude-code/dist/cli/squeal.mjs"
        command([node, cli, "--version"])
        # A foreground child gives this probe ownership of its exact process group.
        daemon_log = root / "daemon.log"
        daemon = None
        try:
            with daemon_log.open("w") as log:
                daemon = subprocess.Popen([node, str(cli), "daemon", str(project)], cwd=project,
                                          env=env, stdout=log, stderr=log, start_new_session=True)
            run["daemonCommand"] = [node, str(cli), "daemon", str(project)]
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                result = command([node, cli, "status", "--json"])
                state = json.loads(result.stdout)
                lint = state.get("lint", {})
                if lint.get("off") or lint.get("failing", 0) > 0:
                    run["initial"] = state
                    break
                time.sleep(0.5)
            command([node, cli, "status", "--wait", "3000"], timeout=8)
            command([node, cli, "lint", "a.js", "--json"])
            if version == "0.1.392" and "initial" in run:
                (project / "a.js").write_text("export const used = 1;\n")
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    state = json.loads(command([node, cli, "status", "--json"]).stdout)
                    lint = state.get("lint", {})
                    if state.get("revision", 0) > 0 and lint.get("files", 0) > 0 and all(
                        lint.get(key, 0) == 0 for key in ["failing", "pending", "stale", "unknown"]
                    ):
                        run["afterFix"] = state
                        break
                    time.sleep(0.5)
                command([node, cli, "lint", "a.js", "--json"])
        finally:
            if daemon is not None:
                if daemon.poll() is None:
                    os.killpg(daemon.pid, signal.SIGTERM)
                try:
                    daemon.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(daemon.pid, signal.SIGKILL)
                    daemon.wait(timeout=5)
                run["daemonExit"] = daemon.returncode
                try:
                    os.killpg(daemon.pid, 0)
                    run["processGroupGone"] = False
                except ProcessLookupError:
                    run["processGroupGone"] = True
            run["daemonLog"] = daemon_log.read_text() if daemon_log.exists() else ""
    output["scratchRemoved"] = temporary

output["scratchRemoved"] = not Path(temporary).exists()
text = json.dumps(output, indent=2).replace(temporary, "<scratch>").replace(str(repo), "<repo>").replace(str(oxlint), "<oxlint>")
Path(__file__).with_name("results.json").write_text(text + "\n")
print(text)
