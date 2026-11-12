// Throwaway (row 020-41): how far a file's last stored duration is from its next run,
// read-only over a daemon's run history (runs/<id>/report.json, fileDurations).
// The store keeps a file's last module duration (D17.1's input), so "stored" here is
// the same file's duration in its previous run, by the report file's mtime.
// node estimate-error.mjs <.git/squeal/runs> > estimate-error.out.json
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const runs = [];
for (const id of readdirSync(dir)) {
  const path = join(dir, id, "report.json");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  let report;
  try {
    report = JSON.parse(text).report;
  } catch {
    continue;
  }
  const durations = report?.fileDurations ?? [];
  if (durations.length === 0) continue;
  runs.push({ at: statSync(path).mtimeMs, durations });
}
runs.sort((a, b) => a.at - b.at);
const last = new Map();
const single = [];
const perRun = [];
for (const run of runs) {
  let actual = 0;
  let stored = 0;
  let n = 0;
  for (const { testFile, durationMs } of run.durations) {
    const key = `${testFile.project}\u0000${testFile.path}`;
    const prev = last.get(key);
    if (prev !== undefined && prev > 0 && durationMs > 0) {
      single.push({ ratio: durationMs / prev, stored: prev });
      actual += durationMs;
      stored += prev;
      n++;
    }
    last.set(key, durationMs);
  }
  if (n >= 20) perRun.push({ n, ratio: actual / stored });
}
const q = (values, p) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length === 0 ? null : Number(s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2));
};
const summary = (values) => ({
  count: values.length,
  p01: q(values, 0.01),
  p05: q(values, 0.05),
  p25: q(values, 0.25),
  p50: q(values, 0.5),
  p75: q(values, 0.75),
  p95: q(values, 0.95),
  p99: q(values, 0.99),
  over2x: Number((values.filter((v) => v > 2).length / Math.max(1, values.length)).toFixed(4)),
  under0_5x: Number((values.filter((v) => v < 0.5).length / Math.max(1, values.length)).toFixed(4)),
});
const long = single.filter((s) => s.stored >= 30_000).map((s) => s.ratio);
process.stdout.write(
  `${JSON.stringify(
    {
      runs: runs.length,
      firstRun: new Date(runs[0]?.at ?? 0).toISOString(),
      lastRun: new Date(runs.at(-1)?.at ?? 0).toISOString(),
      singleFile: summary(single.map((s) => s.ratio)),
      singleFileStoredOver30s: summary(long),
      runOf20OrMore: { ...summary(perRun.map((r) => r.ratio)), medianFiles: q(perRun.map((r) => r.n), 0.5) },
    },
    null,
    1,
  )}\n`,
);
