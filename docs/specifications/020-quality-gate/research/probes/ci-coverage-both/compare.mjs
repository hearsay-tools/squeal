// Throwaway. Usage: node compare.mjs <outDir of run.sh>
// Prints, per run group: exit codes, whether the tee run's project report equals
// the plain run's, the files in each report, and per test file the record (by its
// parts) or why none, for tee and squeal.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const out = process.argv[2];
const read = (...p) => {
  const file = join(out, ...p);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};
const rel = (report) =>
  report === null ? null : Object.keys(report).map((k) => k.replace(/^.*\/p\//, "")).sort();
const lines = (report) => {
  if (report === null) return null;
  const covered = {};
  for (const [file, data] of Object.entries(report)) {
    const s = Object.values(data.s);
    covered[file.replace(/^.*\/p\//, "")] = `${s.filter((n) => n > 0).length}/${s.length} statements`;
  }
  return covered;
};
const digest = (f) =>
  f === undefined ? "absent" : "none" in f ? `none:${f.none}` : `record paths=${f.paths.join(",")} parts=${f.parts.map((p) => p.bytes.length).join("+")}B`;

for (const group of ["threshold", "nothreshold", "named"]) {
  console.log(`\n== ${group}`);
  const modes = ["plain", "tee", "tee-nocopy", "squeal"].filter((m) => existsSync(join(out, group, m)));
  for (const m of modes) {
    const run = read(group, m, "run.json");
    const tee = run.teeLog.length ? ` teeLog=${JSON.stringify(run.teeLog.map((t) => t.type ?? t.error))}` : "";
    console.log(`${m}: vitest ${run.vitest} exit=${run.exitCode} failedTests=${run.failed} error=${run.error ? run.error.split("\n")[0] : null}${tee}`);
  }
  const plain = read(group, "plain", "report", "coverage-final.json");
  for (const m of modes.filter((x) => x !== "plain")) {
    const report = read(group, m, "report", "coverage-final.json");
    console.log(`${m} report equals plain: ${report === null ? "no report" : isDeepStrictEqual(report, plain)}`);
    const summary = read(group, m, "report", "coverage-summary.json");
    const plainSummary = read(group, "plain", "report", "coverage-summary.json");
    if (summary) console.log(`${m} summary equals plain: ${isDeepStrictEqual(summary, plainSummary)}`);
  }
  console.log(`plain report files: ${JSON.stringify(lines(plain))}`);
  const tee = read(group, "tee", "records.json");
  const squeal = read(group, "squeal", "records.json");
  const nocopy = read(group, "tee-nocopy", "records.json");
  const keys = [...new Set([...Object.keys(tee?.files ?? {}), ...Object.keys(squeal?.files ?? {})])].sort();
  if (tee) console.log(`tee header ${JSON.stringify(tee.header)}; squeal header ${JSON.stringify(squeal?.header)}`);
  for (const k of keys) {
    const a = tee?.files[k];
    const b = squeal?.files[k];
    const same = a && b && "parts" in a && "parts" in b ? isDeepStrictEqual(a, b) : null;
    console.log(`  ${k}\n    tee:    ${digest(a)}\n    squeal: ${digest(b)}${same === null ? "" : `\n    records equal: ${same}`}`);
    if (nocopy) console.log(`    nocopy: ${digest(nocopy.files[k])}`);
  }
}
