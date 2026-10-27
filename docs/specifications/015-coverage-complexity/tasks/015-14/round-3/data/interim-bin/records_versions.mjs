// 015-14 Round 3 interim: coverage records stored since a mark, by the run
// that made each one and the daemon version of that run, read only.
// A record's producer is the result at its key recorded last at or before the
// record (its run and worktree). The run's daemon version is proven when one
// of the given store readings (store.mjs outputs) recorded a daemon of that
// worktree that started at or before the run and was still heartbeating at
// its start (2 minutes of slack). Otherwise the version is not recorded, and
// the bound from the plugin cache births is given: every daemon running after
// the host restart (2026-10-27T08:22:29Z) started then or later, when both
// caches held 0.1.366; 0.1.367 reached the Claude Code cache at 11:40:33Z.
// A daemon run from a worktree's own build is not excluded by that bound.
// Usage: node records_versions.mjs <.git/squeal dir> <mark, ISO> <reading.json>...
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const RESTART = Date.parse("2026-10-27T08:22:29Z");
const V367_CACHE = Date.parse("2026-10-27T11:40:33Z");
const SLACK = 120_000;
const [dir, markIso, ...readings] = process.argv.slice(2);
const open = (name) => {
  const db = new DatabaseSync(`${dir}/${name}`, { readOnly: true });
  db.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 5000");
  return db;
};
const daemons = new Map();
const names = new Map();
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
const code = open("code.sqlite");
const main = open("store.sqlite");
const results = main.prepare("SELECT worktree_id, run_id, recorded_at FROM results WHERE key = ?");
const runs = main.prepare("SELECT started_at, checkpoint_id, revision, end_state FROM runs WHERE id = ?");
const iso = (ms) => new Date(Number(ms)).toISOString();

function version(wt, at) {
  const list = (daemons.get(wt) ?? []).filter((d) => d.start <= at && at <= d.seen + SLACK);
  if (list.length) return { version: list.at(-1).version, proof: "recorded daemon" };
  const bound = at < RESTART ? "before the restart" : at < V367_CACHE ? "0.1.366 by cache births" : "0.1.366 or 0.1.367";
  return { version: null, proof: names.has(wt) ? `earlier daemon not recorded; ${bound}` : `worktree in no reading; ${bound}` };
}

const groups = {};
const hours = {};
let n = 0;
for (const r of code.prepare("SELECT result_key, record, recorded_at FROM coverage WHERE recorded_at >= ?").iterate(Date.parse(markIso))) {
  n++;
  const at = Number(r.recorded_at);
  const form = Array.isArray(JSON.parse(inflateRawSync(r.record).toString("utf8")).parts) ? "manifest" : "full";
  const made = results.all(r.result_key).map((m) => ({ ...m, recorded_at: Number(m.recorded_at) }));
  const before = made.filter((m) => m.recorded_at <= at).sort((a, b) => b.recorded_at - a.recorded_at);
  const p = before[0] ?? made.sort((a, b) => Math.abs(a.recorded_at - at) - Math.abs(b.recorded_at - at))[0];
  const run = p ? runs.get(p.run_id) : null;
  const v = p ? version(p.worktree_id, run ? Number(run.started_at) : p.recorded_at) : { version: null, proof: "no result at its key" };
  const wt = p ? p.worktree_id : null;
  const key = `${wt} ${v.version} ${v.proof} ${form}`;
  const g = (groups[key] ??= { worktree: wt, name: names.get(wt) ?? null, version: v.version, proof: v.proof, form,
    records: 0, bytes: 0, first: null, last: null, runs: new Set(), checkpointRuns: new Set(), revisions: new Set() });
  g.records++;
  g.bytes += r.record.length;
  g.first = g.first && g.first < iso(at) ? g.first : iso(at);
  g.last = g.last && g.last > iso(at) ? g.last : iso(at);
  if (p) {
    g.runs.add(p.run_id);
    if (run?.checkpoint_id) g.checkpointRuns.add(p.run_id);
    g.revisions.add(run?.revision ?? null);
  }
  const h = `${iso(at).slice(0, 13)}:00Z ${v.version ?? "not recorded"}`;
  hours[h] = (hours[h] ?? 0) + 1;
}
console.log(JSON.stringify({
  mark: markIso, readAt: new Date().toISOString(), records: n,
  daemons: Object.fromEntries([...daemons].map(([k, l]) => [names.get(k) ?? k, l.map((d) => ({ start: iso(d.start), seen: iso(d.seen), version: d.version }))])),
  groups: Object.values(groups).sort((a, b) => b.records - a.records).map((g) => ({ ...g, runs: g.runs.size, checkpointRuns: g.checkpointRuns.size, revisions: g.revisions.size })),
  byHour: hours,
}, null, 1));
