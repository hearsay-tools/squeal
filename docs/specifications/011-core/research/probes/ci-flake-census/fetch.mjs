#!/usr/bin/env node
// Throwaway probe (row 011-428). Fetches every failed CI job of the runs in <scope.json>
// (from `gh run list --json databaseId,headBranch,headSha,event,conclusion,createdAt,attempt`),
// every attempt, caches jobs and logs under <cache>, and writes one JSON line per failed job.
//   node fetch.mjs <scope.json> <cache-dir> > failures.jsonl
// Network-bound: gh calls, six at a time. Plain Node, no package.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const REPO = "repos/hearsay-tools/squeal/actions";
const [scopePath, cache] = process.argv.slice(2);
mkdirSync(join(cache, "jobs"), { recursive: true });
mkdirSync(join(cache, "logs"), { recursive: true });

async function cached(path, args) {
  if (existsSync(path)) return readFileSync(path, "utf8");
  const { stdout } = await run("gh", args, { maxBuffer: 512 * 1024 * 1024 });
  writeFileSync(path, stdout);
  return stdout;
}

const strip = (line) =>
  line
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes in CI logs.
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "");

/** The failed tests of one job log: file, test name, first error line. */
export function parse(log) {
  const lines = log.split("\n").map(strip);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*FAIL\s+(?:(?:unit|unit-isolated|isolated)\s+)?((?:test|src)\/\S+)(?:\s+>\s+(.*))?$/);
    if (!m) continue;
    let error = "";
    for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
      const l = lines[j].trim();
      if (/^FAIL\s/.test(l)) break;
      if (/(Error|expected|timed out|Timeout|ENOTEMPTY|EBUSY|ECONNREFUSED|did not)/i.test(l)) {
        error = l.slice(0, 300);
        break;
      }
    }
    out.push({ file: m[1], test: (m[2] ?? "").slice(0, 300), error });
  }
  // Errors outside a test (unhandled errors, teardown).
  for (let i = 0; i < lines.length; i++) {
    if (/Unhandled (Errors|Rejection)|global-teardown|outlived/i.test(lines[i]) && !/✓/.test(lines[i])) {
      const next = lines.slice(i, i + 8).map((l) => l.trim()).filter(Boolean).join(" | ");
      out.push({ file: "(outside a test)", test: "", error: next.slice(0, 300) });
      break;
    }
  }
  return out;
}

async function pool(items, n, fn) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const item = items[next++];
        results.push(await fn(item));
      }
    }),
  );
  return results;
}

const scope = JSON.parse(readFileSync(scopePath, "utf8")).filter(
  (r) => r.conclusion === "failure" || r.attempt > 1,
);
const tasks = scope.flatMap((r) => Array.from({ length: r.attempt }, (_, k) => ({ r, attempt: k + 1 })));
const jobsets = await pool(tasks, 6, async ({ r, attempt }) => {
  const text = await cached(join(cache, "jobs", `${r.databaseId}-${attempt}.json`), [
    "api",
    `${REPO}/runs/${r.databaseId}/attempts/${attempt}/jobs?per_page=100`,
  ]);
  return { r, attempt, jobs: JSON.parse(text).jobs };
});
const failed = jobsets.flatMap(({ r, attempt, jobs }) =>
  jobs.filter((j) => j.conclusion === "failure").map((j) => ({ r, attempt, j })),
);
await pool(failed, 6, async ({ r, attempt, j }) => {
  let log = "";
  try {
    log = await cached(join(cache, "logs", `${j.id}.log`), ["api", "--allow-escape-sequences", `${REPO}/jobs/${j.id}/logs`]);
  } catch (error) {
    log = `(log unavailable: ${String(error.message).slice(0, 100)})`;
  }
  const steps = j.steps.filter((s) => s.conclusion === "failure").map((s) => s.name);
  // The check run's failure annotations name each failed test (path, title, message); nested
  // fixture output in the log also prints FAIL lines, so the log is parsed only without them.
  let tests = [];
  try {
    const notes = JSON.parse(
      await cached(join(cache, "logs", `${j.id}.annotations.json`), [
        "api",
        `repos/hearsay-tools/squeal/check-runs/${j.id}/annotations?per_page=100`,
      ]),
    );
    tests = notes
      // A fixture's own Vitest inherits GITHUB_ACTIONS and annotates its planted failures.
      .filter((a) => a.annotation_level === "failure" && a.path !== ".github" && !a.path.startsWith("test/fixtures/"))
      .map((a) => {
        // The title starts with the test file; the path is where the error was thrown (a helper).
        const [head, ...rest] = (a.title ?? "").split(" > ");
        const titled = /^(test|src)\/\S+\.test\.ts$/.test(head);
        return {
          file: titled ? head : a.path,
          test: (titled ? rest.join(" > ") : a.title ?? "").slice(0, 300),
          thrownIn: a.path,
          error: (a.message ?? "").split("\n")[0].slice(0, 300),
        };
      });
  } catch {}
  if (!tests.length) tests = parse(log).map((t) => ({ ...t, fromLog: true }));
  process.stdout.write(
    `${JSON.stringify({
      run: r.databaseId,
      attempt,
      runAttempts: r.attempt,
      runConclusion: r.conclusion,
      branch: r.headBranch,
      event: r.event,
      sha: r.headSha,
      created: r.createdAt,
      job: j.name,
      jobId: j.id,
      steps,
      tests,
    })}\n`,
  );
});
