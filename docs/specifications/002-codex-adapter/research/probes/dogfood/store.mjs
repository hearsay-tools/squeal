// What the shared Squeal store still holds for one worktree id, opened read only.
// Usage: node store.mjs <store.sqlite> <worktree-id> [<t0-iso>]
// Times print as local ISO and, with t0, as seconds after it.
import { DatabaseSync } from "node:sqlite";

const [file, wt, t0iso] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const t0 = t0iso ? Date.parse(t0iso) : undefined;
const at = (ms) =>
  ms == null ? "-" : `${new Date(ms).toISOString().slice(11, 23)}${t0 ? ` +${((ms - t0) / 1000).toFixed(1)}s` : ""}`;
const all = (sql, ...a) => db.prepare(sql).all(...a);

console.log("## meta");
for (const r of all("select key, value from meta where key like ? or key not like '%.%' and key not like '%:%'", `%${wt}%`)) console.log(`${r.key} = ${r.value}`);

console.log("\n## worktree");
for (const r of all("select * from worktrees where id = ?", wt)) {
  console.log({ ...r, registered_at: at(r.registered_at), daemon_started_at: at(r.daemon_started_at), daemon_heartbeat_at: at(r.daemon_heartbeat_at) });
}

console.log("\n## revisions");
for (const r of all("select * from revisions where worktree_id = ? order by number", wt)) {
  console.log(`r${r.number} ${at(r.created_at)} ${r.trigger} dirty=${r.dirty} head=${r.head?.slice(0, 7)} ${r.changes.slice(0, 300)}`);
}

console.log("\n## runs");
for (const r of all("select * from runs where worktree_id = ? order by started_at", wt)) {
  const files = JSON.parse(r.test_files);
  const shown = Array.isArray(files) ? `${files.length} files${files.length <= 4 ? ` ${files.join(" ")}` : ""}` : r.test_files.slice(0, 80);
  console.log(`r${r.revision} ${at(r.started_at)} -> ${at(r.ended_at)} ${r.end_state} ${r.checkpoint_id ? "checkpoint" : ""} ${shown}`);
}

console.log("\n## checkpoints");
for (const r of all("select * from checkpoints where worktree_id = ? order by started_at", wt)) {
  console.log(`r${r.revision} ${r.kind} ${at(r.started_at)} -> ${at(r.completed_at)} ${r.end_state}`);
}

console.log("\n## transitions");
for (const r of all(
  `select t.*, c.test_path, c.full_name from transitions t join checks c on c.id = t.check_id
   where t.worktree_id = ? order by t.at`,
  wt,
)) {
  console.log(`r${r.revision} ${at(r.at)} ${r.kind} ${r.from_outcome ?? "-"} -> ${r.to_outcome} ${r.test_path} > ${r.full_name}`);
}

console.log("\n## results that failed");
for (const r of all(
  `select r.*, c.test_path, c.full_name from results r join checks c on c.id = r.check_id
   where r.worktree_id = ? and r.outcome != 'pass' order by r.recorded_at`,
  wt,
)) {
  console.log(`r${r.revision} ${at(r.recorded_at)} ${r.outcome} ${r.test_path} > ${r.full_name}`);
}
const n = all("select count(*) n, min(recorded_at) a, max(recorded_at) b from results where worktree_id = ?", wt)[0];
console.log(`results kept: ${n.n}, recorded ${at(n.a)} to ${at(n.b)}`);

console.log("\n## consumers and views");
for (const r of all("select * from consumers where worktree_id = ?", wt)) {
  console.log(`${r.session_id}/${r.agent_id} registered ${at(r.registered_at)} seen ${at(r.last_seen_at)} delivered ${at(r.last_delivered_at)}`);
}
const v = all("select count(*) n from consumer_views where worktree_id = ?", wt)[0];
console.log(`consumer_views rows: ${v.n}`);
const ks = all("select outcome, validity, count(*) n from known_states where worktree_id = ? group by 1, 2", wt);
console.log("known_states:", JSON.stringify(ks));
