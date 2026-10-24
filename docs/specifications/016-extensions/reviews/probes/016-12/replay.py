#!/usr/bin/env python3
"""Replay reviewer probes against the pinned candidate. Requires installed dependencies.

Run from the repository root: python3 <this-file>. Product changes stay in a scratch copy.
"""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

candidate = "d975d2b0d14d141255b0145877ca3fd536cf688a"
repo = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
source = Path(__file__).resolve().parent
root = Path(tempfile.mkdtemp(prefix="squeal-review-016-12-"))
logs = root.parent / (root.name + "-logs")
logs.mkdir()
print("scratch:", root, "logs:", logs, flush=True)
archive = subprocess.Popen(["git", "archive", candidate], cwd=repo, stdout=subprocess.PIPE)
subprocess.run(["tar", "-x", "-C", str(root)], stdin=archive.stdout, check=True)
archive.stdout.close()
assert archive.wait() == 0
os.symlink((repo / "node_modules").resolve(), root / "node_modules")
for name in ["key-probe.ts", "known-probe.ts", "observations-probe.ts"]:
 shutil.copy2(source / name, root / name)
for name in ["key-probe.ts", "known-probe.ts", "observations-probe.ts"]:
 result = subprocess.run(["node", "--import", "tsx", name], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
 (logs / (name + ".log")).write_text(result.stdout)
 print(name, "exit", result.returncode, result.stdout, flush=True)
 assert result.returncode == 0
result = subprocess.run(["npx", "vitest", "run", "test/kit", "--maxWorkers=2"], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
(logs / "kit-baseline.log").write_text(result.stdout)
print("kit baseline exit", result.returncode, result.stdout, flush=True)
assert result.returncode == 0
mutations = [
 ("node-stale", "src/runners/node-test/adapter-project.ts", "  let probe: NodeProbe = firstProbe;", "  let firstReport: RunReport | null = null;\n  let probe: NodeProbe = firstProbe;", "      if (preloaded.length === 0) return report;", "      if (preloaded.length === 0) return firstReport ??= report;", "test/kit/node-test.test.ts"),
 ("vitest-stale", "src/runners/vitest/adapter.ts", "  run(testFiles: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {", "  #reviewReplay: Promise<RunReport> | null = null;\n  run(testFiles: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {\n    return this.#reviewReplay ??= this.#reviewRealRun(testFiles, options);\n  }\n  #reviewRealRun(testFiles: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {", None, None, "test/kit/vitest.test.ts"),
 ("pytest-shared-log", "src/runners/pytest/run/run.ts", "  const started = performance.now();", "  options = { ...options, logDir: join(options.cacheDir ?? tmpdir(), \"review-shared-log\") };\n  const started = performance.now();", None, None, "test/kit/pytest.test.ts"),
 ("named-driver", "test/kit/driver.ts", "import { mkdirSync", "// pytest\nimport { mkdirSync", None, None, "test/kit/driver.test.ts"),
]
for name, rel, before, after, before2, after2, test in mutations:
 path = root / rel
 original = path.read_text()
 assert original.count(before) == 1, (name, before)
 edited = original.replace(before, after)
 if before2:
  assert edited.count(before2) == 1
  edited = edited.replace(before2, after2)
 try:
  path.write_text(edited)
  result = subprocess.run(["npx", "vitest", "run", test, "--maxWorkers=1"], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
  (logs / (name+".log")).write_text(result.stdout)
  print(name, "exit", result.returncode, flush=True)
  assert result.returncode == 1, (name, result.stdout)
  print("\n".join(line for line in result.stdout.splitlines() if any(s in line for s in ["Test Files", "Tests ", "FAIL step", " × ", " ↓ "])), flush=True)
 finally:
  path.write_text(original)

print("Product mutations restored. Remove the printed scratch and log directories after review.")
