// 015-14 Round 3 interim: per run started since a mark, the test files it gave
// a result and whether the code store holds a coverage record at that result's
// key, read only. This counts completed results without a record (015-79)
// without the drop notes, which a worktree's removal deletes. A key can be
// shared by worktrees, so a record written by any run counts. Runs that ended
// in the last <settle> seconds are left out: a record is written after its
// result, and a reading during a run sees records still being written.
// Usage: node runs_norecord.mjs <.git/squeal dir> <mark, ISO> <settle seconds> [<worktree id>=<name>...]
import { DatabaseSync } from "node:sqlite";

const [dir, markIso, settle, ...named] = process.argv.slice(2);
const names = new Map(named.map((n) => n.split("=")));
const open = (name) => {
  const db = new DatabaseSync(`${dir}/${name}`, { readOnly: true });
  db.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 5000");
  return db;
};
const main = open("store.sqlite");
const code = open("code.sqlite");
const readAt = Date.now();
const cut = readAt - Number(settle) * 1000;
const runs = main.prepare("SELECT id, worktree_id, started_at, ended_at, end_state FROM runs WHERE started_at >= ?").all(Date.parse(markIso));
const files = main.prepare(`SELECT c.test_path, r.key, group_concat(DISTINCT r.outcome) outcomes
  FROM results r JOIN checks c ON c.id = r.check_id WHERE r.run_id = ? GROUP BY c.test_path, r.key`);
const rec = code.prepare("SELECT 1 FROM coverage WHERE result_key = ? AND provider_version = 2");
const groups = {};
for (const run of runs) {
  const wt = names.get(run.worktree_id) ?? run.worktree_id;
  const settled = run.ended_at !== null && Number(run.ended_at) <= cut;
  const g = (groups[`${wt} ${run.end_state ?? "open"} ${settled ? "settled" : "recent or open"}`] ??= {
    worktree: wt, end: run.end_state ?? "open", settled, runs: 0, testFiles: 0, withRecord: 0, noRecord: 0, noRecordSkipOnly: 0, examples: [],
  });
  g.runs++;
  for (const f of files.all(run.id)) {
    g.testFiles++;
    if (rec.get(f.key)) g.withRecord++;
    else {
      g.noRecord++;
      if (f.outcomes === "skip") g.noRecordSkipOnly++;
      if (g.examples.length < 6) g.examples.push(`${f.test_path} ${new Date(Number(run.ended_at ?? run.started_at)).toISOString()} ${f.outcomes}`);
    }
  }
}
console.log(JSON.stringify({ mark: markIso, readAt: new Date(readAt).toISOString(), settleSeconds: Number(settle),
  groups: Object.values(groups).sort((a, b) => b.testFiles - a.testFiles) }, null, 1));
