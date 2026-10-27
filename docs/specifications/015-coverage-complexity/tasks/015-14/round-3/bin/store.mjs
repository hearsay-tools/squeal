// 015-14 Round 3: a read-only baseline of the shared stores. Opens each store
// with `readOnly: true` and `PRAGMA query_only = 1`, as part-b/bin/q.mjs does.
// Writes one JSON object: file sizes, the coverage table and its shared parts
// (015-85) by stored time, manifest and full records stored since a mark,
// the saved drop notes (015-79, topic `coverage:no-record`), the daemons the
// main store names with their versions, and the code states by measure.
// Usage: node store.mjs <.git/squeal dir> <mark, ISO time> [<hours from, ISO time>]
import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync } from "node:zlib";

const [dir, markIso, hoursIso] = process.argv.slice(2);
const mark = Date.parse(markIso);
const from = Date.parse(hoursIso ?? markIso);
const open = (name) => {
  const db = new DatabaseSync(`${dir}/${name}`, { readOnly: true });
  db.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 5000");
  return db;
};
const num = (v) => (typeof v === "bigint" ? Number(v) : v);
const all = (db, sql, ...args) =>
  db.prepare(sql).all(...args).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)])));
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

const out = { readAt: new Date().toISOString(), dir, mark: markIso, files: {} };
for (const f of ["code.sqlite", "code.sqlite-wal", "store.sqlite", "store.sqlite-wal"]) {
  try {
    const s = statSync(`${dir}/${f}`);
    out.files[f] = { bytes: s.size, mtime: s.mtime.toISOString() };
  } catch {
    out.files[f] = null;
  }
}

const code = open("code.sqlite");
out.code = {
  pages: all(code, "SELECT * FROM pragma_page_count, pragma_page_size, pragma_freelist_count")[0],
  coverage: all(code, `SELECT provider_version, count(*) records, sum(length(record)) bytes,
    min(recorded_at) first, max(recorded_at) last FROM coverage GROUP BY provider_version`),
  parts: all(code, `SELECT count(*) parts, sum(length(part)) bytes, min(used_at) first_used,
    max(used_at) last_used FROM coverage_parts`)[0],
  partsSequence: all(code, "SELECT seq FROM sqlite_sequence WHERE name = 'coverage_parts'")[0]?.seq ?? null,
  byHour: all(code, `SELECT (recorded_at / 3600000) * 3600000 hour, count(*) records, sum(length(record)) bytes
    FROM coverage WHERE recorded_at >= ? GROUP BY hour ORDER BY hour`, from).map((r) => ({ ...r, hour: iso(r.hour) })),
  partsByHour: all(code, `SELECT (used_at / 3600000) * 3600000 hour, count(*) parts, sum(length(part)) bytes
    FROM coverage_parts WHERE used_at >= ? GROUP BY hour ORDER BY hour`, from).map((r) => ({ ...r, hour: iso(r.hour) })),
  states: all(code, `SELECT measure, outcome, count(*) n FROM states GROUP BY measure, outcome ORDER BY measure, outcome`),
  summaries: all(code, "SELECT count(*) n, sum(length(value)) bytes FROM meta WHERE key LIKE 'coverage:%'")[0],
};
for (const c of out.code.coverage) Object.assign(c, { first: iso(c.first), last: iso(c.last) });
for (const k of ["first_used", "last_used"]) out.code.parts[k] = iso(out.code.parts[k]);

// Records stored since the mark: a manifest (015-85) decodes to an object with
// a `parts` array; anything else is a full record of the older form.
const kinds = { manifest: { records: 0, bytes: 0, partRefs: 0 }, full: { records: 0, bytes: 0 }, undecoded: 0 };
for (const r of code.prepare("SELECT record FROM coverage WHERE recorded_at >= ?").iterate(mark)) {
  try {
    const value = JSON.parse(inflateRawSync(r.record).toString("utf8"));
    if (Array.isArray(value.parts)) {
      kinds.manifest.records++;
      kinds.manifest.bytes += r.record.length;
      kinds.manifest.partRefs += value.parts.length;
    } else {
      kinds.full.records++;
      kinds.full.bytes += r.record.length;
    }
  } catch {
    kinds.undecoded++;
  }
}
out.code.sinceMark = kinds;
code.close();

const main = open("store.sqlite");
out.main = {
  results: all(main, "SELECT count(*) results, count(DISTINCT key) keys, min(recorded_at) oldest FROM results")[0],
  worktrees: all(main, `SELECT id, root, is_main, daemon_version, daemon_started_at, daemon_heartbeat_at
    FROM worktrees ORDER BY daemon_heartbeat_at DESC`).map((w) => ({
    ...w,
    daemon_started_at: iso(w.daemon_started_at),
    daemon_heartbeat_at: iso(w.daemon_heartbeat_at),
  })),
  dropNotes: [],
};
out.main.results.oldest = iso(out.main.results.oldest);
for (const n of all(main, "SELECT key, value FROM meta WHERE key LIKE 'notes.%'")) {
  let list = [];
  try {
    list = JSON.parse(n.value);
  } catch {}
  for (const item of Array.isArray(list) ? list : [])
    if (item?.topic === "coverage:no-record") out.main.dropNotes.push({ key: n.key, ...item });
}
main.close();
console.log(JSON.stringify(out, null, 1));
