// The worktree's revision number once a minute (check 1, defect 10), from the shared store
// opened read only: UTC time, load per CPU, the newest revision, when and by what trigger it
// was made, how many revisions came in the last minute, and the first changed paths of each.
// Usage: node rev-watch.mjs <store.sqlite> <worktree-id> <every s> <max s>
import { availableParallelism, loadavg } from "node:os";
import { DatabaseSync } from "node:sqlite";

const [file, wt, every, max] = process.argv.slice(2);
const end = Date.now() + Number(max) * 1000;
const hm = (ms) => new Date(ms).toISOString().slice(11, 19);
let seen = -1;
for (;;) {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare("select number, created_at, trigger, changes from revisions where worktree_id = ? and number > ? order by number").all(wt, seen);
  const top = db.prepare("select number, created_at, trigger from revisions where worktree_id = ? order by number desc limit 1").get(wt);
  db.close();
  const load = (loadavg()[0] / availableParallelism()).toFixed(2);
  console.log(`${hm(Date.now())} load/cpu=${load} newest=r${top?.number ?? "-"} at ${top ? hm(top.created_at) : "-"} (${top?.trigger ?? "-"}) new=${seen < 0 ? "-" : rows.length}`);
  if (seen >= 0) {
    for (const r of rows) {
      const paths = JSON.parse(r.changes).map((c) => c.path ?? c);
      console.log(`  r${r.number} ${hm(r.created_at)} ${r.trigger} ${paths.length} path(s): ${paths.slice(0, 3).join(" ")}${paths.length > 3 ? " ..." : ""}`);
    }
  }
  seen = top?.number ?? 0;
  if (Date.now() > end) process.exit(0);
  await new Promise((r) => setTimeout(r, Number(every) * 1000));
}
