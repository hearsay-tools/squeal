// 011-148 probe (throwaway): runs whose stored result a later run at the same key replaced, and why the later run ran.
// Usage: node dup.mjs <store copy> <fate.jsonl>
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const [, , storePath, fatePath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const fate = readFileSync(fatePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const runs = new Map(db.prepare("SELECT * FROM runs").all().map((r) => [r.id, r]));
const ck = new Map(db.prepare("SELECT id, kind FROM checkpoints").all().map((c) => [c.id, c.kind]));
const revs = new Map();
for (const r of db.prepare("SELECT worktree_id, number, created_at, trigger FROM revisions").all()) (revs.get(r.worktree_id) ?? revs.set(r.worktree_id, []).get(r.worktree_id)).push(r);
const fateOf = new Map(fate.map((f) => [f.run + "\0" + f.file, f]));
const t = {}; const add = (k, s) => { t[k] ??= [0, 0]; t[k][0] += s; t[k][1]++; };
for (const f of fate.filter((f) => f.fate === "ended:replaced-same-key")) {
  const by = f.atKeyNow && f.atKeyNow !== "none" && f.atKeyNow.at > f.endAt ? f.atKeyNow.run : f.later?.run;
  const r2 = runs.get(by);
  if (!r2) { add("later run not in store", f.secs); continue; }
  const f2 = fateOf.get(r2.id + "\0" + f.file);
  const same = r2.worktree_id === f.w;
  const kind = r2.checkpoint_id ? ck.get(r2.checkpoint_id) ?? "checkpoint" : "none";
  const overlap = r2.started_at < f.endAt;
  const restart = same && (revs.get(f.w) ?? []).some((r) => r.trigger === "start" && r.created_at > f.start && r.created_at <= r2.started_at);
  let why;
  if (overlap) why = same ? "overlapping run in the same worktree" : "overlapping run in another worktree (claim)";
  else if (!same) why = "another worktree, after it ended";
  else if (restart) why = "same worktree, a daemon start between (baseline " + kind + ")";
  else if (kind === "run-all") why = "same worktree, run --all checkpoint";
  else if (f2?.cls === "rerun") why = "same worktree, re-run of a new failure (C5)";
  else why = "same worktree, other (" + (f2?.cls ?? "?") + ", " + kind + ")";
  add(why, f.secs);
}
for (const [k, [s, n]] of Object.entries(t).sort((a, b) => b[1][0] - a[1][0])) console.log(`${Math.round(s)} s, ${n} file runs: ${k}`);
