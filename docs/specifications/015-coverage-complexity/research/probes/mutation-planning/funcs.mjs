// Throwaway probe for research/mutation-planning.md (row 015-125), question 1, per changed function.
// For each row of compare.json: the PR's changed lines (cezar's own parseDiff over base..head), the named
// function around each changed line at the PR head (cezar's own ast-grep functionRanges), that function by
// name in the scratch copy's file, and the test files whose newest Squeal record shows it ran (a V8 function
// entry with a hit at its span, start line or the one before, same end line). fnTests leaves module-level
// lines out, as cezar's ignoreStatic does for static mutants. Files whose record blob is not
// the scratch copy's are left out and counted. Module-level changes ("(module)") count every loading test file.
// usage (cwd = scratch cezar): node funcs.mjs <compare.json> <index.json> <runs.txt> <cezar repo> <out.json>
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [cmpF, idxF, runsTxt, repo, out] = process.argv.slice(2);
const require = createRequire(`${process.cwd()}/`);
const { parseDiff } = require("./.github/scripts/mutants-scope.cjs");
const { functionRanges, functionOf, duplicateNames } = require("./.github/scripts/mutants-functions.cjs");
const rows = JSON.parse(readFileSync(cmpF, "utf8"));
const { index } = JSON.parse(readFileSync(idxF, "utf8"));
const runAt = new Map(readFileSync(runsTxt, "utf8").split("\n").slice(1).map((l) => l.split(" ")).map(([id, at]) => [id, at]));
const PROJECT = { cezar: "server", web: "web", contract: "contract", "api-client": "api-client" };
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", maxBuffer: 1 << 26 });
const tmp = mkdtempSync(join(tmpdir(), "funcs-"));
const rangesOf = (path, text) => { const f = join(tmp, path.endsWith(".tsx") ? "f.tsx" : "f.ts"); writeFileSync(f, text); return functionRanges(f); };

const result = [];
for (const row of rows) {
  const at = runAt.get(row.run);
  const head = git(repo, "rev-parse", row.head).trim();
  const main = git(repo, "rev-list", "-1", `--before=${at}`, "origin/main").trim();
  const base = git(repo, "merge-base", main, head).trim();
  const changed = parseDiff(git(repo, "-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-renames", "--diff-filter=AM", base, head, "--", `packages/${row.pkg}/src`));
  const tests = new Set(), fnTests = new Set();
  const r = { branch: row.branch, pkg: row.pkg, state: row.state, related: row.related, files: 0, skippedFiles: 0, functions: 0, module: 0, missing: 0, ambiguous: 0 };
  for (const [file, ranges] of changed) {
    if (!row.fileList.includes(file)) continue;
    r.files++;
    let nowText; try { nowText = readFileSync(file, "utf8"); } catch { r.skippedFiles++; continue; }
    const nowBlob = git(".", "rev-parse", `HEAD:${file}`).trim();
    const entries = (index[file] ?? []).filter((e) => e.project === PROJECT[row.pkg] && e.blob === nowBlob);
    if (!entries.length) { r.skippedFiles++; continue; }
    const thenRanges = rangesOf(file, git(repo, "show", `${head}:${file}`));
    const names = new Set();
    for (const [s, e] of ranges) for (let l = s; l <= e; l++) names.add(functionOf({ start: { line: l, column: 1 } }, thenRanges));
    const nowRanges = rangesOf(file, nowText);
    const dup = duplicateNames(nowRanges);
    for (const name of names) {
      if (name === "(module)") { r.module++; for (const e of entries) tests.add(e.test); continue; }
      if (dup.has(name)) { r.ambiguous++; for (const e of entries) if (e.called) { tests.add(e.test); fnTests.add(e.test); } continue; }
      const fn = nowRanges.find((x) => x.name === name);
      if (!fn) { r.missing++; continue; }
      r.functions++;
      const sl = fn.range.start.line + 1, el = fn.range.end.line + 1;
      for (const e of entries) {
        if (!e.functions) continue;
        if (e.functions.some(([a, , b, , hit]) => hit === 1 && b === el && (a === sl || a === sl - 1 || (a > sl && a <= sl + 1)))) { tests.add(e.test); fnTests.add(e.test); }
      }
    }
  }
  r.ranTests = tests.size;
  r.fnTests = fnTests.size;
  r.covering = row.covering ?? null;
  result.push(r);
}
rmSync(tmp, { recursive: true, force: true });
writeFileSync(out, JSON.stringify(result, null, 1));
console.log("branch\tpkg\tstate\trelated(then)\tfiles\tskipped\tfunctions\tmodule\tmissing\tambiguous\tran-tests");
for (const r of result) console.log([r.branch.slice(0, 28), r.pkg, r.state, r.related, r.files, r.skippedFiles, r.functions, r.module, r.missing, r.ambiguous, r.ranTests, r.fnTests, r.covering ?? "-"].join("\t"));
