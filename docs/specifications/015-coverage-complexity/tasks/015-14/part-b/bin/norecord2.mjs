// 015-14 part B: why a current result has no record: the run's end and the outcomes at the key (read only).
import { DatabaseSync } from "node:sqlite";
const [wt, ...paths] = process.argv.slice(2);
const main = new DatabaseSync("/home/agent/projects/squeal/.git/squeal/store.sqlite", { readOnly: true });
for (const p of paths) {
  const k = main.prepare("select key from test_file_keys where worktree_id = ? and path = ?").get(wt, p);
  const rs = main.prepare(`select r.outcome, count(*) n, r.run_id, ru.end_state, ru.checkpoint_id is not null cp, length(ru.test_files) tf
    from results r join checks c on c.id = r.check_id left join runs ru on ru.id = r.run_id where r.key = ? and c.test_path = ? group by r.outcome, r.run_id`).all(k.key, p);
  console.log(p, JSON.stringify(rs));
}
