// THROWAWAY probe (011-core/research/catch-up.md). Cezar main worktree (b7555ac0), 2026-10-19:
// the edit-route runs after the start's sync (revisions 98 to 103, 21:14:52Z until the restart
// at 21:41:35Z) and the backlog-route runs of `run --all` c9183f (from 21:42:37Z). Per run: its
// files, lane (by project), wall time; per file: the sum of its checks' durations in that run.
// Read-only, from the store copy.
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
const db = new DatabaseSync(process.argv[2] ?? "/tmp/r3/cezar-store.sqlite", { readOnly: true });
const WT = "b7555ac0d0f19f40";
const NODE_TEST = new Set(["test:unit", "root:test:unit"]);
const laneOf = (project, path) => /^packages\/web\/e2e\/[^/]*\.e2e\.ts$/.test(path) ? "slow" : NODE_TEST.has(project) ? "node:test" : "vitest";
const runs = db.prepare(`select id, revision, test_files, checkpoint_id, started_at, ended_at, end_state from runs
  where worktree_id = ? and started_at >= ? order by started_at`).all(WT, Date.parse("2026-10-19T21:14:00Z"));
const perFile = db.prepare(`select c.project, c.test_path path, sum(r.duration_ms) ms, count(*) checks, max(r.recorded_at) at
  from results r join checks c on c.id = r.check_id where r.run_id = ? group by c.project, c.test_path`);
const out = runs.map((r) => {
  const files = JSON.parse(r.test_files);
  const ds = new Map(perFile.all(r.id).map((f) => [`${f.project}\0${f.path}`, f]));
  return {
    id: r.id.slice(0, 8), revision: r.revision, route: r.checkpoint_id === null ? "edit" : "backlog",
    lane: laneOf(files[0].project, files[0].path), startedAt: r.started_at, wallS: r.ended_at === null ? null : (r.ended_at - r.started_at) / 1000,
    end: r.end_state,
    files: files.map((f) => ({ id: `${f.project}\0${f.path}`, s: (ds.get(`${f.project}\0${f.path}`)?.ms ?? 0) / 1000, stored: ds.has(`${f.project}\0${f.path}`) })),
  };
});
writeFileSync("results/cezar-733.json", JSON.stringify(out, null, 1));
for (const route of ["edit", "backlog"]) for (const lane of ["vitest", "node:test", "slow"]) {
  const rs = out.filter((r) => r.route === route && r.lane === lane);
  if (!rs.length) continue;
  const files = rs.flatMap((r) => r.files);
  const first = Math.min(...rs.map((r) => r.startedAt)), last = Math.max(...rs.map((r) => r.startedAt + (r.wallS ?? 0) * 1000));
  console.log(`${route} ${lane}: ${rs.length} runs, ${files.length} files (${files.filter((f) => f.stored).length} stored), ${new Date(first).toISOString().slice(11, 19)} to ${new Date(last).toISOString().slice(11, 19)}, ${((last - first) / 1000).toFixed(0)} s span, sum of walls ${rs.reduce((a, r) => a + (r.wallS ?? 0), 0).toFixed(0)} s, sum of file times ${files.reduce((a, f) => a + f.s, 0).toFixed(0)} s`);
}
