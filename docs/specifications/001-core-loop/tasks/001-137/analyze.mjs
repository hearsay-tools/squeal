// Task 001-137 evidence, not product code: summarizes <label>-<pair>-<mode>.json
// from rounds.sh. Usage: node analyze.mjs <dir> <label>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, label] = process.argv.slice(2);
const runs = readdirSync(dir)
  .map((f) => new RegExp(`^${label}-(\\d+)-(on|off)\\.json$`).exec(f))
  .filter(Boolean)
  .map((m) => ({ pair: Number(m[1]), mode: m[2], ...JSON.parse(readFileSync(join(dir, m[0]), "utf8")) }))
  .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
const short = (f) => f.replace("packages/cezar/src/", "");
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? NaN : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
// Load through the run: samples between the first file's start and the last file's end.
const during = (r) => r.samples.filter((s) => s.t >= r.runStart && s.t <= r.runEnd);

console.log("pair mode start(UTC) run_s failing tests runnable_mean/max load1_mean workers_max children_max burners");
for (const r of runs) {
  const s = during(r);
  console.log(
    [
      r.pair,
      r.mode,
      r.startedAt.slice(11, 19),
      ((r.runEnd - r.runStart) / 1000).toFixed(0),
      r.failed.length,
      r.failures.length,
      `${mean(s.map((x) => x.runnable)).toFixed(0)}/${Math.max(...s.map((x) => x.runnable))}`,
      mean(s.map((x) => x.load1)).toFixed(0),
      Math.max(...s.map((x) => x.workers)),
      Math.max(...s.map((x) => x.children)),
      Math.max(...s.map((x) => x.burners)),
    ].join(" "),
  );
}

const files = Object.keys(runs[0].files).sort();
console.log("\nfile: failed on/n, off/n; median duration s on, off");
for (const f of files) {
  const by = (mode) => runs.filter((r) => r.mode === mode);
  const fails = (mode) => by(mode).filter((r) => r.files[f]?.state !== "passed").length;
  const dur = (mode) => median(by(mode).map((r) => r.files[f]?.durationMs ?? NaN)) / 1000;
  console.log(
    `${short(f)}: ${fails("on")}/${by("on").length}, ${fails("off")}/${by("off").length}; ${dur("on").toFixed(1)}, ${dur("off").toFixed(1)}`,
  );
}

// Paired: within each pair, failing files on minus off.
const pairs = [...new Set(runs.map((r) => r.pair))].sort((a, b) => a - b);
let onWorse = 0;
let offWorse = 0;
let ties = 0;
const diffs = [];
for (const p of pairs) {
  const on = runs.find((r) => r.pair === p && r.mode === "on");
  const off = runs.find((r) => r.pair === p && r.mode === "off");
  if (!on || !off) continue;
  const d = on.failed.length - off.failed.length;
  diffs.push(d);
  if (d > 0) onWorse++;
  else if (d < 0) offWorse++;
  else ties++;
}
const total = (mode) => runs.filter((r) => r.mode === mode).reduce((a, r) => a + r.failed.length, 0);
const tests = (mode) => runs.filter((r) => r.mode === mode).reduce((a, r) => a + r.failures.length, 0);
console.log(
  `\nfailing files on ${total("on")}, off ${total("off")}; failing tests on ${tests("on")}, off ${tests("off")}; pairs on worse ${onWorse}, off worse ${offWorse}, tie ${ties}; diffs ${JSON.stringify(diffs)}`,
);
// Two-sided sign test over the untied pairs.
const n = onWorse + offWorse;
const k = Math.max(onWorse, offWorse);
let tail = 0;
const choose = (a, b) => {
  let c = 1;
  for (let i = 1; i <= b; i++) c = (c * (a - b + i)) / i;
  return c;
};
for (let i = k; i <= n; i++) tail += choose(n, i) / 2 ** n;
console.log(`sign test p (two-sided) ${Math.min(1, 2 * tail).toFixed(3)} over ${n} untied pairs`);
const sum = (mode) =>
  median(
    runs.filter((r) => r.mode === mode).map((r) => Object.values(r.files).reduce((a, f) => a + (f.durationMs ?? 0), 0) / 1000),
  );
const firstStart = (mode) =>
  median(runs.filter((r) => r.mode === mode).map((r) => Math.min(...Object.values(r.files).map((f) => f.start)) / 1000));
console.log(
  `median summed file time on ${sum("on").toFixed(0)} s, off ${sum("off").toFixed(0)} s; median first-module start on ${firstStart("on").toFixed(1)} s, off ${firstStart("off").toFixed(1)} s`,
);

// Each failure: which of the nine were running then, and the runnable count nearest it.
console.log("\nfailures: pair mode t_s file | concurrent nine | runnable | test | error");
for (const r of runs) {
  for (const x of r.failures) {
    const running = Object.values(r.files).filter((f) => f.start <= x.t && (f.end ?? Infinity) >= x.t).length;
    const near = r.samples.reduce((a, s) => (Math.abs(s.t - x.t) < Math.abs(a.t - x.t) ? s : a));
    console.log(
      `${r.pair} ${r.mode} ${(x.t / 1000).toFixed(1)} ${short(x.file)} | ${running} | ${near.runnable} | ${x.name.slice(0, 60)} | ${(x.error ?? "").split("\n")[0].slice(0, 70)}`,
    );
  }
}
