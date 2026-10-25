// Throwaway probe (016-27), question 2: did a file reached by stored direct marks run as an edit's
// work? For each revision since <sinceMs> whose changes hold a marked path, the runs of that worktree
// at that revision that started within the catch-up quiet (120 s, `quiet:<wt>` meta) are the edit's
// work (catch-up waits for the quiet; a later start is catch-up or a later revision's work). Prints
// per revision: the files the marks reached, which of them ran early, the namesakes and changed test
// files (C4 step 4's own kept set), and the rest of the early files. Checkpoint runs are left out; a pair
// counts only once the file had run under a 0.1.316 or later daemon (its marks existed). Read-only.
// Usage: npx tsx edit-work.ts <store> <sinceMs> <tierSize> [worktree-to-skip]
import { DatabaseSync } from "node:sqlite";
import { namesakesOf } from "../../../../../../src/core/scheduler/namesakes.js";

const [file, sinceMs, tier, skip = ""] = process.argv.slice(2);
const K = Number(tier);
const QUIET_MS = 120_000;
const db = new DatabaseSync(file, { readOnly: true });
const marked = new Map<string, Set<string>>();
const testsByProject = new Map<string, string[]>();
for (const r of db.prepare("select project, path from test_files").all() as { project: string; path: string }[])
  testsByProject.set(r.project, [...(testsByProject.get(r.project) ?? []), r.path]);
for (const { key, value } of db.prepare("select key, value from meta where key like 'observedDirect.%'").all() as { key: string; value: string }[]) {
  const project = key.slice("observedDirect.".length);
  for (const [test, paths] of Object.entries(JSON.parse(value) as Record<string, string[]>))
    for (const p of paths) marked.set(p, (marked.get(p) ?? new Set()).add(`${project}\0${test}`));
}
const runsAt = db.prepare("select started_at, test_files from runs where worktree_id = ? and revision = ? and checkpoint_id is null order by started_at");
// Daemon incarnations per worktree (notes, exit and moves rows, and the registered one), for the version a revision ran under.
const inc = new Map<string, { version: string; at: number }[]>();
for (const { key, value } of db.prepare("select key, value from meta where key like 'notes%' or key like 'daemon-exit%' or key like 'rekeyed-moves%'").all() as { key: string; value: string }[]) {
  const wt = key.match(/[0-9a-f]{16}/)?.[0];
  if (wt) for (const m of value.matchAll(/(\d+\.\d+\.\d+)@(\d{13})/g)) inc.set(wt, [...(inc.get(wt) ?? []), { version: m[1], at: Number(m[2]) }]);
}
for (const r of db.prepare("select id, daemon_version v, daemon_started_at s from worktrees where daemon_started_at is not null").all() as { id: string; v: string; s: number }[])
  inc.set(r.id, [...(inc.get(r.id) ?? []), { version: r.v, at: r.s }]);
for (const list of inc.values()) list.sort((a, b) => a.at - b.at);
const versionAt = (wt: string, t: number) => (inc.get(wt) ?? []).filter((x) => x.at <= t).at(-1)?.version ?? "?";
const patch = (v: string) => Number(v.split(".")[2] ?? -1);
// A file's marks exist from its first completed run under a daemon of 0.1.316 or later, in any worktree.
const markedSince = new Map<string, number>();
for (const run of db.prepare("select worktree_id w, ended_at e, test_files from runs where end_state = 'completed' and started_at >= ? order by started_at").all(Number(sinceMs)) as { w: string; e: number; test_files: string }[]) {
  if (patch(versionAt(run.w, run.e)) < 316) continue;
  for (const x of JSON.parse(run.test_files) as { project: string; path: string }[]) { const id = `${x.project}\0${x.path}`; if (!markedSince.has(id)) markedSince.set(id, run.e); }
}
const stateOf = db.prepare("select k.validity v, k.origin_kind o, count(*) n from known_states k join checks c on c.id = k.check_id where k.worktree_id = ? and c.project = ? and c.test_path = ? group by 1, 2");
const runsAfter = db.prepare("select started_at, revision, checkpoint_id, test_files from runs where worktree_id = ? and started_at >= ? order by started_at");
const revs = db.prepare("select worktree_id w, number, created_at t, changes from revisions where created_at >= ? order by w, number").all(Number(sinceMs)) as { w: string; number: number; t: number; changes: string }[];
const ids = (json: string) => (JSON.parse(json) as { project: string; path: string }[]).map((x) => `${x.project}\0${x.path}`);
const totals = { revisions: 0, pairs: 0, early: 0, later: 0, never: 0, overCap: 0, reachedAtMostK: 0, reachedAtMostKAllEarly: 0, markedEarlyMax: 0, markedEarlyOverK: 0, markedBroadMax: 0 };
for (const r of revs) {
  if (r.w === skip) continue;
  const changed = (JSON.parse(r.changes) as { path: string }[]).map((c) => c.path);
  const changedSet = new Set(changed);
  const reached = new Set<string>();
  for (const p of changed) for (const f of marked.get(p) ?? []) if (!changedSet.has(f.split("\0")[1]) && (markedSince.get(f) ?? Infinity) < r.t) reached.add(f);
  if (reached.size === 0) continue;
  const own = new Set<string>();
  for (const [project, tests] of testsByProject) {
    for (const t of tests) if (changedSet.has(t)) own.add(`${project}\0${t}`);
    for (const p of changed) for (const n of namesakesOf(p, tests)) own.add(`${project}\0${n}`);
  }
  const later = runsAfter.all(r.w, r.t) as { started_at: number; revision: number; checkpoint_id: string | null; test_files: string }[];
  const early = new Set<string>();
  for (const run of runsAt.all(r.w, r.number) as { started_at: number; test_files: string }[])
    if (run.started_at < r.t + QUIET_MS) for (const id of ids(run.test_files)) early.add(id);
  // Broad: any revision's non-checkpoint run that started inside the quiet, as a quickly overtaken revision's work runs at the next number.
  const broad = new Set<string>();
  for (const run of later as { started_at: number; checkpoint_id: string | null; test_files: string }[])
    if (run.started_at < r.t + QUIET_MS && run.checkpoint_id === null) for (const id of ids(run.test_files)) broad.add(id);
  const markedBroad = [...reached].filter((f) => broad.has(f) && !own.has(f)).length;
  const markedEarly = [...reached].filter((f) => early.has(f) && !own.has(f));
  const rest = [...early].filter((f) => !reached.has(f) && !own.has(f));

  let nLater = 0, nNever = 0;
  const neverStates: string[] = [];
  for (const f of reached) {
    if (early.has(f)) continue;
    if (later.some((run) => ids(run.test_files).includes(f))) nLater++;
    else { nNever++; const [project, path] = f.split("\0"); neverStates.push((stateOf.all(r.w, project, path) as { v: string; o: string; n: number }[]).map((x) => `${x.v}/${x.o}:${x.n}`).join(",")); }
  }
  totals.revisions++; totals.pairs += reached.size; totals.early += markedEarly.length; totals.later += nLater; totals.never += nNever;
  if (markedEarly.length + rest.length > K) totals.overCap++;
  totals.markedEarlyMax = Math.max(totals.markedEarlyMax, markedEarly.length);
  totals.markedBroadMax = Math.max(totals.markedBroadMax, markedBroad);
  if (markedEarly.length > K) totals.markedEarlyOverK++;
  if (reached.size <= K) { totals.reachedAtMostK++; if (markedEarly.length === reached.size) totals.reachedAtMostKAllEarly++; }
  console.log(JSON.stringify({ worktree: r.w.slice(0, 8), revision: r.number, at: new Date(r.t).toISOString().slice(11, 19), changed: changed.length,
    small: changed.length < 10, reached: reached.size, markedEarly: markedEarly.length, markedBroad, later: nLater, never: nNever,
    ownEarly: [...own].filter((f) => early.has(f)).length, restEarly: rest.length, early: early.size,
    overCap: markedEarly.length + rest.length > K, version: versionAt(r.w, r.t), neverStates, sample: changed.slice(0, 2) }));
}
console.log(JSON.stringify({ totals }));
