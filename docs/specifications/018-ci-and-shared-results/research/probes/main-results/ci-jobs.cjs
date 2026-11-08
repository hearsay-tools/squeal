// main-results probe (throwaway): question 4. Job and step times of CI runs, from `gh api .../runs/<id>/jobs`
// output saved as jobs/<prefix><run id>.json (fields name, status, conclusion, started_at, completed_at, steps).
// Usage: node ci-jobs.cjs <runs.jsonl> <jobs dir> <prefix> <test step regex> <job name regex>
// Prints, over completed runs whose matching jobs ran the test step: the run's wall (run_started_at to updated_at),
// the longest matching job, the test step per job, the job time outside the test step, and how many runs skipped the
// test step (for cezar merge groups: reused native PR evidence).
const fs = require("fs");
const [, , runsPath, dir, prefix, stepRe, jobRe] = process.argv;
const S = new RegExp(stepRe), J = new RegExp(jobRe);
const runs = fs.readFileSync(runsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null; };
const sec = (a, b) => (Date.parse(b) - Date.parse(a)) / 1000;
const out = { runs: 0, ranTests: 0, skippedTests: 0, wall: [], longestJob: [], testStep: [], outsideStep: [], jobsPerRun: [], testStepSumPerRun: [] };
for (const r of runs) {
  if (r.status !== "completed" || r.conclusion === "cancelled") continue;
  let jobs; try { jobs = JSON.parse(fs.readFileSync(`${dir}/${prefix}${r.id}.json`, "utf8")); } catch { continue; }
  out.runs++;
  const m = jobs.filter((j) => J.test(j.name));
  const ran = m.filter((j) => j.steps.some((s) => S.test(s.name) && s.conclusion === "success"));
  if (m.length && ran.length === 0) { out.skippedTests++; continue; }
  if (ran.length === 0) continue;
  out.ranTests++;
  out.wall.push(sec(r.run_started_at, r.updated_at));
  out.longestJob.push(Math.max(...ran.map((j) => sec(j.started_at, j.completed_at))));
  let sum = 0;
  for (const j of ran) {
    const st = j.steps.find((s) => S.test(s.name) && s.conclusion === "success");
    const t = sec(st.started_at, st.completed_at); sum += t;
    out.testStep.push(t); out.outsideStep.push(sec(j.started_at, j.completed_at) - t);
  }
  out.jobsPerRun.push(ran.length); out.testStepSumPerRun.push(sum);
}
const fmt = (a) => ({ n: a.length, p10: q(a, 0.1), p50: q(a, 0.5), p90: q(a, 0.9) });
console.log(JSON.stringify({ runs: out.runs, ranTests: out.ranTests, skippedTests: out.skippedTests, wall: fmt(out.wall), longestJob: fmt(out.longestJob), testStep: fmt(out.testStep), outsideStep: fmt(out.outsideStep), jobsPerRun: fmt(out.jobsPerRun), testStepSumPerRun: fmt(out.testStepSumPerRun) }));
