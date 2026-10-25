// Throwaway probe (016-27): every daemon incarnation string (`<version>@<startedAt>#<uuid>`) that a
// store's meta rows name, with the meta key it was found in, plus each worktree's registered daemon.
// Read-only. Tells which version each daemon ran.
import { DatabaseSync } from "node:sqlite";
const [file, sinceMs = "0"] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const seen = new Map();
const re = /(\d+\.\d+\.\d+)@(\d{13})(?:#([0-9a-f-]{36}))?/g;
for (const { key, value } of db.prepare("select key, value from meta").all()) {
  for (const m of value.matchAll(re)) {
    if (Number(m[2]) < Number(sinceMs)) continue;
    const wt = key.match(/[0-9a-f]{16}/)?.[0] ?? "?";
    const id = `${m[1]}@${m[2]}`;
    const entry = seen.get(id) ?? { version: m[1], startedAt: new Date(Number(m[2])).toISOString(), keys: new Set(), worktrees: new Set() };
    entry.keys.add(key.replace(/[0-9a-f]{16}/, "<wt>")); entry.worktrees.add(wt);
    seen.set(id, entry);
  }
}
for (const e of [...seen.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)))
  console.log(JSON.stringify({ ...e, keys: [...e.keys], worktrees: [...e.worktrees] }));
for (const r of db.prepare("select id, root, daemon_version v, daemon_started_at s from worktrees where daemon_started_at >= ? order by s").all(Number(sinceMs)))
  console.log(JSON.stringify({ worktree: r.id, root: r.root.replace(/.*worktrees\//, "wt/"), registered: r.v, startedAt: new Date(r.s).toISOString() }));
