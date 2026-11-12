// Throwaway (row 020-38): one line per gate report: how many selected test files
// it read from the stores and how many it ran, with the wall time from its .err.
// Optional --observed <store.sqlite>: of the files it ran, how many the store's
// `observed.` row names (read-only). node summarize.mjs [--observed <db>] <out-dir> <name>...
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const args = process.argv.slice(2);
let observed = null;
if (args[0] === "--observed") {
  const db = new DatabaseSync(args[1], { readOnly: true });
  observed = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'observed.'").get()?.value ?? "{}");
  db.close();
  args.splice(0, 2);
}
const [dir, ...names] = args;
const rows = [];
for (const name of names) {
  const report = JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
  const err = readFileSync(`${dir}/${name}.err`, "utf8");
  const wall = Number(/wall-ms (\d+)/.exec(err)?.[1] ?? NaN);
  const row = { name, selected: 0, store: 0, ran: 0, completed: 0, notFinished: 0, failedFiles: 0, runMs: 0, wallMs: wall };
  const ran = [];
  for (const run of report.runs) {
    row.selected += run.selected.length;
    for (const path of run.selected) {
      if (run.from?.[path] === "store") row.store += 1;
      else { row.ran += 1; ran.push(path); }
    }
    row.completed += run.completed.length;
    row.notFinished += run.notFinished.length;
    row.failedFiles += run.failed.length;
    row.runMs += run.durationMs ?? 0;
  }
  if (observed !== null) row.ranWithObserved = ran.filter((p) => (observed[p] ?? []).length > 0).length;
  row.verdict = report.verdict;
  row.notes = err.split("\n").filter((l) => /kept|store|daemon/i.test(l) && !/^load/.test(l)).slice(0, 6);
  rows.push(row);
}
for (const row of rows) console.log(JSON.stringify(row));
