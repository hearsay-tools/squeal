// Task 001-132 evidence, not product code: summarizes ab-{off,on}-{1,2,3}.json.
// Usage: node analyze.mjs <dir>
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const load = (mode, i) => {
  const file = join(dir, `ab-${mode}-${i}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};
const runs = { off: [1, 2, 3].map((i) => load("off", i)).filter(Boolean), on: [1, 2, 3].map((i) => load("on", i)).filter(Boolean) };
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
for (const mode of ["off", "on"]) {
  for (const [i, r] of runs[mode].entries()) {
    const total = Object.values(r.durations).reduce((a, b) => a + b, 0);
    console.log(
      `${mode} ${i + 1}: ${r.end}, ${r.completed}/${r.files} files, wall ${(r.wallMs / 1000).toFixed(0)} s, summed file time ${(total / 1000).toFixed(0)} s, load ${r.loadBefore.toFixed(0)} -> ${r.loadAfter.toFixed(0)}, failing ${JSON.stringify(r.failed)}`,
    );
  }
}
const failedIn = (mode) => {
  const counts = new Map();
  for (const r of runs[mode]) for (const f of r.failed) counts.set(f, (counts.get(f) ?? 0) + 1);
  return counts;
};
const off = failedIn("off");
const on = failedIn("on");
console.log("failing only with the recorder:", JSON.stringify([...on].filter(([f]) => !off.has(f))));
console.log("failing only without it:", JSON.stringify([...off].filter(([f]) => !on.has(f))));
console.log("failing both ways:", JSON.stringify([...on].filter(([f]) => off.has(f))));

// Cost per file: the median of a file's durations with the recorder over its median without.
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const files = Object.keys(runs.off[0]?.durations ?? {});
const ratios = [];
const deltas = [];
for (const file of files) {
  const a = runs.off.map((r) => r.durations[file]).filter((d) => d !== undefined);
  const b = runs.on.map((r) => r.durations[file]).filter((d) => d !== undefined);
  if (a.length === 0 || b.length === 0) continue;
  const ma = median(a);
  const mb = median(b);
  if (ma > 0) ratios.push(mb / ma);
  deltas.push(mb - ma);
}
const fmt = (x) => x.toFixed(2);
const byProject = new Map();
for (const file of files) {
  const a = runs.off.map((r) => r.durations[file]).filter((d) => d !== undefined);
  const b = runs.on.map((r) => r.durations[file]).filter((d) => d !== undefined);
  if (a.length === 0 || b.length === 0 || median(a) === 0) continue;
  const project = file.split(":")[0];
  const entry = byProject.get(project) ?? { ratios: [], deltas: [] };
  entry.ratios.push(median(b) / median(a));
  entry.deltas.push(median(b) - median(a));
  byProject.set(project, entry);
}
for (const [project, { ratios: r, deltas: d }] of byProject) {
  console.log(`  ${project} (${r.length} files): ratio p50 ${fmt(q(r, 0.5))}, delta ms p50 ${q(d, 0.5).toFixed(0)}, p90 ${q(d, 0.9).toFixed(0)}`);
}
console.log(
  `per-file ratio on/off (median of runs): p25 ${fmt(q(ratios, 0.25))}, p50 ${fmt(q(ratios, 0.5))}, p75 ${fmt(q(ratios, 0.75))}, p90 ${fmt(q(ratios, 0.9))}; per-file delta ms p50 ${q(deltas, 0.5).toFixed(0)}, p90 ${q(deltas, 0.9).toFixed(0)}`,
);
const sum = (mode) => runs[mode].map((r) => Object.values(r.durations).reduce((a, b) => a + b, 0));
console.log(`summed file time off ${JSON.stringify(sum("off").map((s) => Math.round(s / 1000)))} s, on ${JSON.stringify(sum("on").map((s) => Math.round(s / 1000)))} s`);
const observed = runs.on[0]?.observed ?? {};
const grown = Object.entries(observed).filter(([, o]) => o.paths.length + o.directories.length > 0);
const sizes = grown.map(([, o]) => o.paths.length + o.directories.length);
console.log(
  `observed (first on run, before the closure filter): ${grown.length} of ${runs.on[0]?.files} files, paths per file p50 ${q(sizes, 0.5)}, p90 ${q(sizes, 0.9)}, max ${Math.max(...sizes)}`,
);
