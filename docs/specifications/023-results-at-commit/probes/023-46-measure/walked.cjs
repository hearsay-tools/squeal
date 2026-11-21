// Usage: node walked.cjs <db> <tree> <since ms>: the commit tree's keys (count, digest), walk rows since.
const { DatabaseSync } = require("node:sqlite");
const { createHash } = require("node:crypto");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const tree = process.argv[3], since = Number(process.argv[4]);
const wt = db.prepare("SELECT id FROM worktrees WHERE root = ?").get(tree);
const rows = wt ? db.prepare("SELECT project, path, key FROM test_file_keys WHERE worktree_id = ? ORDER BY project, path").all(wt.id) : [];
const digest = createHash("sha256").update(rows.map((r) => `${r.project}\0${r.path}\0${r.key}`).join("\n")).digest("hex").slice(0, 16);
const walks = db.prepare("SELECT count(*) n FROM test_file_imports WHERE recorded_at >= ?").get(since).n;
console.log(JSON.stringify({ keyed: rows.filter((r) => r.key !== null).length, keys: digest, walkRowsSince: walks }));
