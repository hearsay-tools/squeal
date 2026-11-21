// Throwaway probe (row 018-69): for each main commit with a refs/squeal/<sha>
// ref, when main reached it (the main push run of ci.yml) and when its
// export's publish job ran (the merge_group run's "Publish" job). Read-only
// GitHub API through `gh api`. Usage: node lag.mjs <main-refs.txt> > lag.json
// where each line is "<sha> <committer date> ref|none" (first-parent main).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO = "hearsay-tools/squawk";
const gh = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 64 << 20 }));
const lines = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => l.split(" "));
const wanted = new Set(lines.map(([sha]) => sha));

async function runs(event) {
  const bySha = new Map();
  for (let page = 1; page <= 10; page++) {
    const r = gh(`repos/${REPO}/actions/workflows/ci.yml/runs?event=${event}&per_page=100&page=${page}`);
    for (const run of r.workflow_runs) {
      if (!wanted.has(run.head_sha)) continue;
      const prev = bySha.get(run.head_sha);
      if (!prev || run.created_at < prev.created_at) bySha.set(run.head_sha, run);
    }
    if (r.workflow_runs.length < 100) break;
    const oldest = r.workflow_runs.at(-1).created_at;
    if (oldest < "2026-11-16") break;
  }
  return bySha;
}

const push = await runs("push");
const group = await runs("merge_group");
const out = [];
for (const [sha, date, has] of lines) {
  const row = { sha, committed: date, ref: has === "ref", mainAt: push.get(sha)?.created_at ?? null };
  const g = group.get(sha);
  if (g) {
    row.groupRun = g.id;
    row.groupCreated = g.created_at;
    const jobs = gh(`repos/${REPO}/actions/runs/${g.id}/jobs?per_page=100`).jobs;
    const pub = jobs.find((j) => /^Publish Squeal/.test(j.name));
    const exp = jobs.find((j) => /^Export Squeal/.test(j.name));
    row.exportStarted = exp?.started_at ?? null;
    row.publishStarted = pub?.started_at ?? null;
    row.publishDone = pub?.completed_at ?? null;
    row.publishConclusion = pub?.conclusion ?? null;
  }
  out.push(row);
}
console.log(JSON.stringify(out, null, 1));
