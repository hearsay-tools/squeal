// Task 001-143 evidence, not product code. Summarizes two.ts outputs
// <dir>/<label>-<round>-<variant>.json per variant: runs, the two `--help`
// tests failed, the `--help` children's wall and CPU (from stamp.cjs; median
// and range, both children pooled), the recorder's flushes before a message in
// those children and their summed append time (from SQUEAL143_TIME), each
// child's wall less its own appends, and the
// mean 1-minute load and runnable count. A file that failed to load (a worker
// error, not a test's) is listed first.
// Usage: node analyze.mjs <dir> <label>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const [dir, label] = process.argv.slice(2);
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
const by = new Map();
for (const f of readdirSync(dir)) {
  const m = new RegExp(`^${label}-(\\d+)-(.+)\\.json$`).exec(f);
  if (!m) continue;
  const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const v = by.get(m[2]) ?? [];
  v.push(r);
  by.set(m[2], v);
}
const s1 = (x) => (x / 1000).toFixed(1);
const errors = [...by.values()].flat().flatMap((r) => Object.entries(r.files).filter(([, f]) => f.error).map(([p, f]) => `${r.variant} ${r.startedAt} ${p}: ${f.error}`));
if (errors.length) console.log(`file errors (not test results):\n${errors.join("\n")}\n`);
console.log("variant | runs | help tests failed | child wall s, median (min to max) | child CPU s, median | flushes before a message, median | their append s, median | child wall minus its appends s, median | load1 | runnable | io some %");
for (const [variant, runs] of [...by].sort()) {
  const help = runs.flatMap((r) => r.tests.filter((t) => t.name.includes("help") && t.name.includes("dispatch")));
  const kids = runs.flatMap((r) => r.stamps.filter((s) => s.argv.includes("--help") || s.argv.includes("discover models")));
  const times = runs.flatMap((r) => (r.times ?? []).filter((t) => t.argv.includes("--help") || t.argv.includes("discover")));
  const walls = kids.map((k) => k.wallMs);
  console.log(
    [
      variant,
      runs.length,
      `${help.filter((t) => t.state === "failed").length} of ${help.length}`,
      `${s1(med(walls))} (${s1(Math.min(...walls))} to ${s1(Math.max(...walls))})`,
      s1(med(kids.map((k) => k.cpuMs))),
      times.length ? med(times.map((t) => t.before.n)) : "-",
      times.length ? s1(med(times.map((t) => t.before.ms))) : "-",
      (() => {
        const appended = new Map(times.map((t) => [t.pid, t.before.ms + t.turn.ms + t.exit.ms]));
        return times.length ? s1(med(kids.map((k) => k.wallMs - (appended.get(k.pid) ?? 0)))) : "-";
      })(),
      mean(runs.map((r) => mean(r.samples.map((x) => x.load1)))).toFixed(0),
      mean(runs.map((r) => mean(r.samples.map((x) => x.runnable)))).toFixed(0),
      (() => {
        const xs = runs.flatMap((r) => r.samples.map((x) => x.io)).filter((x) => typeof x === "number");
        return xs.length ? mean(xs).toFixed(0) : "-";
      })(),
    ].join(" | "),
  );
}
