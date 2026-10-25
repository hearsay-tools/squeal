"""Reproduce review 0.1.303 in archives. No daemon and no full suite.

Run from a repository checkout with node_modules installed. The two failed
collision tests, the rejected-cut assertion and three failed preload forms are the expected evidence.
"""

import io
from pathlib import Path
import subprocess
import tarfile
import tempfile


CANDIDATE = "1a208e9c065fd024a266d76ad2154f8f40a8b1fa"
BASELINE = "9584ce6f1f20c672b0599593c96f3f3d411f4d6d"
REPO = Path.cwd()
HERE = Path(__file__).resolve().parent
WORK = Path(tempfile.mkdtemp(prefix="squeal-review-0.1.303-"))
TREE = WORK / "candidate"


def archive(revision, destination, paths=()):
    data = subprocess.check_output(["git", "archive", revision, *paths], cwd=REPO)
    destination.mkdir()
    with tarfile.open(fileobj=io.BytesIO(data)) as bundle:
        bundle.extractall(destination, filter="data")
    (destination / "node_modules").symlink_to(REPO / "node_modules", target_is_directory=True)


def run(name, argv, expected=0):
    result = subprocess.run(argv, cwd=TREE, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (WORK / (name + ".log")).write_text(result.stdout)
    print("\n$", " ".join(map(str, argv)), flush=True)
    print(result.stdout, end="", flush=True)
    print(f"{name}: exit {result.returncode} (expected {expected})", flush=True)
    if result.returncode != expected:
        raise RuntimeError(f"Unexpected exit from {name}; logs: {WORK}")


archive(CANDIDATE, TREE)
archive(BASELINE, WORK / "old", ("src", "package.json"))
print(f"Scratch: {WORK}", flush=True)
for name in ("key-probe", "store-probe", "descriptions-probe", "cut-probe"):
    (TREE / (name + ".ts")).write_text((HERE / (name + ".txt")).read_text())
run("store", [str(TREE / "node_modules/.bin/tsx"), "store-probe.ts"])
run("descriptions", [str(TREE / "node_modules/.bin/tsx"), "descriptions-probe.ts"])
run("keys", [str(TREE / "node_modules/.bin/tsx"), "key-probe.ts"])
run("cut-precondition", [str(TREE / "node_modules/.bin/tsx"), "cut-probe.ts"], expected=1)

test = TREE / "test/delivery/dependencies-runner.test.ts"
original = test.read_text()
test.write_text(original + "\n" + (HERE / "runner-collision.txt").read_text())
command = [str(TREE / "node_modules/.bin/vitest"), "run", "test/delivery/dependencies-runner.test.ts", "--maxWorkers=1", "-t", "review probe"]
run("collision", command, expected=1)
test.write_text(test.read_text().replace(
    'from "../../src/core/delivery/index.js"',
    f'from "{WORK}/old/src/core/delivery/index.ts"',
))
run("old-delivery-control", command)
test.write_text(original)

source = TREE / "src/runners/node-test/adapter-observed.ts"
original = source.read_text()
before = "for (const path of preloadPaths) if (!preloadStatic.has(path)) preloads.add(path);"
if before not in original:
    raise RuntimeError("Preload replay no longer applies")
source.write_text(original.replace(before, "for (const path of preloadPaths) if (preloadStatic.size < 0) preloads.add(path);"))
command = [str(TREE / "node_modules/.bin/vitest"), "run", "test/kit/node-test.test.ts", "--maxWorkers=1"]
run("preload-replay", command, expected=1)
source.write_text(original)
run("kit-control", command)
print(f"\nAll probe exits matched. Scratch and logs retained: {WORK}", flush=True)
