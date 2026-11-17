// Throwaway probe for row 005-99 (see README.md). Read-only. For each daemon process that
// reached "serving" since SINCE: its start time (first line to serving) and the long writes
// (held 250 ms or more, spec 021 D3) it logged before serving, grouped by writer.
// Usage: node start-writes.mjs <repo-dir>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SINCE = Date.parse(process.env.SINCE ?? "2026-11-14T00:00:00Z");
const LINE = /^(\S+) \[(\d+)\] squeal daemon: (.*)$/;
const WRITE = /^long write: store\.sqlite write lock held (\d+) ms by (\S+) < (\S+)(?: < (\S+))?; (\d+) rows written/;
const dir = join(process.argv[2], ".git/squeal/logs");
const starts = [];
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".log")) continue;
  const pids = new Map();
  for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
    const m = LINE.exec(line);
    if (m === null) continue;
    const at = Date.parse(m[1]);
    let p = pids.get(m[2]);
    if (p === undefined) pids.set(m[2], (p = { first: at, serving: null, writes: [] }));
    if (p.serving !== null) continue;
    if (m[3].startsWith("serving ")) p.serving = at;
    const w = WRITE.exec(m[3]);
    if (w !== null) p.writes.push({ ms: Number(w[1]), by: [w[2], w[3], w[4]].join("<"), rows: Number(w[5]) });
  }
  for (const p of pids.values()) if (p.serving !== null && p.first >= SINCE) starts.push(p);
}
const pct = (xs, q) => (xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)]);
const commit = starts.map((p) => p.writes.filter((w) => w.by.includes("commitFirst")).reduce((s, w) => s + w.rows, 0));
const closures = starts.map((p) => p.writes.filter((w) => w.by.startsWith("storeClosures")).reduce((s, w) => s + w.rows, 0));
const held = starts.map((p) => p.writes.reduce((s, w) => s + w.ms, 0));
console.log(JSON.stringify({
  repo: process.argv[2].split("/").pop(),
  starts: starts.length,
  firstToServingMedS: pct(starts.map((p) => (p.serving - p.first) / 1000), 0.5),
  firstToServingP90S: pct(starts.map((p) => (p.serving - p.first) / 1000), 0.9),
  withCommitFirst: commit.filter((n) => n > 0).length,
  commitRowsMed: pct(commit.filter((n) => n > 0), 0.5),
  withClosures: closures.filter((n) => n > 0).length,
  closureRowsMed: pct(closures.filter((n) => n > 0), 0.5),
  lockHeldMsMed: pct(held, 0.5),
  lockHeldMsP90: pct(held, 0.9),
}));
