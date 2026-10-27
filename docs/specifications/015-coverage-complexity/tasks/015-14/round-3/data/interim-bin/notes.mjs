// 015-14 Round 3 interim: the saved coverage drop notes (015-79, topic
// `coverage:no-record`) of every worktree, read only. A worktree's notes are
// the main store's meta row `notes.<worktree id>` (types/store.ts, prefix
// "notes."); round-3/bin/store.mjs read `notes:%`, which matches no row, so its
// `dropNotes` was empty whatever the store held. Each note gives its daemon's
// total since that daemon started; the topic keeps 3 notes. A note is matched
// to a daemon a reading recorded when it falls between that daemon's start and
// its last heartbeat seen. Removing a worktree deletes its notes.
// Usage: node notes.mjs <.git/squeal dir> <mark, ISO> <reading.json>...
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const [dir, markIso, ...readings] = process.argv.slice(2);
const db = new DatabaseSync(`${dir}/store.sqlite`, { readOnly: true });
db.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 5000");
const names = new Map();
const daemons = new Map();
for (const f of readings) {
  for (const w of JSON.parse(readFileSync(f, "utf8")).main.worktrees) {
    names.set(w.id, w.root.split("/").at(-1).slice(0, 8));
    if (!w.daemon_started_at) continue;
    const list = daemons.get(w.id) ?? [];
    const start = Date.parse(w.daemon_started_at);
    const seen = Date.parse(w.daemon_heartbeat_at ?? w.daemon_started_at);
    const d = list.find((x) => x.start === start);
    if (d) d.seen = Math.max(d.seen, seen);
    else list.push({ start, seen, version: w.daemon_version });
    daemons.set(w.id, list);
  }
}
const mark = Date.parse(markIso);
const iso = (ms) => new Date(Number(ms)).toISOString();
const out = { readAt: new Date().toISOString(), mark: markIso, worktreesWithNotes: 0, worktrees: [] };
for (const row of db.prepare("SELECT key, value FROM meta WHERE key LIKE 'notes.%'").all()) {
  out.worktreesWithNotes++;
  const id = row.key.slice("notes.".length);
  const drops = JSON.parse(row.value).filter((n) => n.topic === "coverage:no-record");
  if (drops.length === 0) continue;
  out.worktrees.push({
    worktree: id, name: names.get(id) ?? null,
    notes: drops.map((n) => {
      const d = (daemons.get(id) ?? []).find((x) => x.start <= n.at && n.at <= x.seen + 120_000);
      return { at: iso(n.at), sinceMark: n.at >= mark, revision: n.revision,
        total: Number(/coverage: (\d+) completed/.exec(n.text)?.[1] ?? NaN),
        causes: Object.fromEntries([...n.text.matchAll(/(\d+) (no-result|map-error|store-open|store-error|busy|closed) \(/g)].map((m) => [m[2], Number(m[1])])),
        daemon: d ? { start: iso(d.start), version: d.version } : null, text: n.text.slice(0, 300) };
    }),
  });
}
console.log(JSON.stringify(out, null, 1));
