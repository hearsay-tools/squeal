// Throwaway probe, row 011-267. Reads cezar's Squeal store read-only and
// writes traces.json: every run of the two trial worktrees, with its files,
// per-file durations from report.json, and which files are the named set.
// Usage: node extract.mjs [store] > traces.json
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';

const store = process.argv[2] ?? '/home/agent/projects/cezar/.git/squeal/store.sqlite';
const db = new DatabaseSync(store, { readOnly: true });
const traces = [
  { name: '0.1.374', worktree: 'fc6636c99e616927', from: '01:22', to: '02:28' },
  { name: '0.1.377', worktree: 'aa38987337df8e1f', from: '09:29', to: '10:02' },
];
const named = (path) => /^packages\/cezar\/src\/(core|workflows)\/[^/]+-parity\.test\.ts$/.test(path);
const out = [];
for (const trace of traces) {
  const rows = db
    .prepare('select * from runs where worktree_id = ? order by started_at')
    .all(trace.worktree);
  const runs = rows.map((row) => {
    const files = JSON.parse(row.test_files).map((f) => f.path);
    const report = `${row.log_dir}/report.json`;
    const durations = {};
    let end = row.end_state;
    if (existsSync(report)) {
      const r = JSON.parse(readFileSync(report, 'utf8')).report;
      end = r.end;
      for (const fd of r.fileDurations ?? []) durations[fd.testFile.path] = fd.durationMs / 1000;
    }
    return {
      id: row.id,
      revision: row.revision,
      checkpoint: row.checkpoint_id !== null,
      start: new Date(row.started_at).toISOString(),
      wall: row.ended_at === null ? null : (row.ended_at - row.started_at) / 1000,
      end,
      files: files.map((path) => ({ path, named: named(path), s: durations[path] ?? null })),
    };
  });
  out.push({ ...trace, runs });
}
console.log(JSON.stringify(out, null, 1));
