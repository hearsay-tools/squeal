// Throwaway (row 011-71): reads the shared store read-only and prints the rows
// research/stuck-tier.md cites. Usage: node evidence.cjs <store.sqlite> <worktreeId> <testPath>
const { DatabaseSync } = require("node:sqlite");
const [store, wt, path] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const all = (sql, ...a) => db.prepare(sql).all(...a);
const out = {
  keyRow: all("SELECT key, revision, pending FROM test_file_keys WHERE worktree_id=? AND path=?", wt, path),
  pendingRows: all("SELECT pending, count(*) n FROM test_file_keys WHERE worktree_id=? GROUP BY 1", wt),
  fileState: all(
    `SELECT k.outcome, k.validity, k.pending_phase, k.observed_at, k.origin_kind, k.origin_worktree, k.origin_commit
     FROM known_states k JOIN checks c ON c.id=k.check_id WHERE k.worktree_id=? AND c.test_path=? AND c.kind='file'`, wt, path),
  runsWithFile: all("SELECT id, revision, started_at, ended_at, end_state FROM runs WHERE worktree_id=? AND test_files LIKE ?", wt, `%"${path}"%`),
  openRuns: all("SELECT id, revision, started_at FROM runs WHERE worktree_id=? AND ended_at IS NULL", wt),
  lastRunEnd: all("SELECT max(ended_at) at FROM runs WHERE worktree_id=?", wt),
  runsRev4to6: all("SELECT id, revision, started_at, ended_at, end_state FROM runs WHERE worktree_id=? AND revision BETWEEN 4 AND 6 ORDER BY started_at", wt),
  revisions3to6: all("SELECT number, created_at, changes FROM revisions WHERE worktree_id=? AND number BETWEEN 3 AND 6", wt),
  checkpoints: all("SELECT id, revision, kind, started_at, completed_at, end_state FROM checkpoints WHERE worktree_id=?", wt),
  fileResultsInWorktreeOrAtKey: all(
    `SELECT substr(r.key,1,16) key, r.worktree_id, r.revision, r.commit_sha, r.run_id FROM results r JOIN checks c ON c.id=r.check_id
     WHERE c.test_path=? AND c.kind='file' AND (r.worktree_id=? OR r.key=(SELECT key FROM test_file_keys WHERE worktree_id=? AND path=?))`,
    path, wt, wt, path),
  inheritedKey: all(
    `SELECT substr(r.key,1,16) key, r.worktree_id, r.revision, r.commit_sha FROM results r JOIN checks c ON c.id=r.check_id
     WHERE c.test_path=? AND c.kind='file' AND r.commit_sha=(SELECT k.origin_commit FROM known_states k JOIN checks c2 ON c2.id=k.check_id
       WHERE k.worktree_id=? AND c2.test_path=? AND c2.kind='file')`, path, wt, path),
  closureHasRecorder: all("SELECT instr(closure_paths,'src/runners/observe/recorder.cjs')>0 has FROM test_files WHERE path=?", path),
  meta: all("SELECT key, value FROM meta WHERE key IN (?, ?)", `rekeyed.${wt}`, `checkpoint.${wt}`),
};
console.log(JSON.stringify(out, null, 1));
