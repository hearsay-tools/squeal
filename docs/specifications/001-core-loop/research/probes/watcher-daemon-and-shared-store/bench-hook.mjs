// THROWAWAY PROBE. Not product code. See README.md.
// Spawns hook-read.mjs repeatedly per mode; reports wall-clock median and p95 in ms.
import { spawnSync } from 'node:child_process';
const RUNS = Number(process.argv[2] ?? 30);
const res = {};
for (const mode of ['baseline', 'node-sqlite', 'better-sqlite3', 'json']) {
  const t = [];
  let out;
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, ['hook-read.mjs', mode], { encoding: 'utf8' });
    t.push(Number(process.hrtime.bigint() - t0) / 1e6);
    out = r.stdout.trim() + (r.stderr ? ` stderr=${JSON.stringify(r.stderr.slice(0, 80))}` : '');
  }
  t.sort((a, b) => a - b);
  res[mode] = { medianMs: +t[Math.floor(RUNS / 2)].toFixed(1), p95Ms: +t[Math.floor(RUNS * 0.95)].toFixed(1), out };
}
console.log(JSON.stringify({ node: process.version, runs: RUNS, res }, null, 1));
