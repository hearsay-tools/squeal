"""Throwaway issue-124 probe. Runs only freshly created synthetic worktrees."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid

NODE = "/home/agent/.nvm/versions/node/v24.22.1/bin/node"
RUNTIME = Path("/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.374")
CLI = RUNTIME / "dist/cli/squeal.mjs"
load = os.getloadavg()[0]
cpus = os.cpu_count()
print(json.dumps({"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                  "load1": load, "cpus": cpus}), flush=True)
if load > cpus:
    raise SystemExit("SKIPPED: one-minute load exceeds CPU count")

base = Path(tempfile.mkdtemp(prefix="squeal-issue-124-"))
parent = base / "parent"
children = [base / "child-unheld", base / "child-preheld"]
runtime_dir = base / "runtime"
runtime_dir.mkdir(mode=0o700)
env = {k: v for k, v in os.environ.items()
       if not k.startswith(("SQUEAL_", "CEZ_", "PLUGIN_"))}
env["XDG_RUNTIME_DIR"] = str(runtime_dir)
sessions = {}


def run(args, cwd, stdin=None, check=True):
    args = list(map(str, args))
    print(json.dumps({"cwd": str(cwd), "argv": args, "stdin": stdin}), flush=True)
    result = subprocess.run(args, cwd=cwd, env=env, input=stdin, text=True,
                            capture_output=True, timeout=110)
    print(json.dumps({"exit": result.returncode, "stdout": result.stdout,
                      "stderr": result.stderr}), flush=True)
    if check and result.returncode:
        raise RuntimeError(f"Command failed: {args}")
    return result


def cli(root, *args):
    return run([NODE, "--disable-warning=ExperimentalWarning", CLI, *args], root)


def hook(root, name="session-start"):
    session = sessions.setdefault(root, str(uuid.uuid4()))
    event = {"session-start": "SessionStart", "post-tool-use": "PostToolUse",
             "session-end": "SessionEnd"}[name]
    data = {"session_id": session, "cwd": str(root), "hook_event_name": event}
    if name == "session-start":
        data["source"] = "startup"
    return run([NODE, "--disable-warning=ExperimentalWarning", RUNTIME / "dist" / f"{name}.mjs"],
               root, json.dumps(data))


def status(root):
    return json.loads(cli(root, "status", "--json").stdout)


try:
    parent.mkdir()
    run(["git", "init", "-q"], parent)
    (parent / ".gitignore").write_text("ran.txt\nnode_modules/\n")
    (parent / "package.json").write_text('{"name":"issue-124-probe","private":true,"type":"module"}\n')
    (parent / "squeal.config.json").write_text(json.dumps({
        "nodeTest": [{"name": "probe", "include": ["smoke.test.mjs"]}],
        "complexity": {"enabled": False}, "lint": {"enabled": False}}) + "\n")
    (parent / "smoke.test.mjs").write_text(
        "import test from 'node:test';\nimport assert from 'node:assert/strict';\n"
        "import { appendFileSync } from 'node:fs';\n"
        "test('harmless arithmetic', () => { appendFileSync('ran.txt', 'ran\\n'); assert.equal(2 + 2, 4); });\n")
    run(["git", "add", ".gitignore", "package.json", "squeal.config.json", "smoke.test.mjs"], parent)
    run(["git", "-c", "user.name=Probe", "-c", "user.email=probe@example.invalid",
         "commit", "-qm", "synthetic fixture"], parent)
    cli(parent, "--version")
    cli(parent, "stop", "--until-start", parent)
    hook(parent)
    status(parent)

    for child in children:
        run(["git", "worktree", "add", "--detach", str(child), "HEAD"], parent)

    unheld, preheld = children
    hook(unheld)
    deadline = time.monotonic() + 35
    while not (unheld / "ran.txt").exists() and time.monotonic() < deadline:
        time.sleep(0.25)
    unheld_status = status(unheld)
    unheld_ran = (unheld / "ran.txt").exists()
    cli(unheld, "stop", "--until-start", unheld)

    cli(preheld, "stop", "--until-start", preheld)
    hook(preheld)
    status(preheld)
    for root in [parent, preheld]:
        (root / "edit.txt").write_text("harmless edit after hold\n")
        run(["git", "add", "edit.txt"], root)
        run(["git", "-c", "user.name=Probe", "-c", "user.email=probe@example.invalid",
             "commit", "-qm", "edit while held"], root)
        hook(root, "post-tool-use")
    time.sleep(2)
    parent_status = status(parent)
    preheld_status = status(preheld)
    verdict = {"unheld_child_executed_test": unheld_ran,
               "parent_executed_test": (parent / "ran.txt").exists(),
               "preheld_child_executed_test": (preheld / "ran.txt").exists(),
               "parent_daemon": parent_status.get("daemon"),
               "unheld_daemon_before_stop": unheld_status.get("daemon"),
               "preheld_child_daemon": preheld_status.get("daemon")}
    print("VERDICT " + json.dumps(verdict), flush=True)
    assert unheld_ran, "Unheld child did not execute within 35 seconds; inspect log"
    for root, snapshot in [(parent, parent_status), (preheld, preheld_status)]:
        assert not (root / "ran.txt").exists(), f"Held root ran: {root}"
        assert snapshot["daemon"]["untilStart"] is True
        assert snapshot["daemon"]["state"] == "down"
finally:
    # Never delete a root before its stop succeeds. Retain on cleanup failure.
    for root in [*children, parent]:
        if (root / ".git").exists():
            if root in sessions:
                hook(root, "session-end")
            cli(root, "stop", "--until-start", root)
    for child in children:
        if child.exists():
            run(["git", "worktree", "remove", "--force", str(child)], parent)
    shutil.rmtree(base)
    print("CLEANUP removed synthetic worktrees, store and runtime directory: " + str(base), flush=True)
