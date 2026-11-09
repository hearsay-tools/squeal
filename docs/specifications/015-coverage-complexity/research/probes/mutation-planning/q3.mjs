// Throwaway probe for research/mutation-planning.md (row 015-125), question 3.
// For mutants in Stryker reports (stored PR reports from compare.json rows, or extra report files given as
// <report.json>=<project>), in files whose bytes equal a Squeal record's blob: the innermost V8 function in
// the records that holds the mutant's start, and whether any loading test file's record shows it ran.
// "Squeal: no test runs it" = no loader's record has a hit for that function (D9 untested, per function).
// usage: node q3.mjs <compare.json> <art dir> <index.json> <cezar repo> [<scratch report>=<project>@<rev dir>]...
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [cmpF, artDir, idxF, repo, ...extra] = process.argv.slice(2);
const { index } = JSON.parse(readFileSync(idxF, "utf8"));
const PROJECT = { cezar: "server", web: "web", contract: "contract", "api-client": "api-client" };
const blobAt = (dir, rev, p) => { try { return execFileSync("git", ["-C", dir, "rev-parse", `${rev}:${p}`], { encoding: "utf8" }).trim(); } catch { return null; } };
const reports = [];
for (const row of JSON.parse(readFileSync(cmpF, "utf8"))) if (row.state === "completed")
  reports.push({ name: row.branch, project: PROJECT[row.pkg], report: JSON.parse(readFileSync(`${artDir}/${row.run}/stryker-${row.pkg}.json`, "utf8")), dir: repo, rev: row.head });
for (const e of extra) { const [file, rest] = e.split("="); const [project, dir] = rest.split("@");
  reports.push({ name: file, project, report: JSON.parse(readFileSync(file, "utf8")), dir, rev: "HEAD" }); }
const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
const tally = {}; const examples = [];
const add = (k) => { tally[k] = (tally[k] ?? 0) + 1; };
for (const { name, project, report, dir, rev } of reports) {
  for (const [f, { mutants }] of Object.entries(report.files)) {
    const blob = blobAt(dir, rev, f);
    const entries = (index[f] ?? []).filter((e) => e.project === project && e.blob === blob && e.functions);
    if (!entries.length) continue;
    for (const m of mutants) {
      if (m.status === "Ignored" || m.status === "Pending") continue;
      const at = [m.location.start.line, m.location.start.column - 1];
      // innermost function span (over all loaders) holding the mutant; module top level when none
      let best = null;
      for (const e of entries) for (const fn of e.functions) {
        const s = [fn[0], fn[1]], t = [fn[2], fn[3]];
        if (fn[0] === 1 && fn[1] === 0) continue;
        if (before(s, at) && before(at, t) && (!best || (before(best[0], s) && before(t, best[1])))) best = [s, t];
      }
      const ran = best ? entries.some((e) => e.functions.some((fn) => fn[0] === best[0][0] && fn[1] === best[0][1] && fn[2] === best[1][0] && fn[3] === best[1][1] && fn[4] === 1)) : null;
      const squeal = best === null ? "module level" : ran ? "a test runs it" : "no test runs it";
      const stryker = m.status === "NoCoverage" ? "NoCoverage" : "covered";
      add(`${stryker} / Squeal: ${squeal}${m.static ? " (static)" : ""}`);
      if (stryker !== "NoCoverage" && squeal === "no test runs it" && examples.length < 8) examples.push({ name, f, at: `${m.location.start.line}:${m.location.start.column}`, status: m.status, fn: best });
      if (stryker === "NoCoverage" && squeal !== "no test runs it" && examples.length < 16) examples.push({ name, f, at: `${m.location.start.line}:${m.location.start.column}`, status: m.status, mutator: m.mutatorName, replacement: m.replacement, fn: best });
    }
  }
}
console.log(tally);
console.log(JSON.stringify(examples, null, 0));
