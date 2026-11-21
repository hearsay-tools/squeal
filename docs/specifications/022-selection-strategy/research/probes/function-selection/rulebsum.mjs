// Throwaway: totals of ruleb.mjs output, per failing test file and per edit.
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const f = r.edits.flatMap((e) => e.failing.map((x) => ({ ...x, e })));
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
console.log(JSON.stringify({
  newFailures: r.newFailures, withEveryRevisionStored: f.length, editOnly: f.filter((x) => x.e.editOnly).length, edits: r.edits.length,
  failing: { reached: f.filter((x) => x.reached).length, inCut: f.filter((x) => x.inCut).length, inB: f.filter((x) => x.inB).length, inEither: f.filter((x) => x.inB || x.inCut).length, noRecord: f.filter((x) => x.noRecord).length, recordButNotB: f.filter((x) => x.reached && !x.noRecord && !x.inB).length },
  setsPerEdit: {
    reachedFiles: { median: med(r.edits.map((e) => e.reached)), sum: sum(r.edits.map((e) => e.reached)) }, reachedS: sum(r.edits.map((e) => e.reachedS)),
    cutFiles: { median: med(r.edits.map((e) => e.cut)), sum: sum(r.edits.map((e) => e.cut)) }, cutS: sum(r.edits.map((e) => e.cutS)),
    BFiles: { median: med(r.edits.map((e) => e.B)), sum: sum(r.edits.map((e) => e.B)) }, BS: sum(r.edits.map((e) => e.BS)),
    noRecordFiles: { median: med(r.edits.map((e) => e.noRecord)), sum: sum(r.edits.map((e) => e.noRecord)) }, noRecordS: sum(r.edits.map((e) => e.noRecordS)),
  },
  rows: f.map((x) => [x.test, x.e.changedPaths, x.reached ? 1 : 0, x.inCut ? 1 : 0, x.inB ? 1 : 0, x.noRecord ? 1 : 0]),
}, null, 1));
