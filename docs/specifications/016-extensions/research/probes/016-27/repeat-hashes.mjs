// Throwaway probe (016-27), question 2: for each revision of one worktree, whether each changed path's
// new hash already appeared earlier in that worktree's revisions (a return to known content, whose
// keys may hold stored results). Read-only. Usage: node repeat-hashes.mjs <store> <worktreeId> <revision>...
import { DatabaseSync } from "node:sqlite";
const [file, wt, ...numbers] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const revs = db.prepare("select number, changes from revisions where worktree_id = ? order by number").all(wt);
const seen = new Map();
for (const r of revs) {
  const changes = JSON.parse(r.changes);
  if (numbers.includes(String(r.number)))
    console.log(r.number, changes.map((c) => `${c.path} ${seen.get(`${c.path} ${c.newHash}`) === undefined ? "new" : `seen at ${seen.get(`${c.path} ${c.newHash}`)}`}`).join("; "));
  for (const c of changes) { if (c.oldHash) seen.set(`${c.path} ${c.oldHash}`, seen.get(`${c.path} ${c.oldHash}`) ?? `before ${r.number}`); seen.set(`${c.path} ${c.newHash}`, r.number); }
}
