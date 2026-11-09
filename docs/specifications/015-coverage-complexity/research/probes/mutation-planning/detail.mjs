// Throwaway probe for research/mutation-planning.md (row 015-125), questions 2 and 3, from stored reports.
// For the mutants of compare.json's rows in files whose PR-head blob equals the Squeal record's blob, lists:
//  - killed mutants none of whose killing test files is in Squeal's "called" set for the file
//  - (test file, mutant) pairs Stryker's coverage has and whose record shows no function of the file ran
//  - NoCoverage mutants whose line some record shows covered
// usage: node detail.mjs <compare.json> <art dir> <index.json> <cezar repo> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [cmpF, artDir, idxF, repo, out] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(cmpF, "utf8"));
const { index } = JSON.parse(readFileSync(idxF, "utf8"));
const PROJECT = { cezar: "server", web: "web", contract: "contract", "api-client": "api-client" };
const blobAt = (h, p) => { try { return execFileSync("git", ["-C", repo, "rev-parse", `${h}:${p}`], { encoding: "utf8" }).trim(); } catch { return null; } };
const bit = (b64, line) => { const b = Buffer.from(b64, "base64"); const i = line - 1; return (b[i >> 3] >> (i & 7)) & 1; };
const res = { unkilledByCalled: [], coveredNotCalled: {}, noCovButLine: [] };
for (const row of rows) {
  if (row.state !== "completed") continue;
  const report = JSON.parse(readFileSync(`${artDir}/${row.run}/stryker-${row.pkg}.json`, "utf8"));
  const fileOf = new Map();
  for (const [tf, { tests }] of Object.entries(report.testFiles ?? {})) for (const t of tests) fileOf.set(t.id, tf);
  for (const [f, { mutants }] of Object.entries(report.files)) {
    const head = blobAt(row.head, f);
    const entries = (index[f] ?? []).filter((e) => e.project === PROJECT[row.pkg] && e.blob === head);
    if (!entries.length) continue;
    const called = new Set(entries.filter((e) => e.called).map((e) => e.test));
    const byTest = new Map(entries.map((e) => [e.test, e]));
    for (const m of mutants) {
      const where = `${f}:${m.location.start.line}:${m.location.start.column} ${m.mutatorName} ${m.status}`;
      const kil = [...new Set((m.killedBy ?? []).map((id) => fileOf.get(id)))];
      const cov = [...new Set((m.coveredBy ?? []).map((id) => fileOf.get(id)))];
      if (m.status === "Killed" && kil.length && !kil.some((t) => called.has(t))) res.unkilledByCalled.push({ pr: row.branch, where, killers: kil, inRecords: kil.map((t) => (byTest.has(t) ? "loaded only" : "no record naming the file")), coveredBy: cov.length });
      for (const t of cov) if (!called.has(t)) {
        const k = `${t} -> ${f}`;
        (res.coveredNotCalled[k] ??= { pairs: 0, record: byTest.has(t) ? "loaded only" : "no record naming the file", pr: row.branch }).pairs++;
      }
      if (m.status === "NoCoverage") {
        const lineBy = entries.filter((e) => e.covered && bit(e.covered, m.location.start.line)).map((e) => e.test);
        if (lineBy.length) res.noCovButLine.push({ pr: row.branch, where, end: `${m.location.end.line}:${m.location.end.column}`, replacement: m.replacement, lineCoveredBy: lineBy.length, inRelated: lineBy.filter((t) => report.testFiles?.[t]).length });
      }
    }
  }
}
writeFileSync(out, JSON.stringify(res, null, 1));
console.log("killed, no killer in called:", res.unkilledByCalled.length);
console.log("covered pairs not called:", Object.values(res.coveredNotCalled).reduce((s, v) => s + v.pairs, 0), "in", Object.keys(res.coveredNotCalled).length, "test->file pairs");
console.log("NoCoverage with a covered line:", res.noCovButLine.length);
