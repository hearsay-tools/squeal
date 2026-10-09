// Every slow file's run in one worktree, with the 1-minute load per CPU the status poll
// saw nearest its start and the daemon version then. Read only on the store.
// Usage: node slow-runs.mjs <store.sqlite> <worktree-id> <slow-path-regex> <poll log>
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [file, wt, slowRe, pollLog] = process.argv.slice(2);
const isSlow = new RegExp(slowRe);
const db = new DatabaseSync(file, { readOnly: true });
// Poll lines start "HH:MM:SS load/cpu=X daemon=pid@version"; the dogfood ran on one UTC day.
const day = process.env.DAY ?? "2026-10-09T";
const polls = readFileSync(pollLog, "utf8")
  .split("\n")
  .map((l) => /^(\d\d:\d\d:\d\d) load\/cpu=([\d.]+)(?: daemon=(\S+))?/.exec(l))
  .filter(Boolean)
  .map((m) => ({ at: Date.parse(`${day}${m[1]}Z`), load: m[2], daemon: m[3] ?? "(not logged)" }));
const near = (ms) => polls.reduce((best, p) => (Math.abs(p.at - ms) < Math.abs(best.at - ms) ? p : best), polls[0]);
const hm = (ms) => (ms == null ? "-" : new Date(ms).toISOString().slice(11, 19));

console.log("revision start end seconds end_state load/cpu daemon file");
for (const r of db.prepare("select * from runs where worktree_id = ? order by started_at").all(wt)) {
  const slow = JSON.parse(r.test_files).map((f) => f.path).filter((p) => isSlow.test(p));
  if (slow.length === 0) continue;
  const p = near(r.started_at);
  const secs = r.ended_at ? ((r.ended_at - r.started_at) / 1000).toFixed(1) : "?";
  console.log(`r${r.revision} ${hm(r.started_at)} ${hm(r.ended_at)} ${secs} ${r.end_state} ${p.load} ${p.daemon} ${slow.join(" ")}`);
}
