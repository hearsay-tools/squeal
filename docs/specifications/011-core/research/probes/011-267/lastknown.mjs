// Throwaway probe, row 011-267. For each trace's t0, each test file's latest
// file-level duration recorded before t0 in cezar's store (any worktree), read-only:
// the "last-known duration" the scheduler orders by. Writes JSON to stdout.
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2] ?? '/home/agent/projects/cezar/.git/squeal/store.sqlite', { readOnly: true });
const q = db.prepare(`
  select c.test_path p, r.duration_ms ms from results r join checks c on c.id = r.check_id
  where c.kind = 'file' and r.recorded_at < ? and r.recorded_at = (
    select max(r2.recorded_at) from results r2 where r2.check_id = r.check_id and r2.recorded_at < ?)`);
const out = {};
for (const [name, t0] of [['0.1.377', '2026-10-29T09:29:19Z'], ['0.1.374', '2026-10-29T01:21:55Z']]) {
  const at = Date.parse(t0);
  out[name] = Object.fromEntries(q.all(at, at).map((r) => [r.p, r.ms / 1000]));
}
console.log(JSON.stringify(out));
