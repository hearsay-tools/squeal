// Throwaway, row 005-110. On a store COPY in this task's scratch directory only: replays "the session
// registered before the worktree had results" (task d9416fae: SessionStart said revision 0, no results;
// the daemon then wrote 141,500 rows in commitFirst). `hide` moves the worktree's known states into a
// side table (the delete trigger drops their birth marks); `restore` inserts them back, so the insert
// trigger gives them birth marks above the mark a registration made in between.
// Usage: node first-results.mjs <copy store.sqlite> <worktree id> hide|restore
import { DatabaseSync } from "node:sqlite";
const [path, worktree, step] = process.argv.slice(2);
if (!path.includes("/t/cd01ba62/")) throw new Error("refusing: not a scratch copy");
const db = new DatabaseSync(path);
db.exec("PRAGMA busy_timeout = 10000");
const t0 = performance.now();
db.exec("BEGIN IMMEDIATE");
if (step === "hide") {
  db.exec("DROP TABLE IF EXISTS probe_hidden_states");
  db.prepare("CREATE TABLE probe_hidden_states AS SELECT * FROM known_states WHERE worktree_id = ?").run(worktree);
  db.prepare("DELETE FROM known_states WHERE worktree_id = ?").run(worktree);
} else {
  db.exec("INSERT INTO known_states SELECT * FROM probe_hidden_states");
  db.exec("DROP TABLE probe_hidden_states");
}
db.exec("COMMIT");
const n = db.prepare("SELECT count(*) n FROM known_states WHERE worktree_id = ?").get(worktree).n;
const born = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'state_born'").get()?.seq ?? null;
console.log(JSON.stringify({ step, worktree, knownStates: n, highBirthMark: born, ms: Math.round(performance.now() - t0) }));
db.close();
