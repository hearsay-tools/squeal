// Throwaway probe (row 011-408): a --import preload that counts SQLite statement calls and rows by status phase.
// Writes JSON to $ROWS_OUT at exit. Its stack captures add CPU: never time a run that loads it.
import { writeFileSync } from "node:fs";
import { StatementSync } from "node:sqlite";
const PHASES = ["importsOf", "readVerdict", "readNamedFiles", "selectNamedFiles", "readClasses", "pauseOnlyIds", "holdOfWait", "snapshotFocus", "buildSnapshot", "sourcePaths", "syncDaemon"];
const tally = new Map();
Error.stackTraceLimit = 60;
const phaseOf = () => {
  const stack = new Error().stack ?? "";
  let best = "other", at = Infinity;
  for (const p of PHASES) {
    const i = stack.indexOf(` ${p} (`);
    if (i >= 0 && i < at) { at = i; best = p; }
  }
  return best;
};
const count = (sql, rows) => {
  const phase = phaseOf();
  const t = tally.get(phase) ?? { calls: 0, rows: 0, bySql: new Map() };
  t.calls++; t.rows += rows;
  const s = sql.replace(/\s+/g, " ").slice(0, 110);
  const b = t.bySql.get(s) ?? [0, 0];
  b[0]++; b[1] += rows; t.bySql.set(s, b);
  tally.set(phase, t);
};
for (const m of ["all", "get", "iterate"]) {
  const orig = StatementSync.prototype[m];
  StatementSync.prototype[m] = function (...args) {
    const r = orig.apply(this, args);
    if (m === "all") count(this.sourceSQL, r.length);
    else if (m === "get") count(this.sourceSQL, r === undefined ? 0 : 1);
    else count(this.sourceSQL + " [iterate]", 0);
    return r;
  };
}
process.on("exit", () => {
  const out = {};
  for (const [p, t] of tally) out[p] = { calls: t.calls, rows: t.rows, top: [...t.bySql].sort((a, b) => b[1][1] - a[1][1]).slice(0, 8).map(([s, [c, r]]) => ({ calls: c, rows: r, sql: s })) };
  writeFileSync(process.env.ROWS_OUT, JSON.stringify(out, null, 1));
});
