import { DatabaseSync } from "node:sqlite";
const [store, root] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const wt = db.prepare("select id from worktrees where root = ?").get(root).id;
console.log(root, "runs", db.prepare("select count(*) n from runs where worktree_id = ?").get(wt).n, "results", db.prepare("select count(*) n from results where worktree_id = ?").get(wt).n, "revisions", db.prepare("select count(*) n from revisions where worktree_id = ?").get(wt).n);
