// Throwaway probe (row 011-408): stands in for a late daemon on a COPIED store, with no Squeal daemon.
// It writes a fresh heartbeat on the copy's worktree row, then listens on the scratch socket and never answers.
// usage: node late-daemon.mjs <copy.sqlite> <worktreeId> <socketPath> <seconds>
import { unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
const [file, id, socket, seconds] = process.argv.slice(2);
if (!file.includes("/t/") || !socket.includes("/t/")) throw new Error("scratch paths only");
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = 5000");
// A new start time is a new incarnation: the copied exit note of the old daemon does not name it.
const startedAt = Date.now();
const beat = () =>
  db.prepare("UPDATE worktrees SET daemon_socket = ?, daemon_heartbeat_interval_ms = 5000, daemon_started_at = ?, daemon_heartbeat_at = ? WHERE id = ?").run(socket, startedAt, Date.now(), id);
beat();
const timer = setInterval(beat, 1000);
try { unlinkSync(socket); } catch {}
const held = [];
const server = createServer((c) => { held.push(c); c.on("error", () => {}); }).listen(socket, () => console.log("listening"));
setTimeout(() => { clearInterval(timer); server.close(); for (const c of held) c.destroy(); db.prepare("UPDATE worktrees SET daemon_socket = NULL WHERE id = ?").run(id); db.close(); try { unlinkSync(socket); } catch {} }, Number(seconds) * 1000);
