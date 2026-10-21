// Prints the worktree row of P6's scratch store through a read-only connection.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
const [path, id] = process.argv.slice(2);
if (!existsSync(path)) { console.log("store: none"); process.exit(0); }
const db = new DatabaseSync(path, { readOnly: true });
const w = db.prepare("SELECT daemon_socket, daemon_started_at, daemon_heartbeat_at, daemon_heartbeat_interval_ms, daemon_version FROM worktrees WHERE id = ?").get(id);
const exit = db.prepare("SELECT value FROM meta WHERE key = ?").get(`daemon-exit:${id}`);
const now = Date.now();
console.log(`row: socket=${w?.daemon_socket ? "set" : "null"} version=${w?.daemon_version} heartbeatAgeMs=${w ? now - w.daemon_heartbeat_at : "-"} intervalMs=${w?.daemon_heartbeat_interval_ms} exitMark=${exit ? "yes" : "no"}`);
db.close();
