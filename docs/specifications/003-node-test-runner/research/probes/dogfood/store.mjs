// What the shared Squeal store holds for one worktree id, opened read only.
// Usage: node store.mjs <store.sqlite> <worktree-id> [<t0-iso>] [--node-test-only]
// Runs are printed per project; node:test runs list every file, since which files ran
// for an edit is the question. Times print as UTC ISO and, with t0, seconds after it.
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const ntOnly = args.includes("--node-test-only");
const [file, wt, t0iso] = args.filter((a) => !a.startsWith("--"));
const db = new DatabaseSync(file, { readOnly: true });
const t0 = t0iso ? Date.parse(t0iso) : undefined;
const at = (ms) =>
  ms == null ? "-" : `${new Date(ms).toISOString().slice(11, 23)}${t0 ? ` +${((ms - t0) / 1000).toFixed(1)}s` : ""}`;
const all = (sql, ...a) => db.prepare(sql).all(...a);

console.log("## meta (this worktree, nodeTest keys)");
for (const r of all("select key, value from meta where key like ? or key like 'nodeTest.%'", `%${wt}%`)) console.log(`${r.key} = ${r.value.slice(0, 400)}`);

console.log("\n## revisions");
for (const r of all("select * from revisions where worktree_id = ? order by number", wt)) {
  console.log(`r${r.number} ${at(r.created_at)} ${r.trigger} dirty=${r.dirty} ${r.changes.slice(0, 300)}`);
}

console.log("\n## runs");
for (const r of all("select * from runs where worktree_id = ? order by started_at", wt)) {
  const files = JSON.parse(r.test_files);
  const by = {};
  for (const f of files) (by[f.project] ??= []).push(f.path);
  const parts = Object.entries(by).map(([p, fs]) =>
    fs.length <= 12 || p.includes(":") ? `${p}: ${fs.length} [${fs.map((f) => f.split("/").at(-1)).join(" ")}]` : `${p}: ${fs.length}`,
  );
  if (ntOnly && !Object.keys(by).some((p) => p.includes(":"))) continue;
  console.log(`r${r.revision} ${at(r.started_at)} -> ${at(r.ended_at)} (${r.ended_at ? ((r.ended_at - r.started_at) / 1000).toFixed(1) : "?"}s) ${r.end_state} ${r.checkpoint_id ? "checkpoint " : ""}${parts.join("; ")}`);
  console.log(`   log ${r.log_dir}`);
}

console.log("\n## transitions");
for (const r of all(
  `select t.*, c.project, c.test_path, c.full_name from transitions t join checks c on c.id = t.check_id
   where t.worktree_id = ? order by t.at`,
  wt,
)) {
  console.log(`r${r.revision} ${at(r.at)} ${r.kind} ${r.from_outcome ?? "-"} -> ${r.to_outcome} [${r.project}] ${r.test_path} > ${r.full_name}`);
}

console.log("\n## node:test closures (test_files rows of projects with ':' in the name)");
for (const r of all("select * from test_files where project like '%:%' order by project, path")) {
  const paths = JSON.parse(r.closure_paths);
  console.log(`[${r.project}] ${r.path} complete=${r.complete} method=${r.method} closure=${paths.length}`);
}

console.log("\n## counts of results per project at this worktree");
for (const r of all(
  `select c.project, r.outcome, count(*) n from results r join checks c on c.id = r.check_id
   where r.worktree_id = ? group by 1, 2 order by 1, 2`,
  wt,
)) console.log(`${r.project} ${r.outcome} ${r.n}`);
console.log("\n## known_states by project, outcome, validity, origin");
for (const r of all(
  `select c.project, k.outcome, k.validity, k.origin_kind, count(*) n from known_states k join checks c on c.id = k.check_id
   where k.worktree_id = ? group by 1, 2, 3, 4 order by 1`,
  wt,
)) console.log(`${r.project} ${r.outcome} ${r.validity} ${r.origin_kind} ${r.n}`);
console.log("\n## consumers");
for (const r of all("select * from consumers where worktree_id = ?", wt)) {
  console.log(`${r.session_id}/${r.agent_id} registered ${at(r.registered_at)} seen ${at(r.last_seen_at)} delivered ${at(r.last_delivered_at)}`);
}
