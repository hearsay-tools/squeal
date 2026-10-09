// What the shared Squeal store holds for one worktree id, opened read only, with the
// slow files' runs picked out: each run's revision, start, end, duration, end state and
// whether it held slow files (matched by the regex given), then transitions and meta.
// Usage: node store.mjs <store.sqlite> <worktree-id> <slow-path-regex> [<t0-iso>] [--slow-only]
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const slowOnly = args.includes("--slow-only");
const [file, wt, slowRe, t0iso] = args.filter((a) => !a.startsWith("--"));
const isSlow = new RegExp(slowRe);
const db = new DatabaseSync(file, { readOnly: true });
const t0 = t0iso ? Date.parse(t0iso) : undefined;
const at = (ms) =>
  ms == null ? "-" : `${new Date(ms).toISOString().slice(11, 23)}${t0 ? ` +${((ms - t0) / 1000).toFixed(1)}s` : ""}`;
const all = (sql, ...a) => db.prepare(sql).all(...a);

console.log("## meta (this worktree)");
for (const r of all("select key, value from meta where key like ?", `%${wt}%`)) console.log(`${r.key} = ${r.value.slice(0, 600)}`);

console.log("\n## revisions");
for (const r of all("select * from revisions where worktree_id = ? order by number", wt)) {
  console.log(`r${r.number} ${at(r.created_at)} ${r.trigger} dirty=${r.dirty} ${r.changes.slice(0, 300)}`);
}

console.log("\n## runs (S = holds slow files)");
for (const r of all("select * from runs where worktree_id = ? order by started_at", wt)) {
  const files = JSON.parse(r.test_files).map((f) => f.path ?? f);
  const slow = files.filter((f) => isSlow.test(f));
  if (slowOnly && slow.length === 0) continue;
  const dur = r.ended_at ? ((r.ended_at - r.started_at) / 1000).toFixed(1) : "?";
  const shown = slow.length > 0 ? slow.map((f) => f.split("/").at(-1)).join(" ") : files.length <= 6 ? files.join(" ") : `${files.length} files`;
  console.log(`${slow.length ? "S" : " "} r${r.revision} ${at(r.started_at)} -> ${at(r.ended_at)} (${dur}s) ${r.end_state}${r.checkpoint_id ? " checkpoint" : ""} ${shown}`);
}

console.log("\n## transitions");
for (const r of all(
  `select t.*, c.project, c.test_path, c.full_name from transitions t join checks c on c.id = t.check_id
   where t.worktree_id = ? order by t.at`,
  wt,
)) {
  if (slowOnly && !isSlow.test(r.test_path)) continue;
  console.log(`r${r.revision} ${at(r.at)} ${r.kind} ${r.from_outcome ?? "-"} -> ${r.to_outcome} [${r.project}] ${r.test_path} > ${r.full_name}`);
}

console.log("\n## known_states of slow files by outcome, validity, origin");
for (const r of all(
  `select c.test_path, k.outcome, k.validity, k.origin_kind, k.origin_worktree, k.observed_at, count(*) n
   from known_states k join checks c on c.id = k.check_id where k.worktree_id = ? group by 1, 2, 3, 4, 5 order by 1`,
  wt,
)) {
  if (!isSlow.test(r.test_path)) continue;
  console.log(`${r.test_path} ${r.outcome} ${r.validity} ${r.origin_kind} ${r.origin_worktree ?? ""} ${r.n}`);
}
console.log("\n## consumers");
for (const r of all("select * from consumers where worktree_id = ?", wt)) {
  console.log(`${r.session_id}/${r.agent_id} registered ${at(r.registered_at)} seen ${at(r.last_seen_at)} delivered ${at(r.last_delivered_at)}`);
}
