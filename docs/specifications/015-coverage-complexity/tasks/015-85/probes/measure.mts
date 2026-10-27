// Row 015-85: stored bytes and main-thread cost of whole records (0.1.362) against shared parts.
// Reads the newest N records of a code store read-only, in the order they were stored, and stores
// each again in two scratch stores: `put` of the whole record as the writer did, and `putParts` of
// its parts as it does now. Times each write, each `get` with `decodeRecord` (the CRAP step's read),
// the parts' hash and compression (the mapping worker's share) and one prune's mark. Usage, from
// the repository root:
//   npx tsx docs/specifications/015-coverage-complexity/tasks/015-85/probes/measure.mts \
//     "$PWD" <code.sqlite to read> <scratch dir> 600
import { mkdirSync, rmSync, statSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [repo, source, scratch, countArg] = process.argv.slice(2) as [string, string, string, string];
const { decodeRecord, encodeRecord, COVERAGE_PROVIDER_VERSION } = await import(
  join(repo, "src/core/code/coverage/record.ts")
);
const { shareRecord } = await import(join(repo, "src/core/code/coverage/parts.ts"));
const { openCodeStore } = await import(join(repo, "src/core/code/store/open.ts"));
const { markParts } = await import(join(repo, "src/core/code/store/parts.ts"));
const { Connection } = await import(join(repo, "src/core/store/connection.ts"));

const load = () => loadavg().map((l) => l.toFixed(1)).join(" ");
const loadBefore = load();

const read = new DatabaseSync(source, { readOnly: true });
read.exec("PRAGMA busy_timeout = 5000");
const keys = read
  .prepare("SELECT result_key, recorded_at FROM coverage INDEXED BY coverage_stored WHERE provider_version = ?")
  .all(COVERAGE_PROVIDER_VERSION)
  .sort((a, b) => Number(b.recorded_at) - Number(a.recorded_at))
  .slice(0, Number(countArg))
  .reverse();
const get = read.prepare("SELECT record FROM coverage WHERE result_key = ? AND provider_version = ?");
const records = keys.map((k) => ({
  key: String(k.result_key),
  at: Number(k.recorded_at),
  record: decodeRecord(get.get(k.result_key, COVERAGE_PROVIDER_VERSION)?.record as Uint8Array),
}));
read.close();

rmSync(scratch, { recursive: true, force: true });
const open = (name: string) => {
  const dir = join(scratch, name);
  mkdirSync(join(dir, "squeal"), { recursive: true });
  const store = openCodeStore(dir, { complexity: { enabled: true } } as never);
  if ("reason" in store) throw new Error(JSON.stringify(store));
  return store;
};
const whole = open("whole");
const shared = open("shared");

/** Main-thread wall time, in ms, of `fn`. */
function timed<T>(fn: () => T): [T, number] {
  const began = performance.now();
  const value = fn();
  return [value, performance.now() - began];
}
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const total = sorted.reduce((a, b) => a + b, 0);
  return { median: +at(0.5).toFixed(3), p95: +at(0.95).toFixed(3), max: +at(1).toFixed(3), total: +total.toFixed(1) };
};

const key = (k: string) => ({ resultKey: k, providerVersion: COVERAGE_PROVIDER_VERSION });
const wholeWrite: number[] = [];
const sharedWrite: number[] = [];
const sharing: number[] = [];
for (const { key: k, at, record } of records) {
  const bytes = encodeRecord(record); // the mapping worker's share before 015-85
  wholeWrite.push(timed(() => whole.coverage.put(key(k), bytes, at))[1]);
  const [parts, made] = timed(() => shareRecord(record, COVERAGE_PROVIDER_VERSION));
  sharing.push(made);
  sharedWrite.push(timed(() => shared.coverage.putParts(key(k), parts, at))[1]);
}

const wholeRead: number[] = [];
const sharedRead: number[] = [];
let differ = 0;
for (const { key: k, record } of records) {
  const [a, ta] = timed(() => decodeRecord(whole.coverage.get(key(k)) as Uint8Array));
  const [b, tb] = timed(() => decodeRecord(shared.coverage.get(key(k)) as Uint8Array));
  wholeRead.push(ta);
  sharedRead.push(tb);
  if (JSON.stringify(a) !== JSON.stringify(record) || JSON.stringify(b) !== JSON.stringify(record)) {
    differ++;
  }
}

/** Bytes on disk after a checkpoint, and the bytes of each table's payload. */
function size(store: { path: string; close(): void }, tables: string) {
  store.close();
  const db = new DatabaseSync(store.path);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const payload = Number(db.prepare(tables).get()?.n ?? 0);
  const parts = db.prepare("SELECT count(*) AS n FROM coverage_parts").get()?.n;
  db.close();
  return { fileBytes: statSync(store.path).size, payloadBytes: payload, partRows: Number(parts) };
}

// One prune's mark with every record kept past the retention: the most it reads.
const mark = (path: string) => {
  const conn = new Connection(new DatabaseSync(path));
  const [marked, ms] = timed(() => markParts(conn, Number.MAX_SAFE_INTEGER));
  conn.close();
  return { ms: +ms.toFixed(1), marked: marked.size };
};
const wholePath = whole.path;
const sharedPath = shared.path;
const wholeSize = size(whole, "SELECT sum(length(record)) AS n FROM coverage");
const sharedSize = size(
  shared,
  "SELECT (SELECT sum(length(record)) FROM coverage) + (SELECT sum(length(part)) FROM coverage_parts) AS n",
);

console.log(
  JSON.stringify(
    {
      records: records.length,
      spanMinutes: +((records.at(-1)?.at ?? 0) - (records[0]?.at ?? 0)) / 60_000,
      readBackDiffer: differ,
      whole: { ...wholeSize, writeMs: stats(wholeWrite), readMs: stats(wholeRead), mark: mark(wholePath) },
      shared: {
        ...sharedSize,
        writeMs: stats(sharedWrite),
        readMs: stats(sharedRead),
        mark: mark(sharedPath),
        workerShareMs: stats(sharing),
      },
      load: { before: loadBefore, after: load() },
    },
    null,
    1,
  ),
);
