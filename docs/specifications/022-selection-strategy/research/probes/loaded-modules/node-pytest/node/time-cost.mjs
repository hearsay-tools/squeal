// Throwaway: time `node --test t.test.mjs` in the cost fixture per variant,
// interleaved, REPS rounds; skips a round while the 1-min load > 24.
// Usage: node time-cost.mjs <fixture dir> <probe dir> <squeal recorder.cjs> [reps=10]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
const [fx, probes, recorder, reps = "10"] = process.argv.slice(2);
const variants = {
  base: () => ({}),
  "squeal-recorder(--require, appendFileSync per edge)": (o) => ({ NODE_OPTIONS: `--require ${recorder}`, SQUEAL_NODE_TEST_GRAPH: `${o}/graph` }),
  "sync-hook resolve+load, appendFileSync per edge": (o) => ({ NODE_OPTIONS: `--import ${probes}/hook-sync.mjs`, LM_OUT: o }),
  "sync-hook resolve, in memory, write at exit": (o) => ({ NODE_OPTIONS: `--import ${probes}/hook-sync-memory.mjs`, LM_OUT: o }),
  "async module.register resolve+load": (o) => ({ NODE_OPTIONS: `--import ${probes}/hook-async.mjs`, LM_OUT: o }),
  NODE_V8_COVERAGE: (o) => ({ NODE_V8_COVERAGE: o }),
};
const times = Object.fromEntries(Object.keys(variants).map((k) => [k, []]));
const loads = [];
const counts = {};
for (let r = 0; r < Number(reps); r++) {
  const load = loadavg()[0];
  if (load > 24) { console.error(`round ${r}: load ${load.toFixed(1)} > 24, skipped`); continue; }
  loads.push(load);
  for (const [name, env] of Object.entries(variants)) {
    const o = mkdtempSync(`${tmpdir()}/lm-cost-`);
    const t0 = performance.now();
    const res = spawnSync(process.execPath, ["--no-warnings", "--test", "--test-reporter=dot", "t.test.mjs"], { cwd: fx, env: { ...process.env, ...env(o) }, encoding: "utf8" });
    const ms = performance.now() - t0;
    if (res.status !== 0) throw new Error(`${name}: exit ${res.status} ${res.stderr}`);
    times[name].push(ms);
    counts[name] = readdirSync(o).length;
    rmSync(o, { recursive: true, force: true });
  }
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const base = med(times.base);
console.log(`node ${process.version}; rounds ${loads.length}; 1-min load per round: ${loads.map((l) => l.toFixed(1)).join(" ")}`);
console.log("| variant | median ms | min ms | max ms | vs base | output files |");
console.log("|---|---|---|---|---|---|");
for (const [k, a] of Object.entries(times)) console.log(`| ${k} | ${med(a).toFixed(0)} | ${Math.min(...a).toFixed(0)} | ${Math.max(...a).toFixed(0)} | ${((med(a) / base - 1) * 100).toFixed(0)}% | ${counts[k] ?? "-"} |`);
