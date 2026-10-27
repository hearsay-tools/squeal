import { DatabaseSync } from "node:sqlite";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
const c = new DatabaseSync(dir + "code.sqlite", { readOnly: true });
const run = process.argv[2];
const j = (x) => JSON.stringify(x);
console.log("run:", j(s.prepare("select id, worktree_id, revision, started_at, ended_at, end_state, checkpoint_id, test_files from runs where id=?").all(run)));
const res = s.prepare("select r.key, r.outcome, r.worktree_id, r.revision, r.recorded_at, r.check_id, k.kind, k.test_path, k.full_name from results r join checks k on k.id=r.check_id where r.run_id=?").all(run);
console.log("results:", j(res));
const paths = [...new Set(res.map((r) => r.test_path))];
for (const p of paths) {
  console.log("keys now:", j(s.prepare("select * from test_file_keys where path=?").all(p)));
  const keys = [...new Set(res.filter((r) => r.test_path === p).map((r) => r.key))];
  for (const k of keys) {
    console.log("coverage at", k, j(c.prepare("select provider_version, length(record) n, recorded_at from coverage where result_key=?").all(k)));
    console.log("all results at key:", j(s.prepare("select r.run_id, r.worktree_id, r.recorded_at, k.kind, k.full_name from results r join checks k on k.id=r.check_id where r.key=?").all(k)));
  }
}
