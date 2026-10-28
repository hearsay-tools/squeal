// Throwaway research probe (row 011-208). Reads cezar's Squeal store read-only and writes
// durations.json: each file-level check's median passing duration since 2026-10-21.
// Usage: node extract.mjs <cezar checkout> <out.json>
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [repo, out] = process.argv.slice(2);
const db = new DatabaseSync(join(repo, ".git/squeal/store.sqlite"), { readOnly: true });
const since = Date.parse("2026-10-21T00:00:00Z");
const rows = db
  .prepare(
    `select c.project project, c.test_path path, r.duration_ms ms from checks c
     join results r on r.check_id = c.id
     where c.kind = 'file' and r.outcome = 'pass' and r.recorded_at >= ?`,
  )
  .all(since);
const by = new Map();
for (const r of rows) {
  const k = `${r.project}\u0000${r.path}`;
  if (!by.has(k)) by.set(k, { project: r.project, path: r.path, ms: [] });
  by.get(k).ms.push(r.ms);
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];
const parityDirs = ["packages/cezar/src/core", "packages/cezar/src/workflows"];
const parity = new Set(
  parityDirs.flatMap((d) =>
    readdirSync(join(repo, d))
      .filter((f) => f.endsWith("-parity.test.ts"))
      .map((f) => `${d}/${f}`),
  ),
);
const files = [...by.values()].map((f) => ({
  project: f.project,
  path: f.path,
  runs: f.ms.length,
  ms: Math.round(median(f.ms)),
  parity: parity.has(f.path),
}));
files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
writeFileSync(out, `${JSON.stringify({ since: "2026-10-21T00:00:00Z", readAt: new Date().toISOString(), files }, null, 1)}\n`);
console.log(`files ${files.length}, parity ${files.filter((f) => f.parity).length} of ${parity.size}`);
