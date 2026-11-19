// pick-queued.mjs <store.sqlite> <n>: the <n> queued Vitest test files of the
// server project, outside the run-loop group (parity and worker- tests),
// with the longest stored durations: catch-up runs shortest first, so these
// sit at the tail of the queue. Prints one path per line.
import { DatabaseSync } from "node:sqlite";
const [store, n] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const queued = db.prepare("select path from test_file_keys where pending = 'queued' and project = 'server'").all()
  .map((r) => r.path).filter((p) => !/parity.*\.test\.ts$|\/worker-[^/]*\.test\.ts$/.test(p));
const dur = new Map(db.prepare(`select c.test_path p, max(r.duration_ms) d from results r join checks c on c.id = r.check_id
  where c.project = 'server' group by c.test_path`).all().map((r) => [r.p, r.d]));
queued.sort((a, b) => (dur.get(b) ?? 0) - (dur.get(a) ?? 0));
console.log(queued.slice(0, Number(n)).join("\n"));
