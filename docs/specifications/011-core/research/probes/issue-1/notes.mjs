// Throwaway probe (row 011-249). Reads a COPY of a Squeal store and prints
// every persisted note as one JSON line: worktree, time, revision, text, exitOf.
// Usage: node notes.mjs <copied store.sqlite> > notes.jsonl
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const roots = new Map(db.prepare("select id, root from worktrees").all().map((r) => [r.id, r.root]));
const meta = (key) => db.prepare("select value from meta where key = ?").get(key)?.value;
for (const { key, value } of db.prepare("select key, value from meta where key like 'notes.%'").all()) {
  const id = key.slice("notes.".length);
  let list;
  try { list = JSON.parse(value); } catch { continue; }
  if (!Array.isArray(list)) continue;
  for (const n of list) {
    console.log(JSON.stringify({
      wt: id, root: roots.get(id) ?? null, at: n.at, iso: new Date(n.at).toISOString(),
      revision: n.revision, text: String(n.text).slice(0, 300), exitOf: n.exitOf ?? null,
      harness: meta(`harness-process:${id}`)?.slice(0, 200) ?? null,
    }));
  }
}
for (const r of db.prepare("select id, root, daemon_started_at, daemon_version, daemon_heartbeat_at from worktrees").all())
  console.log(JSON.stringify({ wt: r.id, root: r.root, current: true, startedAt: r.daemon_started_at, version: r.daemon_version, heartbeat: r.daemon_heartbeat_at, exit: meta(`daemon-exit:${r.id}`) ?? null }));
