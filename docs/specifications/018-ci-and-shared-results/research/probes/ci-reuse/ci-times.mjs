// Throwaway (018-04). Wall time, job-minutes and reruns of cezarion's CI
// workflow, from what `gh api` returned (read-only):
//   runs.jsonl  one line per run: gh api .../workflows/<ci.yml id>/runs
//   jobs/<run id>.json  gh api .../runs/<id>/jobs?filter=all&per_page=100
// A "re-run failed jobs" attempt copies the jobs it keeps into the new
// attempt with their old times; jobs are deduplicated by name, start and end,
// so each execution counts once. Times exclude queueing (started_at to
// completed_at); queueing is created_at to started_at, reported apart.
// Usage: node ci-times.mjs <dir with runs.jsonl and jobs/> > summary.json
import { readFileSync, existsSync } from "node:fs";

const dir = process.argv[2];
const runs = readFileSync(`${dir}/runs.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const t = (s) => (s ? Date.parse(s) : NaN);
const q = (xs, p) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return null;
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] / 1000);
};
const stat = (xs) => ({ n: xs.filter(Number.isFinite).length, p50: q(xs, 0.5), p90: q(xs, 0.9) });

const kindOf = (name) =>
  /^Vitest shard/.test(name) ? "vitest"
  : /^Cockpit browser E2E shard/.test(name) ? "cockpit"
  : /^Unit, build, and package$/.test(name) ? "build"
  : /^Review \//.test(name) ? "review"
  : "other";
const testStep = { vitest: /^Run server and cockpit unit suites$/, cockpit: /^Run cockpit browser E2E$/ };

const perRun = [];
for (const run of runs) {
  const path = `${dir}/jobs/${run.id}.json`;
  if (!existsSync(path) || run.status !== "completed") continue;
  const seen = new Set();
  const jobs = [];
  for (const job of JSON.parse(readFileSync(path, "utf8")).jobs) {
    const id = `${job.name}|${job.started_at}|${job.completed_at}`;
    if (seen.has(id) || job.conclusion === "skipped" || !job.started_at || !job.completed_at) continue;
    seen.add(id);
    const ms = t(job.completed_at) - t(job.started_at);
    if (!(ms >= 0)) continue;
    const k = kindOf(job.name);
    const step = (job.steps ?? []).find((s) => testStep[k]?.test(s.name));
    jobs.push({
      name: job.name, kind: k, attempt: job.run_attempt, conclusion: job.conclusion, ms,
      queueMs: t(job.started_at) - t(job.created_at),
      start: t(job.started_at), end: t(job.completed_at),
      testMs: step && step.completed_at ? t(step.completed_at) - t(step.started_at) : null,
    });
  }
  const heavy = jobs.filter((j) => j.kind === "vitest" || j.kind === "cockpit" || j.kind === "build");
  const firstAttemptHeavy = heavy.filter((j) => j.attempt === 1);
  const span = (js) => (js.length === 0 ? NaN : Math.max(...js.map((j) => j.end)) - Math.min(...js.map((j) => j.start)));
  perRun.push({
    id: run.id, event: run.event, sha: run.head_sha, conclusion: run.conclusion, attempts: run.run_attempt,
    created: run.created_at,
    wallMs: t(run.updated_at) - t(run.run_started_at),
    jobMs: jobs.reduce((a, j) => a + j.ms, 0),
    heavyJobMs: heavy.reduce((a, j) => a + j.ms, 0),
    heavySpanMs: span(firstAttemptHeavy),
    vitestTestMs: heavy.filter((j) => j.kind === "vitest" && j.testMs !== null).map((j) => j.testMs),
    vitestJobMs: heavy.filter((j) => j.kind === "vitest").map((j) => j.ms),
    cockpitTestMs: heavy.filter((j) => j.kind === "cockpit" && j.testMs !== null).map((j) => j.testMs),
    cockpitJobMs: heavy.filter((j) => j.kind === "cockpit").map((j) => j.ms),
    buildJobMs: heavy.filter((j) => j.kind === "build").map((j) => j.ms),
    // A heavy job that executed in an earlier attempt too: a true re-run of the
    // same SHA. A heavy job first executed in a later attempt was released by a
    // re-run of the review, not re-run.
    reranHeavy: heavy
      .filter((j) => heavy.some((e) => e.name === j.name && e.attempt < j.attempt))
      .map((j) => `${j.name}#${j.attempt}:${j.conclusion}`),
    releasedLater: heavy.filter((j) => j.attempt > 1 && !heavy.some((e) => e.name === j.name && e.attempt < j.attempt)).length,
    heavyFailedFirst: heavy.filter((j) => j.conclusion === "failure").map((j) => `${j.name}#${j.attempt}`),
    queueMs: jobs.map((j) => j.queueMs),
    vitestCount: heavy.filter((j) => j.kind === "vitest" && j.attempt === 1).length,
  });
}

const full = perRun.filter((r) => r.vitestCount === 4 && r.conclusion === "success" && r.attempts === 1);
const by = (ev) => full.filter((r) => r.event === ev);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const summary = (rs) => ({
  runs: rs.length,
  wall: stat(rs.map((r) => r.wallMs)),
  heavySpan: stat(rs.map((r) => r.heavySpanMs)),
  jobMinutes: stat(rs.map((r) => r.jobMs)),
  heavyJobMinutes: stat(rs.map((r) => r.heavyJobMs)),
  longestVitestJob: stat(rs.map((r) => Math.max(...r.vitestJobMs))),
  longestVitestTestStep: stat(rs.map((r) => Math.max(...r.vitestTestMs))),
  vitestTestShareOfVitestJobs: Math.round((100 * sum(rs.flatMap((r) => r.vitestTestMs))) / sum(rs.flatMap((r) => r.vitestJobMs))),
  longestCockpitJob: stat(rs.map((r) => Math.max(...r.cockpitJobMs))),
  longestCockpitTestStep: stat(rs.map((r) => Math.max(...r.cockpitTestMs))),
  cockpitTestShareOfCockpitJobs: Math.round((100 * sum(rs.flatMap((r) => r.cockpitTestMs))) / sum(rs.flatMap((r) => r.cockpitJobMs))),
  buildJob: stat(rs.flatMap((r) => r.buildJobMs)),
  testJobsShareOfAllJobMinutes: Math.round(
    (100 * sum(rs.map((r) => sum(r.vitestJobMs) + sum(r.cockpitJobMs)))) / sum(rs.map((r) => r.jobMs)),
  ),
  queue: stat(rs.flatMap((r) => r.queueMs)),
});

// Repeats: a run whose SHA another earlier run of the same event already ran
// its four Vitest shards for.
const shaSeen = new Map();
let repeatSha = 0;
for (const r of [...perRun].reverse()) {
  if (r.vitestCount !== 4) continue;
  const k = `${r.event}|${r.sha}`;
  if (shaSeen.has(k)) repeatSha++;
  shaSeen.set(k, true);
}
const completed = perRun;
const out = {
  window: { from: runs.at(-1).created_at, to: runs[0].created_at, runs: runs.length },
  byEvent: Object.fromEntries(["pull_request_target", "push", "workflow_dispatch"].map((e) => [e, completed.filter((r) => r.event === e).length])),
  byConclusion: Object.fromEntries(["success", "failure", "cancelled"].map((c) => [c, completed.filter((r) => r.conclusion === c).length])),
  runsWithVitest: completed.filter((r) => r.vitestCount === 4).length,
  pushRunsReusingQueueProof: completed.filter((r) => r.event === "push" && r.vitestCount === 0 && r.conclusion === "success").length,
  attemptsOver1: completed.filter((r) => r.attempts > 1).length,
  attemptsOver1ThatReranHeavyJobs: completed.filter((r) => r.attempts > 1 && r.reranHeavy.length > 0).length,
  runsWithHeavyReleasedByLaterAttempt: completed.filter((r) => r.releasedLater > 0).length,
  heavyJobFailures: completed.flatMap((r) => r.heavyFailedFirst).length,
  heavyJobReruns: completed.flatMap((r) => r.reranHeavy).length,
  heavyJobRerunsByKind: Object.fromEntries(["Vitest", "Cockpit", "Unit, build"].map((k) => [k, completed.flatMap((r) => r.reranHeavy).filter((n) => n.startsWith(k)).length])),
  repeatShaRunsWithVitest: repeatSha,
  fullGreenFirstAttempt: { pull_request_target: summary(by("pull_request_target")), push: summary(by("push")) },
};
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
