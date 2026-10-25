"""Replay the round-3 retained-producer failure and its same-runner control.

Run from a checkout with node_modules installed. Uses no daemon or full suite.
The candidate case must exit 1. The same-runner control must exit 0.
"""
import io
from pathlib import Path
import subprocess
import tarfile
import tempfile

REPO = Path.cwd()
HERE = Path(__file__).resolve().parent
SHA = "83afbf1d8b1d77c71bc8919ab6a4fd5c5e629b2c"
TREE = Path(tempfile.mkdtemp(prefix="squeal-review-0.1.306-"))
with tarfile.open(fileobj=io.BytesIO(subprocess.check_output(["git", "archive", SHA]))) as archive:
    archive.extractall(TREE, filter="data")
(TREE / "node_modules").symlink_to(REPO / "node_modules", target_is_directory=True)
p = TREE / "test/scheduler/check-runner.test.ts"
original = p.read_text()
probe = (HERE / "r3-retained.txt").read_text()
command = [str(TREE / "node_modules/.bin/vitest"), "run", "test/scheduler/check-runner.test.ts", "--maxWorkers=1", "-t", "review probe"]
for name, text, expected in [
    ("candidate", probe, 1),
    ("same-runner-control", probe.replace(
        "asVitest(side);",
        'const read = side.runner.environment;\n    side.runner.environment = async () => (await read()).map(e => ({ ...e, runnerName: "pytest" }));',
    ).replace('.get("")).toBe("vitest")', '.get("")).toBe("pytest")'), 0),
]:
    p.write_text(original + "\n" + text)
    result = subprocess.run(command, cwd=TREE, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (TREE / (name + ".log")).write_text(result.stdout)
    print(result.stdout, end="")
    print(f"{name}: exit {result.returncode}, expected {expected}")
    if result.returncode != expected:
        raise SystemExit(f"Unexpected probe exit; scratch: {TREE}")
print(f"All expected exits matched; scratch: {TREE}")
