// Throwaway (018-04). Wall time, Node 22 test-shard times and re-runs of this
// repository's ci.yml, from `gh api` output (read-only), as ci-times.mjs does
// for cezarion. Jobs copied into a later attempt are deduplicated by name,
// start and end. Durations in seconds, queueing excluded.
// Usage: node squeal-ci-times.mjs <dir with runs.jsonl and jobs/>
import { readFileSync, existsSync } from "node:fs";

const dir = process.argv[2];
const runs = readFileSync(`${dir}/runs.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const t = (s) => Date.parse(s);
const q = (xs, p) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null; };
const stat = (xs) => ({ n: xs.length, p50: q(xs, 0.5), p90: q(xs, 0.9) });
const rows = [];
for (const run of runs) {
  const path = `${dir}/jobs/${run.id}.json`;
  if (run.status !== "completed" || !existsSync(path)) continue;
  const seen = new Set();
  const jobs = [];
  for (const j of JSON.parse(readFileSync(path, "utf8")).jobs) {
    const id = `${j.name}|${j.started_at}|${j.completed_at}`;
    if (seen.has(id) || j.conclusion === "skipped" || !j.started_at || !j.completed_at) continue;
    seen.add(id);
    const step = (j.steps ?? []).find((s) => /^(Test|Run tests|Vitest)/i.test(s.name) && s.completed_at);
    jobs.push({ name: j.name, attempt: j.run_attempt, conclusion: j.conclusion, s: (t(j.completed_at) - t(j.started_at)) / 1000, step: step ? (t(step.completed_at) - t(step.started_at)) / 1000 : null, start: t(j.started_at), end: t(j.completed_at) });
  }
  const shards = jobs.filter((j) => /^Node 22 \(\d\/3\)$/.test(j.name));
  const first = jobs.filter((j) => j.attempt === 1);
  rows.push({
    id: run.id, event: run.event, branch: run.head_branch, conclusion: run.conclusion, attempts: run.run_attempt,
    span: first.length ? (Math.max(...first.map((j) => j.end)) - Math.min(...first.map((j) => j.start))) / 1000 : NaN,
    jobS: jobs.reduce((a, j) => a + j.s, 0),
    shardJobs: shards.filter((j) => j.attempt === 1).map((j) => j.s),
    shardSteps: shards.filter((j) => j.attempt === 1 && j.step !== null).map((j) => j.step),
    otherJobs: first.filter((j) => !/^Node 22/.test(j.name)).map((j) => `${j.name}:${Math.round(j.s)}`),
    reran: jobs.filter((j) => jobs.some((e) => e.name === j.name && e.attempt < j.attempt)).map((j) => `${j.name}#${j.attempt}:${j.conclusion}:${Math.round(j.s)}s`),
  });
}
const green = rows.filter((r) => r.conclusion === "success" && r.attempts === 1 && r.shardJobs.length === 3);
const sel = (f) => green.filter(f);
const sum = (rs) => ({
  runs: rs.length,
  span: stat(rs.map((r) => r.span)),
  longestShardJob: stat(rs.map((r) => Math.max(...r.shardJobs))),
  longestShardTestStep: stat(rs.map((r) => Math.max(...r.shardSteps))),
  jobMinutes: stat(rs.map((r) => r.jobS / 60)),
});
const out = {
  window: { from: runs.at(-1).created_at, to: runs[0].created_at, runs: runs.length },
  candidatePush: sum(sel((r) => r.event === "push" && r.branch.startsWith("cand/"))),
  mainPush: sum(sel((r) => r.event === "push" && r.branch === "main")),
  otherJobsExample: green[0]?.otherJobs,
  runsWithAttemptOver1: rows.filter((r) => r.attempts > 1).length,
  reruns: rows.filter((r) => r.reran.length > 0).map((r) => ({ id: r.id, branch: r.branch, reran: r.reran })),
};
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
