#!/usr/bin/env node
// Throwaway probe (row 011-428). Joins fetch.mjs's failed jobs with every run in scope and
// writes census.csv: one row per failed test (or per failed job with no parsed test), with
// whether the same job passed on the same commit (a later attempt, or another run).
//   node analyze.mjs <scope.json> <cache-dir> <failures.jsonl> > census.csv
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [scopePath, cache, failuresPath] = process.argv.slice(2);
const scope = JSON.parse(readFileSync(scopePath, "utf8"));
const failures = readFileSync(failuresPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));

// Every job result per commit: fetched attempts give each job; a run never fetched passed whole.
const results = new Map(); // `${sha}|${job}` -> [{run, attempt, conclusion}]
const add = (sha, job, entry) => {
  const key = `${sha}|${job}`;
  if (!results.has(key)) results.set(key, []);
  results.get(key).push(entry);
};
const fetched = new Set();
for (const name of readdirSync(join(cache, "jobs"))) {
  const [run, attempt] = name.replace(".json", "").split("-").map(Number);
  const r = scope.find((s) => s.databaseId === run);
  if (!r) continue;
  fetched.add(run);
  for (const j of JSON.parse(readFileSync(join(cache, "jobs", name), "utf8")).jobs)
    add(r.headSha, j.name, { run, attempt, conclusion: j.conclusion });
}
const pushJobs = (shards) => [
  ...Array.from({ length: shards }, (_, i) => `Node 22 (${i + 1}/${shards})`),
  "Node 24 (lint, typecheck, version-sensitive)",
  "Node 26 (version-sensitive)",
];
for (const r of scope) {
  if (fetched.has(r.databaseId) || r.conclusion !== "success") continue;
  // Six Node 22 shards since the switch; both names are added, only the matching one is looked up.
  for (const job of [...pushJobs(3), ...pushJobs(6)]) add(r.headSha, job, { run: r.databaseId, attempt: r.attempt, conclusion: "success" });
}

const csv = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
console.log(
  [
    "run", "attempt", "created", "branch", "event", "sha", "job", "step", "file", "test", "error",
    "same_commit_passed", "same_commit_failed_elsewhere",
  ].join(","),
);
for (const f of failures) {
  const others = results.get(`${f.sha}|${f.job}`) ?? [];
  const passed = others.filter((o) => o.conclusion === "success" && !(o.run === f.run && o.attempt === f.attempt));
  const failedElsewhere = others.filter((o) => o.conclusion === "failure" && !(o.run === f.run && o.attempt === f.attempt));
  const rows = f.tests.length ? f.tests : [{ file: "", test: "", error: "" }];
  for (const t of rows)
    console.log(
      [
        f.run, f.attempt, f.created, f.branch, f.event, f.sha.slice(0, 9), f.job, f.steps.join("+"),
        t.file, t.test, t.error,
        passed.map((p) => `${p.run}#${p.attempt}`).join(" "),
        failedElsewhere.map((p) => `${p.run}#${p.attempt}`).join(" "),
      ].map(csv).join(","),
    );
}
