"""Throwaway store inventory and E1-style counterexamples. Run through run.sh."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import sqlite3
import subprocess
import sys
import time

source, cezar_source, base = map(Path, sys.argv[1:4])
mode = sys.argv[4] if len(sys.argv) > 4 else "all"
assert mode in ("all", "fixture")
clone = base / "squeal"
fixture = base / "fixture"


def command(args, cwd=clone, **kwargs):
    return subprocess.run(args, cwd=cwd, text=True, capture_output=True,
                          check=True, timeout=90, **kwargs).stdout.strip()


def emit(label, value):
    print(json.dumps({"label": label, "value": value}, sort_keys=True), flush=True)


def load():
    return float(Path("/proc/loadavg").read_text().split()[0])


def write(root, name, text):
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)


def ignored(root, paths):
    if not paths:
        return set()
    result = subprocess.run(["git", "check-ignore", "--no-index", "-z", "--stdin"],
                            cwd=root, input="\0".join(paths) + "\0", text=True,
                            capture_output=True, timeout=30)
    if result.returncode in (0, 1):
        return set(result.stdout.strip("\0").split("\0")) - {""}
    if len(paths) == 1:
        emit("ignore-refused", paths)
        return set()
    middle = len(paths) // 2
    return ignored(root, paths[:middle]) | ignored(root, paths[middle:])


def inventory(name, live):
    start, before = time.monotonic(), load()
    gitdir = Path(command(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], live))
    copied = base / (name + "-store-copy")
    copied.mkdir()
    # Copy DB, WAL and SHM as bytes. Only the private copy is opened by SQLite.
    for suffix in ("", "-wal", "-shm"):
        src = gitdir / "squeal" / ("store.sqlite" + suffix)
        if src.exists():
            command(["cp", "--reflink=auto", str(src), str(copied / src.name)])
    with sqlite3.connect(copied / "store.sqlite") as db:
        emit(name + "-quick-check", db.execute("PRAGMA quick_check").fetchone()[0])
        emit(name + "-schema", {table: [row[1] for row in db.execute(f"PRAGMA table_info({table})")]
             for table in ("meta", "revisions", "test_file_keys", "results")})
        rows = db.execute("SELECT key, value FROM meta WHERE key LIKE 'observed.%'").fetchall()
        readers = {}
        for key, raw in rows:
            for test, paths in json.loads(raw).items():
                for path in paths:
                    readers.setdefault(path, set()).add(key + ":" + test)
        # A listing path ends in '/', per listingPath in Squeal.
        paths = sorted(readers)
        # Main checkouts have local ignore files absent from a clean clone (notably .ai/cezar).
        # Copy only ignore rules, never the runtime state below them.
        checkout = gitdir.parent
        target = base / name
        exclude = gitdir / "info/exclude"
        if exclude.exists():
            shutil.copyfile(exclude, target / ".git/info/exclude")
        rulefiles = {Path(".gitignore")}
        for path in paths:
            if Path(path).is_absolute() or ".." in Path(path).parts:
                continue
            for parent in Path(path).parents:
                rulefiles.add(parent / ".gitignore")
        for rel in sorted(rulefiles):
            origin, dest = checkout / rel, target / rel
            if origin.is_file() and dest.resolve().is_relative_to(target):
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(origin, dest)
        emit(name + "-ignore-source", command(["git", "rev-parse", "HEAD"], checkout))
        kept = ignored(base / name, paths)
        data = [{"path": path, "readers": len(readers[path])} for path in sorted(kept)]
        emit(name + "-observed-ignored", data)
        emit(name + "-observed-meta-fields", "test path -> path array; no writer, read order, or run id")
        columns = [row[1] for row in db.execute("PRAGMA table_info(revisions)")]
        # Print the column names first; the extractor below is tied to this schema.
        if "changes" in columns:
            counts = {path: 0 for path in kept}
            lockfiles = ["node_modules/.package-lock.json", "node_modules/.pnpm/lock.yaml"]
            counts.update({path: 0 for path in lockfiles})
            alone = {path: 0 for path in counts}
            times = {path: [] for path in counts}
            for raw, at in db.execute("SELECT changes, created_at FROM revisions"):
                changes = json.loads(raw)
                changed = [p if isinstance(p, str) else p["path"] for p in changes]
                for path in changed:
                    if path in counts:
                        counts[path] += 1
                        alone[path] += len(changed) == 1
                        times[path].append(at)
            emit(name + "-revision-counts", {p: {"all": n, "alone": alone[p],
                 "first_ms": min(times[p]), "last_ms": max(times[p])}
                 for p, n in counts.items() if n})
    emit(name + "-inventory-timing", {"seconds": round(time.monotonic() - start, 3),
         "load1_before": before, "load1_after": load()})


emit("versions", {"squeal": command(["git", "rev-parse", "HEAD"]),
     "cezar": command(["git", "rev-parse", "HEAD"], base / "cezar"),
     "node": command(["node", "--version"]),
     "vitest": json.loads((source / "node_modules/vitest/package.json").read_text())["version"],
     "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
if mode == "all":
    for name, live in (("cezar", cezar_source), ("squeal", source)):
        inventory(name, live)

# Build and clone a tiny repository. No real browser or application server starts.
seed = base / "seed"
seed.mkdir()
write(seed, ".gitignore", ".ai/qa/\nnode_modules\npackages/cezar/web/dist/\n.cache/\n")
write(seed, "package.json", '{"type":"module","private":true}')
write(seed, "src/app.txt", "GOOD")
write(seed, "squeal.config.json", json.dumps({"inputs": {
    "test/declared.test.mjs": [".ai/qa/declared.json"]}}))
write(seed, "setup.mjs", """
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
export default function setup() {
  if (process.env.SKIP_SETUP === '1') return;
  fs.mkdirSync('.ai/qa/build', {recursive:true});
  fs.mkdirSync('packages/cezar/web/dist', {recursive:true});
  const nonce = String(process.pid) + '-' + Date.now();
  // Same Node producer, same order, same JSON shape. One is state, one is tested output.
  fs.writeFileSync('.ai/qa/node-state.json', JSON.stringify({pid:process.pid, nonce}));
  fs.writeFileSync('.ai/qa/node-build.json', JSON.stringify({pid:process.pid, nonce}));
  execFileSync('sh', ['writer.sh', nonce]);
}
""")
write(seed, "writer.sh", """set -eu
printf '{"pid":%s,"startedAt":"%s"}\\n' "$$" "$1" > .ai/qa/test-env.json
printf 'GOOD:%s\\n' "$1" > .ai/qa/build/out.txt
printf '<html>GOOD:%s</html>\\n' "$1" > packages/cezar/web/dist/index.html
printf '{"value":"GOOD","nonce":"%s"}\\n' "$1" > .ai/qa/declared.json
node -e 'const fs = require("node:fs"); const value = JSON.stringify({pid:process.pid, nonce:process.argv[1]}); for (const p of ["shell-node-state", "shell-node-build"]) fs.writeFileSync(".ai/qa/" + p + ".json", value)' "$1"
""")
tests = {
    "e2e/a.test.mjs": "expect(JSON.parse(readFileSync('.ai/qa/test-env.json','utf8')).pid).toBeGreaterThan(0)",
    "e2e/b.test.mjs": "expect(JSON.parse(readFileSync('.ai/qa/test-env.json','utf8')).startedAt).toBeTruthy()",
    "e2e/c.test.mjs": "expect(readFileSync('.ai/qa/build/out.txt','utf8')).toMatch(/^GOOD:/)",
    "e2e/d.test.mjs": "expect(1).toBe(1)",
    "test/html.test.mjs": "expect(readFileSync('packages/cezar/web/dist/index.html','utf8')).toContain('GOOD')",
    "test/declared.test.mjs": "expect(JSON.parse(readFileSync('.ai/qa/declared.json','utf8')).value).toBe('GOOD')",
    "test/node.test.mjs": "expect(JSON.parse(readFileSync('.ai/qa/node-state.json','utf8')).pid).toBeGreaterThan(0); expect(JSON.parse(readFileSync('.ai/qa/node-build.json','utf8')).pid).toBeGreaterThan(0)",
    "test/shell-node.test.mjs": "expect(JSON.parse(readFileSync('.ai/qa/shell-node-state.json','utf8')).pid).toBeGreaterThan(0); expect(JSON.parse(readFileSync('.ai/qa/shell-node-build.json','utf8')).pid).toBeGreaterThan(0)",
}
for path, body in tests.items():
    write(seed, path, "import {test,expect} from 'vitest'; import {readFileSync} from 'node:fs';\ntest('input',()=>{" + body + "});\n")
write(seed, "vitest.config.mjs", """
export default {cacheDir:'.cache', test:{globalSetup:'./setup.mjs',
  include:['e2e/*.test.mjs','test/*.test.mjs'], maxWorkers:1, fileParallelism:false,
  env: process.env.WORKER_RECORDER ? {NODE_OPTIONS:process.env.WORKER_RECORDER,
    SQUEAL_OBSERVE:process.env.WORKER_SETTINGS} : {}}};
""")
command(["git", "init", "-q"], seed)
command(["git", "add", "."], seed)
command(["git", "-c", "user.name=probe", "-c", "user.email=probe@localhost", "commit", "-qm", "fixture"], seed)
command(["git", "clone", "--quiet", str(seed), str(fixture)])
(fixture / "node_modules").symlink_to(source / "node_modules", target_is_directory=True)
recorder = clone / "src/runners/observe/recorder.cjs"
targets = [".ai/qa/test-env.json", ".ai/qa/build/out.txt", "packages/cezar/web/dist/index.html",
           ".ai/qa/declared.json", ".ai/qa/node-state.json", ".ai/qa/node-build.json",
           ".ai/qa/shell-node-state.json", ".ai/qa/shell-node-build.json"]


def run(label, main=False, selected=(), skip=False, trace=False, expect_failure=False):
    out = base / (label + "-records")
    out.mkdir()
    env = dict(os.environ)
    settings = json.dumps({"out": str(out), "root": str(fixture), "skip": []})
    env.update(WORKER_RECORDER="--require=" + str(recorder), WORKER_SETTINGS=settings)
    if main:
        # Supplying an explicit attribution proves the hook can record Node globalSetup writes.
        env.update(NODE_OPTIONS="--require=" + str(recorder),
                   SQUEAL_OBSERVE=json.dumps({"out": str(out), "root": str(fixture),
                                             "file": "GLOBAL_SETUP", "skip": []}))
    if skip:
        env["SKIP_SETUP"] = "1"
    args = ["node", str(source / "node_modules/vitest/vitest.mjs"), "run", *selected]
    tracepath = base / (label + ".strace")
    if trace:
        args = ["strace", "-f", "-qq", "-ttt", "-s", "200", "-e", "trace=openat",
                "-o", str(tracepath), *args]
    start, before = time.monotonic(), load()
    child = subprocess.Popen(args, cwd=fixture, env=env, text=True,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = child.communicate(timeout=90)
    except BaseException:
        # Signal only the private process group this probe just started.
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.communicate()
        raise
    emit(label + "-run", {"exit": child.returncode, "seconds": round(time.monotonic()-start, 3),
         "load1_before": before, "load1_after": load(),
         "summary": [re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
                     for line in stdout.splitlines() if "Test Files" in line or "Tests " in line]})
    if child.returncode != (1 if expect_failure else 0):
        raise RuntimeError(stdout + stderr)
    records = {}
    for file in out.glob("*.ndjson"):
        for line in file.read_text().splitlines():
            row = json.loads(line)
            test = row["t"].removeprefix(str(fixture) + "/")
            sets = records.setdefault(test, {"f": set(), "w": set()})
            for kind in sets:
                sets[kind].update(p.removeprefix(str(fixture) + "/") for p in row.get(kind, []))
    emit(label + "-records", {test: {kind: sorted(paths & set(targets)) for kind, paths in sets.items()}
         for test, sets in records.items() if any(paths & set(targets) for paths in sets.values())})
    hashes = {path: hashlib.sha256((fixture/path).read_bytes()).hexdigest() for path in targets}
    emit(label + "-hashes", hashes)
    if trace:
        lines = [line for line in tracepath.read_text().splitlines() if any(p in line for p in targets)]
        emit(label + "-syscalls", [line.replace(str(fixture), "<fixture>") for line in lines])
    status = command(["git", "status", "--porcelain"], fixture)
    emit(label + "-git-status", status)
    assert status == "", status
    return hashes


one = run("worker-only")
repeat = run("worker-only-repeat")
emit("changed-with-no-source-edit", [p for p in targets if one[p] != repeat[p]])
two = run("main-hook-and-native-trace", main=True, trace=True)
three = run("hand-run-d", selected=("e2e/d.test.mjs",))
emit("hand-run-changed", [p for p in targets if two[p] != three[p]])
# Each real ignored input changes verdict when only it changes after setup.
for path, test in ((targets[1], "e2e/c.test.mjs"), (targets[2], "test/html.test.mjs"),
                   (targets[3], "test/declared.test.mjs")):
    old = (fixture/path).read_text()
    (fixture/path).write_text(old.replace("GOOD", "BAD"))
    run("bad-" + Path(test).stem, selected=(test,), skip=True, expect_failure=True)
    (fixture/path).write_text(old)
node_build = fixture / ".ai/qa/node-build.json"
data = json.loads(node_build.read_text())
data["pid"] = 0
node_build.write_text(json.dumps(data))
run("bad-node-build", selected=("test/node.test.mjs",), skip=True, expect_failure=True)
shell_build = fixture / ".ai/qa/shell-node-build.json"
data = json.loads(shell_build.read_text())
data["pid"] = 0
shell_build.write_text(json.dumps(data))
run("bad-shell-node-build", selected=("test/shell-node.test.mjs",), skip=True, expect_failure=True)
emit("finished", "All children exited; wrapper removes both clones, fixture, traces and store copies.")
