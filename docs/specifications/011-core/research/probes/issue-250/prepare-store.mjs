// Throwaway probe (row 011-408). Rewrites ONE worktree of a COPIED store so a
// scratch clone at another path reads it as its own. Run only on a copy.
// usage: node prepare-store.mjs <copy.sqlite> <oldWorktreeId> <newRoot>
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [file, oldId, newRootArg] = process.argv.slice(2);
if (!file.includes("/t/") && !file.includes("/tmp/")) throw new Error(`refusing a non-scratch path: ${file}`);
const newRoot = realpathSync(newRootArg);
const newId = createHash("sha256").update(newRoot).digest("hex").slice(0, 16);
const db = new DatabaseSync(file);
const tables = db
  .prepare("SELECT m.name AS t FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type = 'table' AND p.name = 'worktree_id'")
  .all()
  .map((r) => r.t);
db.exec("BEGIN");
for (const t of tables) {
  const r = db.prepare(`UPDATE ${t} SET worktree_id = ? WHERE worktree_id = ?`).run(newId, oldId);
  console.log(t, r.changes);
}
const w = db
  .prepare("UPDATE worktrees SET id = ?, root = ?, common_dir = ? WHERE id = ?")
  .run(newId, newRoot, join(newRoot, ".git"), oldId);
console.log("worktrees", w.changes);
let moved = 0;
for (const { key } of db.prepare("SELECT key FROM meta WHERE instr(key, ?) > 0").all(oldId)) {
  const next = key.replaceAll(oldId, newId);
  // The store's own triggers already wrote a change marker under the new id.
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(next) !== undefined) db.prepare("DELETE FROM meta WHERE key = ?").run(key);
  else db.prepare("UPDATE meta SET key = ? WHERE key = ?").run(next, key);
  moved++;
}
console.log("meta keys", moved);
// No socket of any worktree is ever dialled: a status sync dials only the socket its row names.
const s = db.prepare("UPDATE worktrees SET daemon_socket = NULL").run();
console.log("sockets cleared", s.changes);
db.exec("COMMIT");
db.close();
console.log(JSON.stringify({ newId, newRoot, dir: dirname(file) }));
