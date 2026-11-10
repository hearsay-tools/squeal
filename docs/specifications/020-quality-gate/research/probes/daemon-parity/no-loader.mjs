// Throwaway probe (survey 020-07, Q4). Read-only: opens this repository's
// Squeal stores with node:sqlite { readOnly: true } and writes nothing.
// Usage: node no-loader.mjs <common-dir> <worktree-id>
// Counts the counted sources of one worktree that no listed test file's
// closure loads (015 D9's "no loader" case), their functions and their
// stored crap/uncovered states: what 020-07's "no loader reads unknown"
// would change.
import { DatabaseSync } from "node:sqlite";

const [commonDir, worktreeId] = process.argv.slice(2);
const code = new DatabaseSync(`${commonDir}/squeal/code.sqlite`, { readOnly: true });
const main = new DatabaseSync(`${commonDir}/squeal/store.sqlite`, { readOnly: true });

// The test files this worktree lists, and the newest closure any worktree stored for each.
const listed = main
  .prepare(
    `select k.project, k.path, t.closure_paths from test_file_keys k
     left join test_files t on t.project = k.project and t.path = k.path
     where k.worktree_id = ?`,
  )
  .all(worktreeId);
const loaded = new Map();
let unknownClosure = 0;
for (const row of listed) {
  if (row.closure_paths === null) {
    unknownClosure++;
    continue;
  }
  for (const p of JSON.parse(row.closure_paths)) {
    if (p === row.path) continue; // loaders.ts: a test file is not its own loader
    loaded.set(p, (loaded.get(p) ?? 0) + 1);
  }
}
const testPaths = new Set(listed.map((r) => r.path));

const files = code
  .prepare(`select path, language, too_big from files where worktree_id = ?`)
  .all(worktreeId);
const statesOf = code.prepare(
  `select c.path, c.qualified_name, s.measure, s.outcome, s.value from states s
   join checks c on c.id = s.check_id where s.worktree_id = ? and c.path = ?`,
);
const out = {
  worktreeId,
  listedTestFiles: listed.length,
  testFilesWithoutClosure: unknownClosure,
  countedFiles: files.length,
  countedTestFiles: files.filter((f) => testPaths.has(f.path)).length,
  noLoader: { files: 0, byLanguage: {}, functions: 0, crap: {}, uncovered: {} },
  examples: [],
};
// This repository's coverage.exclude (squeal.config.json), as prefixes.
const EXCLUDED = ["test/", "src/runners/node-test/runtime/", "src/runners/vitest/ci-runtime/"];
out.noLoader.excludedFiles = 0;
out.noLoader.judgedFunctionsOutsideExclude = 0;
for (const f of files) {
  if (loaded.has(f.path)) continue;
  if (EXCLUDED.some((p) => f.path.startsWith(p))) {
    out.noLoader.excludedFiles++;
  } else {
    const n = statesOf.all(worktreeId, f.path).filter((s) => s.measure === "complexity").length;
    out.noLoader.judgedFunctionsOutsideExclude += n;
    if (n > 0) out.examples.push({ path: f.path, language: f.language, functions: n });
  }
  const states = statesOf.all(worktreeId, f.path);
  const fns = new Set(states.map((s) => s.qualified_name + "\0"));
  const nl = out.noLoader;
  nl.files++;
  nl.byLanguage[f.language] = (nl.byLanguage[f.language] ?? 0) + 1;
  nl.functions += states.filter((s) => s.measure === "complexity").length;
  for (const s of states) {
    if (s.measure === "crap") nl.crap[s.outcome] = (nl.crap[s.outcome] ?? 0) + 1;
    if (s.measure === "uncovered") nl.uncovered[s.outcome] = (nl.uncovered[s.outcome] ?? 0) + 1;
  }
}
console.log(JSON.stringify(out, null, 2));
