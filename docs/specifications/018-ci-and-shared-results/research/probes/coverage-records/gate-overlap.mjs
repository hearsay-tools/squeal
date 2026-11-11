// Throwaway probe for research/coverage-records.md, question 3: could a
// record imported with a main commit's export serve a file the gate selected?
// A gate-selected file loads a changed path (020 D3.1). Its key here holds
// that path's blob in the worktree. The export's key holds the blob at the
// export's commit. Where they differ, no re-key can make the keys equal.
//
// Usage: node gate-overlap.mjs <gate report .json> <export .json.gz> <ls-tree file>
// <ls-tree file>: `git ls-tree -r <export commit>` output (mode type blob\tpath).
// Reads only.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [reportPath, exportPath, treePath] = process.argv.slice(2);
const text = readFileSync(reportPath, "utf8");
const report = JSON.parse(text.slice(text.indexOf("{")));
const exp = JSON.parse(gunzipSync(readFileSync(exportPath)).toString("utf8"));
const atExport = new Map();
for (const line of readFileSync(treePath, "utf8").split("\n")) {
  const m = /^\d+ blob ([0-9a-f]+)\t(.*)$/.exec(line);
  if (m) atExport.set(m[2], m[1]);
}
console.log(`gate base ${report.base.commit.slice(0, 8)}, head ${report.head.commit.slice(0, 8)}, export ${exp.header.commit.slice(0, 8)}`);
// Changed paths as the gate saw them, with their blob in the worktree.
const changed = new Map(report.head.paths.map((p) => [p.path, p.blob ?? null]));
const differs = [...changed].filter(([path, blob]) => atExport.get(path) !== blob).map(([p]) => p);
console.log(`changed paths in the report: ${changed.size}; with another blob at the export commit: ${differs.length}`);
const byPath = new Map(exp.testFiles.map((f) => [f.path, f]));
for (const run of report.runs) {
  let inExport = 0;
  let holdsDiffering = 0;
  let couldMatch = 0;
  for (const path of run.selected) {
    const file = byPath.get(path);
    if (!file) continue;
    inExport++;
    const closure = new Set(file.closure?.paths ?? []);
    if (differs.some((p) => closure.has(p))) holdsDiffering++;
    else couldMatch++;
  }
  const from = {};
  for (const v of Object.values(run.from ?? {})) from[v] = (from[v] ?? 0) + 1;
  console.log(
    `${run.runner}: selected ${run.selected.length}, in the export ${inExport}; their exported closure holds a path whose blob differs: ${holdsDiffering}; could match an imported key: ${couldMatch}; from: ${JSON.stringify(from)}; durationMs ${run.durationMs}`,
  );
}
