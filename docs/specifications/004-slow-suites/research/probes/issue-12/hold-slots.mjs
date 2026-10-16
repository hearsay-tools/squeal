// Issue 12 probe (throwaway): hold every slow-slot permit in <dir> for <ms>, as
// another worktree's slow tier would, so this fixture's slow files wait for a slot.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
const [dir, ms, count] = process.argv.slice(2);
const held = [];
for (let i = 0; i < Number(count); i++) {
  const db = new DatabaseSync(join(dir, i === 0 ? "slow.lock" : `slow.${i}.lock`));
  db.exec("PRAGMA busy_timeout = 0");
  db.exec("PRAGMA locking_mode = EXCLUSIVE");
  db.exec("BEGIN EXCLUSIVE");
  held.push(db);
}
console.log(`${new Date().toISOString().slice(11, 19)} slots: ${held.length} permit(s) held for ${ms} ms`);
setTimeout(() => {
  for (const db of held) db.close();
  console.log(`${new Date().toISOString().slice(11, 19)} slots: released`);
}, Number(ms));
