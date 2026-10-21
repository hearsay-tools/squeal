// 011-82 probe: in a cancelled tier that Vitest ran longest first, how many
// files the same file-seconds would have ended shortest first. Read-only.
// Usage: node reversed.mjs <store.sqlite> <runs-dir> <tiers.json from tiers.mjs>
// A tier is reversed when its modules ended in the opposite of the pick order
// (Spearman rho of end rank against pick position below -0.3), in order when
// above 0.3. F, the last-known seconds of the files that ended, spent on the
// tier's files shortest first ends k files: a floor, since it gives the
// shortest-first order none of the in-flight work the longest-first one lost.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [, , store, runsDir, tiersJson] = process.argv;
const db = new DatabaseSync(store, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
const id = (r) => `${r.project}\u0000${r.path}`;
const seen = new Map();
for (const d of readdirSync(runsDir)) {
  const p = join(runsDir, d, "report.json");
  if (!existsSync(p)) continue;
  try {
    for (const f of JSON.parse(readFileSync(p, "utf8")).report.fileDurations ?? []) {
      const list = seen.get(id(f.testFile)) ?? [];
      list.push(f.durationMs);
      seen.set(id(f.testFile), list);
    }
  } catch {}
}
const known = (k) => {
  const v = seen.get(k);
  if (!v) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const tiers = JSON.parse(readFileSync(tiersJson, "utf8")).rows.filter(
  (t) => t.files >= 13 && t.report && t.cancelled && t.cause !== "squeal stop",
);
const runs = new Map(
  db
    .prepare("SELECT id, test_files FROM runs WHERE started_at >= ?")
    .all(Date.now() - 48 * 3600e3)
    .map((r) => [r.id.slice(0, 8), r]),
);
const out = { reversed: [], inOrder: [], mixed: [] };
for (const t of tiers) {
  const run = runs.get(t.id);
  const log = join(runsDir, run.id, "vitest.log");
  if (!existsSync(log)) continue;
  const files = JSON.parse(run.test_files);
  // `MODULE <state> <label>`, the label `[project] path` or `path` (`testFileLabel`).
  const order = files.map((f) => (f.project ? `[${f.project}] ${f.path}` : f.path));
  const ends = readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.startsWith("MODULE "))
    .map((l) => order.indexOf(l.split(" ").slice(2).join(" ")))
    .filter((i) => i >= 0);
  if (ends.length < 3) {
    out.mixed.push({ files: t.files, ended: ends.length, stored: t.storedEnded, k: null });
    continue;
  }
  const n = ends.length;
  const byPos = [...ends].map((p, rank) => ({ p, rank })).sort((a, b) => a.p - b.p);
  let d2 = 0;
  byPos.forEach(({ rank }, i) => (d2 += (rank - i) ** 2));
  const rho = 1 - (6 * d2) / (n * (n * n - 1));
  const F = ends.reduce((a, i) => a + (known(id(files[i])) ?? 0), 0);
  const asc = files.map((f) => known(id(f)) ?? 0).sort((a, b) => a - b);
  let k = 0;
  for (let acc = 0; k < asc.length && acc + asc[k] <= F; k++) acc += asc[k];
  const row = { files: t.files, wallS: t.wallS, ended: n, stored: t.storedEnded, rho: Math.round(rho * 100) / 100, k };
  (rho < -0.3 ? out.reversed : rho > 0.3 ? out.inOrder : out.mixed).push(row);
}
const sum = (list) => ({
  tiers: list.length,
  files: list.reduce((a, r) => a + r.files, 0),
  ended: list.reduce((a, r) => a + r.ended, 0),
  stored: list.reduce((a, r) => a + r.stored, 0),
  shortestFirstFloor: list.reduce((a, r) => a + (r.k ?? r.ended), 0),
});
console.log(JSON.stringify({ store, reversed: sum(out.reversed), inOrder: sum(out.inOrder), mixed: sum(out.mixed) }));
