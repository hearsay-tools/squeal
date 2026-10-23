#!/usr/bin/env node
// Row 009-31: one row per fresh worker from fresh-probe.test.ts's JSON lines, then
// each phase's p50, p95 and max. Usage: node analyze.mjs <file.jsonl>... [--rows | --csv]
// [--load <min>-<max>] (--csv prints only the rows, as CSV, for data/; --load keeps the
// workers whose one-minute load before the run is in that range).
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const rowsWanted = args.includes("--rows");
const csv = args.includes("--csv");
const range = args.includes("--load") ? args[args.indexOf("--load") + 1].split("-").map(Number) : null;
const inRange = (m) => range === null || (m.loadBefore >= range[0] && m.loadBefore <= range[1]);
const lines = args
  .filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--load")
  .flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean))
  .map((l) => JSON.parse(l))
  .filter(inRange);

const ms = (cpu) => (cpu.user + cpu.system) / 1000;
const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : Number.NaN);

const rows = lines
  .filter((m) => !m.plain && m.probes?.length >= 1)
  .map((m) => {
    const [p, warm] = m.probes;
    const boot = p.js - m.ctor1;
    const load = p.evaluated - p.js;
    const handle = p.answered - p.received;
    return {
      env: m.minEnv ? "min" : "full",
      live: m.stop ? "one" : "all",
      label: m.label,
      run: m.run,
      total: r1(m.total),
      ctor: r1(m.ctor1 - m.ctor0),
      boot: r1(boot),
      bootCpu: r1(ms(p.cpuJs)),
      load: r1(load),
      loadCpu: r1(ms(p.cpuEvaluated) - ms(p.cpuJs)),
      queue: r1(p.received - p.evaluated),
      handle: r1(handle),
      handleCpu: r1(ms(p.cpu) - ms(p.cpuEvaluated)),
      back: r1(p.at - p.answered),
      host: r1(m.total - (m.done - m.ctor0) + (m.done - p.at)),
      waited: r1(m.total - ms(p.cpu)),
      warmHandle: r1(warm === undefined ? Number.NaN : warm.answered - warm.received),
      warm: r1(m.warm),
      load1: m.loadBefore,
      psi10: m.psiBefore,
    };
  });

const plain = lines.filter((m) => m.plain);

if (csv) {
  const keys = Object.keys(rows[0] ?? {});
  console.log(keys.join(","));
  for (const r of rows) console.log(keys.map((k) => r[k]).join(","));
  for (const m of plain) {
    console.log(`${m.minEnv ? "min" : "full"},${m.stop ? "one" : "all"},${m.label},${m.run},${r1(m.total)},plain`);
  }
  process.exit(0);
}

if (rowsWanted) console.table(rows);

const pct = (xs, q) => {
  const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : s[Math.ceil(s.length * q) - 1];
};
const cols = [
  "total",
  "ctor",
  "boot",
  "bootCpu",
  "load",
  "loadCpu",
  "queue",
  "handle",
  "handleCpu",
  "back",
  "host",
  "waited",
  "warmHandle",
  "warm",
  "load1",
  "psi10",
];
const groups = [...new Set(rows.map((r) => `${r.env} environment, ${r.live} live`))].sort();
for (const group of groups) {
  const some = rows.filter((r) => `${r.env} environment, ${r.live} live` === group);
  if (some.length === 0) continue;
  const summary = cols.map((c) => {
    const xs = some.map((r) => r[c]);
    return { phase: c, p50: pct(xs, 0.5), p95: pct(xs, 0.95), max: pct(xs, 1) };
  });
  console.log(`${group}: ${some.length} fresh workers (wrapped)`);
  console.table(summary);
  const over = some.filter((r) => r.total >= 80);
  console.log(`${over.length} of ${some.length} at or over 80 ms`);
  if (over.length) console.table(over);
  const totals = plain
    .filter((m) => `${m.minEnv ? "min" : "full"} environment, ${m.stop ? "one" : "all"} live` === group)
    .map((m) => r1(m.total));
  if (totals.length) {
    const n = totals.filter((t) => t >= 80).length;
    console.log(
      `plain worker.mjs, ${totals.length}: p50 ${pct(totals, 0.5)} p95 ${pct(totals, 0.95)} ` +
        `max ${pct(totals, 1)}, ${n} at or over 80 ms`,
    );
  }
}
