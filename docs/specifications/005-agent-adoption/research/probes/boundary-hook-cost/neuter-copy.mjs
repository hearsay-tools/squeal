// Throwaway, row 005-110. On a store COPY in this task's scratch directory only: rewrites every
// worktrees.daemon_socket to a path that does not exist, so no hook code run on the copy reaches a
// live daemon (its writes are made in the copy), and lists the socket and heartbeat columns after.
// Usage: node neuter-copy.mjs <scratch>/<repo>/squeal/store.sqlite
import { DatabaseSync } from "node:sqlite";
const [path] = process.argv.slice(2);
if (!path.includes("/t/cd01ba62/")) throw new Error("refusing: not a scratch copy");
const db = new DatabaseSync(path);
const r = db.prepare("UPDATE worktrees SET daemon_socket = '/nonexistent/probe-005-110/' || id || '.sock' WHERE daemon_socket IS NOT NULL").run();
const live = db.prepare("SELECT count(*) n FROM worktrees WHERE daemon_socket IS NOT NULL AND daemon_socket NOT LIKE '/nonexistent/%'").get();
console.log(JSON.stringify({ path, rewritten: r.changes, notRewritten: live.n }));
db.close();
