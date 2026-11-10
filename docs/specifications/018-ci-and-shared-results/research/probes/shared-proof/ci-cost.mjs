// Throwaway (018-21). Cost of `squeal ci record` in cezarion's Vitest shards,
// from what fetch-ci.sh saved (read-only GitHub data).
//
// Per Vitest shard job whose test step ran ("Run server and cockpit unit
// suites", with or without " with Squeal recording"): job wall, test step
// wall, and from the log Vitest's own summary: `Duration` (the run's wall)
// and the sum of its phases (transform + setup + import + tests +
// environment), which Vitest sums over workers. GitHub reports no CPU per
// job; the phase sum is the nearest proxy (worker-busy seconds, not CPU).
// Also the export and publish jobs' walls.
//
// Groups: merge_group runs before cezarion#3151 (plain), merge_group runs
// that recorded on Squeal 0.1.426 (recording), and push-to-main runs
// (plain; each main commit's push run tests the same tree as its merge
// group). Pairs by head SHA give a within-commit ratio; pairs before #3151
// show how the two events differ with no recording (the noise floor).
//
// Usage: node ci-cost.mjs <data dir> [--per-job]
import { readFileSync, existsSync } from "node:fs";

const dir = process.argv[2];
const perJob = process.argv.includes("--per-job");
const runs = readFileSync(`${dir}/runs.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const t = (s) => Date.parse(s);
const PIN_3151 = t("2026-11-10T10:29:00Z"); // first merge-group run with the recording step
const sec = (ms) => ms / 1000;

function vitestSummary(text) {
  const d = text.match(/Duration\s+([\d.]+)s\s+\(transform ([\d.]+)(m?s), setup ([\d.]+)(m?s), import ([\d.]+)(m?s), tests ([\d.]+)(m?s), environment ([\d.]+)(m?s)/);
  const files = text.match(/Test Files\s+(?:(\d+) failed \| )?(\d+) passed/);
  const tag = text.match(/SQUEAL_TAG: (squeal--v[\d.]+)/);
  const wrote = text.match(/squeal ci record: wrote (\d+) parts? with (\d+) test files/);
  const node = text.match(/^.*\tnode: (v[\d.]+)/m);
  const image = text.match(/Image: (\S+)\s*\n.*Version: (\S+)/);
  if (!d) return { tag: tag?.[1] ?? null };
  const v = (n, u) => (u === "ms" ? Number(n) / 1000 : Number(n));
  return {
    durationS: Number(d[1]),
    phaseSumS: v(d[2], d[3]) + v(d[4], d[5]) + v(d[6], d[7]) + v(d[8], d[9]) + v(d[10], d[11]),
    testsS: v(d[8], d[9]),
    files: files ? Number(files[2]) + Number(files[1] ?? 0) : null,
    tag: tag?.[1] ?? null,
    recordedFiles: wrote ? Number(wrote[2]) : null,
    node: node?.[1] ?? null,
    image: image ? `${image[1]} ${image[2]}` : null,
  };
}

const shards = [];
const extra = [];
for (const run of runs) {
  const p = `${dir}/jobs/${run.id}.json`;
  if (run.status !== "completed" || !existsSync(p)) continue;
  if (run.event === "push" && run.head_branch !== "main") continue;
  const seen = new Set();
  for (const job of JSON.parse(readFileSync(p, "utf8")).jobs) {
    const id = `${job.name}|${job.started_at}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (/Squeal shared results/.test(job.name) && job.conclusion !== "skipped" && job.completed_at) {
      extra.push({ run: run.id, name: job.name, conclusion: job.conclusion, wallS: sec(t(job.completed_at) - t(job.started_at)) });
      continue;
    }
    const m = job.name.match(/^Vitest shard (\d)\/4$/);
    if (!m) continue;
    const step = (job.steps ?? []).find((s) => /^Run server and cockpit unit suites/.test(s.name) && s.conclusion === "success");
    if (!step) continue;
    const logPath = `${dir}/logs/${job.id}.txt`;
    const summary = existsSync(logPath) ? vitestSummary(readFileSync(logPath, "utf8")) : {};
    const recording = / with Squeal recording$/.test(step.name);
    let group;
    if (run.event === "push") group = "push-plain";
    else if (!recording && t(run.created_at) < PIN_3151) group = "mg-plain";
    else if (recording && summary.tag === "squeal--v0.1.426") group = "mg-record-0.1.426";
    else if (recording) group = `mg-record-${summary.tag ?? "unknown"}`;
    else group = "mg-plain-after";
    shards.push({
      run: run.id, sha: run.head_sha, event: run.event, created: run.created_at, group, shard: Number(m[1]),
      attempt: job.run_attempt, jobS: sec(t(job.completed_at) - t(job.started_at)),
      stepS: sec(t(step.completed_at) - t(step.started_at)), ...summary,
    });
  }
}

const q = (xs, p) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const i = (s.length - 1) * p;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1));
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "-");
const describe = (xs) => `n=${xs.length} median ${f1(q(xs, 0.5))} IQR ${f1(q(xs, 0.25))}-${f1(q(xs, 0.75))} mean ${f1(mean(xs))} sd ${f1(sd(xs))} (cv ${f1((100 * sd(xs)) / mean(xs))}%)`;

if (perJob) for (const s of shards) console.log(JSON.stringify(s));

console.log("## Per shard job, by group (seconds)");
const groups = [...new Set(shards.map((s) => s.group))].sort();
for (const g of groups) {
  const xs = shards.filter((s) => s.group === g);
  const runsN = new Set(xs.map((s) => s.run)).size;
  console.log(`\n${g}: ${runsN} runs, ${xs.length} shard jobs, created ${xs.map((s) => s.created).sort()[0]} .. ${xs.map((s) => s.created).sort().at(-1)}`);
  for (const k of ["jobS", "stepS", "durationS", "phaseSumS", "testsS", "files"]) {
    console.log(`  ${k.padEnd(9)} ${describe(xs.map((s) => s[k]).filter(Number.isFinite))}`);
  }
  for (const n of [1, 2, 3, 4]) {
    const ys = xs.filter((s) => s.shard === n);
    console.log(`  shard ${n}: step ${describe(ys.map((s) => s.stepS))}; phase sum median ${f1(q(ys.map((s) => s.phaseSumS), 0.5))}`);
  }
}

// Per run: the four shards summed (worker-busy and step seconds) and the slowest shard (the wait).
function perRun(group) {
  const byRun = new Map();
  for (const s of shards.filter((x) => x.group === group)) {
    const r = byRun.get(s.run) ?? { sha: s.sha, created: s.created, xs: [] };
    r.xs.push(s);
    byRun.set(s.run, r);
  }
  return [...byRun].filter(([, r]) => new Set(r.xs.map((s) => s.shard)).size === 4 && r.xs.length === 4)
    .map(([run, r]) => ({ run, sha: r.sha, created: r.created,
      stepSum: r.xs.reduce((a, s) => a + s.stepS, 0), phaseSum: r.xs.reduce((a, s) => a + (s.phaseSumS ?? NaN), 0),
      slowest: Math.max(...r.xs.map((s) => s.stepS)), slowestJob: Math.max(...r.xs.map((s) => s.jobS)) }));
}
console.log("\n## Per run (four shards complete, one attempt each)");
for (const g of groups) {
  const rs = perRun(g);
  if (rs.length === 0) continue;
  console.log(`\n${g}: ${rs.length} runs`);
  for (const k of ["stepSum", "phaseSum", "slowest", "slowestJob"]) console.log(`  ${k.padEnd(10)} ${describe(rs.map((r) => r[k]).filter(Number.isFinite))}`);
}

// Same-SHA pairs: merge-group run vs the push run of the same commit.
console.log("\n## Same-SHA pairs: merge-group shard / push shard, same shard index (ratio)");
const push = new Map();
for (const s of shards.filter((x) => x.group === "push-plain")) push.set(`${s.sha}|${s.shard}`, s);
for (const g of groups.filter((x) => x.startsWith("mg-"))) {
  const pairs = shards.filter((s) => s.group === g).map((s) => [s, push.get(`${s.sha}|${s.shard}`)]).filter(([, p]) => p);
  if (pairs.length === 0) continue;
  const shas = new Set(pairs.map(([s]) => s.sha)).size;
  console.log(`\n${g} vs push-plain: ${pairs.length} shard pairs over ${shas} commits`);
  for (const k of ["stepS", "durationS", "phaseSumS"]) {
    const r = pairs.map(([s, p]) => s[k] / p[k]).filter(Number.isFinite);
    console.log(`  ${k.padEnd(9)} ratio ${describe(r)}`);
  }
}

console.log("\n## Export and publish jobs (seconds)");
for (const name of ["Export Squeal shared results", "Publish Squeal shared results"]) {
  const xs = extra.filter((e) => e.name === name);
  console.log(`${name}: ${xs.map((e) => `${e.run}:${e.conclusion}:${e.wallS}`).join(" ")}`);
  const ok = xs.filter((e) => e.conclusion === "success").map((e) => e.wallS);
  if (ok.length) console.log(`  success ${describe(ok)}`);
}

// Merge-group runs since the first publish: did the shards run, or reuse a PR's suite?
console.log("\n## Merge-group runs since cezarion#3176 (2026-11-10T16:57Z): shards ran or reused");
for (const run of runs.filter((r) => r.event === "merge_group" && t(r.created_at) >= t("2026-11-10T16:57:00Z") && r.status === "completed")) {
  const xs = shards.filter((s) => s.run === run.id);
  const e = extra.filter((x) => x.run === run.id).map((x) => `${x.name.split(" ")[0]}:${x.conclusion}`).join(",");
  console.log(`${run.id} ${run.head_sha.slice(0, 8)} ${run.conclusion} shards-ran=${xs.length} ${e || "no export/publish"}`);
}

// Effect: recording runs (0.1.425 and 0.1.426 both attached and recorded) against plain merge-group
// runs, per run (four shards summed, and the slowest shard), with a bootstrap 95% interval of the
// difference of means, over all plain runs and over the plain runs of the last day before #3151.
// Per-file: seconds per test file, since the suite grew while the runs were made.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const boot = (a, b, f = mean, n = 5000) => {
  const ds = [];
  for (let i = 0; i < n; i++) {
    const ra = a.map(() => a[Math.floor(rnd() * a.length)]);
    const rb = b.map(() => b[Math.floor(rnd() * b.length)]);
    ds.push(f(rb) - f(ra));
  }
  ds.sort((x, y) => x - y);
  return [ds[Math.floor(0.025 * n)], ds[Math.floor(0.975 * n)]];
};
function runsOf(pred) {
  const byRun = new Map();
  for (const s of shards.filter(pred)) {
    const r = byRun.get(s.run) ?? [];
    r.push(s);
    byRun.set(s.run, r);
  }
  return [...byRun.values()].filter((xs) => xs.length === 4 && new Set(xs.map((s) => s.shard)).size === 4).map((xs) => ({
    created: xs[0].created,
    stepSum: xs.reduce((a, s) => a + s.stepS, 0),
    phaseSum: xs.reduce((a, s) => a + s.phaseSumS, 0),
    files: xs.reduce((a, s) => a + s.files, 0),
    slowest: Math.max(...xs.map((s) => s.stepS)),
    jobSum: xs.reduce((a, s) => a + s.jobS, 0),
  }));
}
const rec = runsOf((s) => s.group === "mg-record-0.1.426" || s.group === "mg-record-squeal--v0.1.425");
const plainAll = runsOf((s) => s.group === "mg-plain");
const plainDay = runsOf((s) => s.group === "mg-plain" && t(s.created) >= t("2026-11-09T03:41:00Z"));
console.log("\n## Effect of recording, per run (recording = 0.1.425 + 0.1.426 runs)");
for (const [label, base] of [["all plain merge-group runs", plainAll], ["plain runs of the last day before #3151", plainDay]]) {
  console.log(`\nvs ${label}: plain n=${base.length}, recording n=${rec.length}`);
  for (const k of ["stepSum", "phaseSum", "slowest", "jobSum"]) {
    const a = base.map((r) => r[k]), b = rec.map((r) => r[k]);
    const [lo, hi] = boot(a, b);
    console.log(`  ${k.padEnd(9)} plain mean ${f1(mean(a))}, recording mean ${f1(mean(b))}: +${f1(mean(b) - mean(a))} s (${f1((100 * (mean(b) - mean(a))) / mean(a))}%), 95% CI ${f1(lo)} to ${f1(hi)} s (${f1((100 * lo) / mean(a))}% to ${f1((100 * hi) / mean(a))}%)`);
  }
  for (const k of ["stepSum", "phaseSum"]) {
    const a = base.map((r) => r[k] / r.files), b = rec.map((r) => r[k] / r.files);
    const [lo, hi] = boot(a, b);
    console.log(`  ${k}/file plain ${mean(a).toFixed(3)}, recording ${mean(b).toFixed(3)}: ${f1((100 * (mean(b) - mean(a))) / mean(a))}%, 95% CI ${f1((100 * lo) / mean(a))}% to ${f1((100 * hi) / mean(a))}%`);
  }
  console.log(`  test files per run: plain mean ${f1(mean(base.map((r) => r.files)))}, recording ${f1(mean(rec.map((r) => r.files)))}`);
}

// The steps the recording added to each shard job, from the job's steps (seconds).
console.log("\n## Added shard steps (recording runs)");
const added = new Map();
for (const run of runs) {
  const p = `${dir}/jobs/${run.id}.json`;
  if (!existsSync(p) || run.event !== "merge_group") continue;
  for (const job of JSON.parse(readFileSync(p, "utf8")).jobs ?? []) {
    if (!/^Vitest shard/.test(job.name)) continue;
    for (const s of job.steps ?? []) {
      if (!/^(Fetch the Squeal release|Upload Squeal parts)$/.test(s.name) || s.conclusion !== "success") continue;
      const xs = added.get(s.name) ?? [];
      xs.push(sec(t(s.completed_at) - t(s.started_at)));
      added.set(s.name, xs);
    }
  }
}
for (const [k, xs] of added) console.log(`${k}: ${describe(xs)}`);
