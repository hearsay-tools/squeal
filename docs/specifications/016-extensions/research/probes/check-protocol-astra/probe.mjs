// Throwaway converter for this fixture's flat Node TAP output only.
// Not a TAP parser or a proposed Squeal adapter.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const testFile = { project: "probe", path: "fixture.mjs" };

function convert(tap, status, signal) {
  const results = [];
  const points = [...tap.matchAll(/^(not ok|ok) (\d+) -? ?(.*)\n([\s\S]*?)(?=^# Subtest:|^1\.\.|$(?![\s\S]))/gm)];
  for (const point of points) {
    const skipped = point[3].includes(" # SKIP");
    const fullName = point[3].split(" # SKIP")[0];
    const outcome = skipped ? "skip" : point[1] === "ok" ? "pass" : "fail";
    const body = point[4];
    const locationMatch = body.match(/^  location: 'fixture\.mjs:(\d+):(\d+)'$/m);
    const location = locationMatch
      ? { path: "fixture.mjs", line: Number(locationMatch[1]), column: Number(locationMatch[2]) }
      : null;
    const errorMessage = body.match(/^  error: '([^']*)'$/m)?.[1];
    results.push({
      check: { kind: "test", project: testFile.project, testPath: testFile.path, fullName },
      outcome,
      durationMs: Number(body.match(/^  duration_ms: ([\d.]+)$/m)?.[1] ?? 0),
      location,
      errors: outcome === "fail" ? [{
        name: body.match(/^  name: '([^']*)'$/m)?.[1] ?? "Error",
        message: errorMessage ?? "failure without a parsed error",
        stack: body.match(/^  stack: \|-\n((?:    .*\n)+)/m)?.[1].replace(/^    /gm, "").trimEnd() ?? null,
        location,
        diff: null,
        code: body.match(/^  code: '([^']*)'$/m)?.[1],
      }] : [],
    });
  }
  // A test failure is a completed run. An incomplete stream proves no completion.
  // Only this known producer's normal exits, final plan and summary are accepted.
  const plan = tap.match(/^1\.\.(\d+)$/m);
  const duration = tap.match(/^# duration_ms ([\d.]+)$/m);
  const complete = signal === null && (status === 0 || status === 1) &&
    plan !== null && Number(plan[1]) === results.length && duration !== null &&
    !/^Bail out!/m.test(tap);
  return {
    end: complete ? "completed" : "crashed",
    durationMs: Number(duration?.[1] ?? 0),
    completedFiles: complete ? [testFile] : [],
    results: complete ? results : [],
    fileErrors: [],
    failure: complete ? null : "incomplete fixture TAP or abnormal child exit",
  };
}

const child = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "fixture.mjs"], {
  cwd: here,
  encoding: "utf8",
  timeout: 10000,
});
assert.equal(child.error, undefined);
assert.equal(child.status, 1, "the deliberate assertion failure must exit 1");
assert.equal(child.signal, null);
const tap = child.stdout.replaceAll("file://" + here + "/", "").replaceAll(here + "/", "");
const report = convert(tap, child.status, child.signal);
assert.equal(report.end, "completed");
assert.deepEqual(report.results.map(({ outcome }) => outcome), ["pass", "fail", "skip"]);
assert.equal(report.results[1].errors[0].message, "deliberate probe failure");
assert.deepEqual(report.results[1].location, { path: "fixture.mjs", line: 5, column: 1 });
assert.equal(report.results[0].location, null, "passing locations are absent from this TAP");
assert.deepEqual(report.completedFiles, [testFile]);

const truncated = convert(tap.slice(0, tap.indexOf("1..3")), child.status, child.signal);
assert.equal(truncated.end, "crashed");
assert.deepEqual(truncated.completedFiles, []);
assert.deepEqual(truncated.results, []);
const killed = convert(tap, null, "SIGTERM");
assert.equal(killed.end, "crashed");
assert.deepEqual(killed.completedFiles, []);

writeFileSync(join(here, "output.tap"), tap);
writeFileSync(join(here, "run-report.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(join(here, "incomplete-report.json"), JSON.stringify(truncated, null, 2) + "\n");
const summary = `${process.version}: fixture exit 1 (deliberate); mapped pass/fail/skip; one completed file; truncated and signalled runs trusted no results.\n`;
writeFileSync(join(here, "verification.txt"), summary);
process.stdout.write(summary);
