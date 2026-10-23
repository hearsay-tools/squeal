// 011-152 probe (throwaway): each file a worktree's first daemon start missed, and what the store held at that key and commit before.
// Usage: node first.mjs <store copy> <run-log snapshot> <copy time ms> <out.jsonl> [every]
// With "every", every baseline checkpoint in the window, not only each worktree's first.
// Reads a store copy and its run-log snapshot, read only. One JSON line per miss of a first baseline in the 72 hours before the copy.
import { DatabaseSync } from "node:sqlite"; import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [, , storePath, logs, copyArg, outPath, mode] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const copyAt = Number(copyArg), since = copyAt - 72 * 3600_000;
const live = new Map(db.prepare("SELECT id, root, registered_at FROM worktrees").all().map((w) => [w.id, w]));
const rev = db.prepare("SELECT number, head, dirty, trigger, created_at FROM revisions WHERE worktree_id = ? ORDER BY number");
const fileCheck = db.prepare("SELECT id FROM checks WHERE kind = 'file' AND project = ? AND test_path = ?");
const rowsOf = db.prepare("SELECT key, worktree_id, revision, commit_sha, dirty, run_id, recorded_at, outcome, duration_ms FROM results WHERE check_id = ? ORDER BY recorded_at");
const keyNow = db.prepare("SELECT key, revision FROM test_file_keys WHERE worktree_id = ? AND project = ? AND path = ?");
// Each worktree's first baseline checkpoint: the earliest baseline row it has, at revision 0 or 1, in the window.
const cks = db.prepare("SELECT * FROM checkpoints WHERE kind = 'baseline' ORDER BY started_at").all();
const first = new Map();
for (const c of cks) if (!first.has(c.worktree_id)) first.set(c.worktree_id, c);
const runsOf = db.prepare("SELECT * FROM runs WHERE checkpoint_id = ? ORDER BY started_at");
const out = [];
const chosen = mode === "every" ? cks.filter((c) => c.started_at >= since).map((c) => [c.worktree_id, c]) : [...first];
for (const [w, c] of chosen) {
  const lw = live.get(w);
  if (mode !== "every") { if (c.started_at < since || c.revision > 1) continue; if (lw && lw.registered_at < since) continue; }
  const revs = lw ? rev.all(w) : [];
  const r0 = revs.find((r) => r.number === c.revision) ?? null;
  const misses = JSON.parse(c.test_files);
  const ran = new Map();
  for (const run of runsOf.all(c.id)) {
    const dir = logs + "/" + run.log_dir.split("/").pop();
    let rep = null; try { rep = JSON.parse(readFileSync(dir + "/report.json", "utf8")).report; } catch {}
    const dur = new Map((rep?.fileDurations ?? []).map((d) => [d.testFile.project + "\0" + d.testFile.path, d.durationMs / 1000]));
    for (const f of JSON.parse(run.test_files)) {
      const id = f.project + "\0" + f.path;
      ran.set(id, { run: run.id, start: run.started_at, secs: dur.get(id) ?? null, ended: dur.has(id), end: rep?.end ?? run.end_state, wall: ((run.ended_at ?? run.started_at) - run.started_at) / 1000 });
    }
  }
  for (const f of misses) {
    const id = f.project + "\0" + f.path;
    const r = ran.get(id) ?? null;
    const check = fileCheck.get(f.project, f.path)?.id ?? null;
    const rows = check === null ? [] : rowsOf.all(check);
    const own = r ? rows.find((x) => x.run_id === r.run) : null;
    const now = lw ? keyNow.get(w, f.project, f.path) : null;
    // The key at the start: the run's stored row, else the worktree's key now when it was computed at or before the start's revision.
    const key = own?.key ?? (now && now.revision <= c.revision ? now.key : null);
    const t = r?.start ?? c.started_at;
    const before = rows.filter((x) => x.recorded_at < c.started_at && x.worktree_id !== w);
    const commit = r0?.head ?? own?.commit_sha ?? null;
    const dirty = r0 ? r0.dirty : own ? own.dirty : null;
    out.push({
      w, live: !!lw, firstCk: first.get(w)?.id === c.id, root: lw?.root ?? null, ck: c.id, ckStart: c.started_at, ckRev: c.revision, ckEnd: c.end_state, commit, dirty,
      file: id, ran: !!r, secs: r?.secs ?? null, ended: r?.ended ?? false, runEnd: r?.end ?? null, wall: r?.wall ?? null, key, keySource: own ? "row" : key ? "test_file_keys" : null,
      sameKeyBefore: key ? before.filter((x) => x.key === key).map((x) => ({ w: x.worktree_id, at: x.recorded_at, outcome: x.outcome })) : null,
      sameCommitBefore: commit ? before.filter((x) => x.commit_sha === commit && x.dirty === 0).map((x) => ({ w: x.worktree_id, key: x.key, at: x.recorded_at, live: live.has(x.worktree_id) })) : [],
      newestBefore: before.at(-1) ? { w: before.at(-1).worktree_id, key: before.at(-1).key, commit: before.at(-1).commit_sha, dirty: before.at(-1).dirty, at: before.at(-1).recorded_at, live: live.has(before.at(-1).worktree_id) } : null,
      usual: rows.length ? rows.map((x) => x.duration_ms).sort((a, b) => a - b)[rows.length >> 1] / 1000 : null,
    });
  }
}
writeFileSync(outPath, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
const by = {}; for (const o of out) { const k = `${o.live ? "live" : "removed"} ${o.ran ? "ran" : "not run"}`; by[k] ??= [0, 0]; by[k][0]++; by[k][1] += o.secs ?? 0; }
console.log(`first baselines: ${new Set(out.map((o) => o.ck)).size}; misses ${out.length}`); for (const [k, [n, s]] of Object.entries(by)) console.log(`${k}: ${n} files, ${Math.round(s)} s`);
