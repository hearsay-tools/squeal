// Throwaway probe (row 018-69): how many test files a sandbox worktree had started
// running by given seconds after the fast-forward. Usage: node started-by.cjs <store> <ff ISO> <s>...
const { DatabaseSync } = require("node:sqlite");
const [file, ffIso, ...marks] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const ff = Date.parse(ffIso);
const runs = db.prepare("select started_at s, ended_at e, json_array_length(test_files) n from runs where started_at >= ?").all(ff);
for (const m of marks.map(Number)) {
  const started = runs.filter((r) => r.s < ff + m * 1000).reduce((a, r) => a + r.n, 0);
  const ended = runs.filter((r) => r.e !== null && r.e < ff + m * 1000).reduce((a, r) => a + r.n, 0);
  console.log(JSON.stringify({ secondsAfterFf: m, filesStarted: started, filesEnded: ended, of: runs.reduce((a, r) => a + r.n, 0) }));
}
