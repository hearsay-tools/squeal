// Probe only: Squeal's static pytest graph (src/runners/pytest/graph) on a PEP 582 project, from files.
// Usage: tsx graph-probe.ts <root> <cwd> <mode: none|lib-as-pythonpath|lib-as-env> [lib] [testglob-rel-to-cwd...]
import { mkdtempSync, mkdirSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createPytestGraph } from "../../../../../../src/runners/pytest/graph/index.js";

const [root, cwd, mode, lib] = process.argv.slice(2) as [string, string, string, string | undefined];
const isTest = (n: string) => /^test_.*\.py$|^tests\.py$|_tests\.py$/.test(n);
const files: string[] = [];
const walkDir = (d: string) => {
  for (const n of readdirSync(d)) {
    if (["__pypackages__", "node_modules", ".git", ".venv", ".ai"].includes(n)) continue;
    const p = join(d, n);
    const s = statSync(p, { throwIfNoEntry: false });
    if (s?.isDirectory()) walkDir(p);
    else if (isTest(n)) files.push(relative(root, p));
  }
};
walkDir(cwd);
files.sort();
let env: string | null = null;
let pythonpath: string[] = [];
if (mode === "lib-as-pythonpath" && lib) pythonpath = [lib];
if (mode === "lib-as-env" && lib) {
  // A venv-shaped stand-in pointing at lib, outside the worktree: pyvenv.cfg + lib/pythonX.Y/site-packages -> lib.
  const v = lib.split("/").at(-2) as string;
  env = mkdtempSync(join(tmpdir(), "pep582-env-"));
  writeFileSync(join(env, "pyvenv.cfg"), `home = /nonexistent/bin\nversion_info = ${v}\n`);
  mkdirSync(join(env, "lib", `python${v}`), { recursive: true });
  symlinkSync(lib, join(env, "lib", `python${v}`, "site-packages"));
}
const t0 = performance.now();
const graph = await createPytestGraph({ root, cwd, env, testFiles: files, pythonpath });
const ms = Math.round(performance.now() - t0);
let total = 0, pyp = 0, max = 0;
for (const f of files) {
  const c = graph.closure(f);
  const paths = c.paths ?? [];
  total += paths.length;
  max = Math.max(max, paths.length);
  pyp += paths.filter((p: string) => p.includes("__pypackages__")).length;
}
const sp = graph.searchPath();
console.log(JSON.stringify({ mode, testFiles: files.length, buildMs: ms, closurePathsMean: +(total / Math.max(1, files.length)).toFixed(1), closurePathsMax: max, underPypackages: pyp, incomplete: graph.incompleteClosures().length, source: sp.source, notes: graph.notes() }));
