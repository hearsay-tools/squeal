// Throwaway research probe: real policy loader and Stop formatter, synthetic pending lint.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { readPolicy } from "../../../../../../src/core/daemon/policy.ts";
import { stopRequired } from "../../../../../../src/core/state/required.ts";
import { stepReason } from "../../../../../../src/harness/shared/stop-required.ts";

console.log(
  JSON.stringify({
    at: new Date().toISOString(),
    node: process.version,
    source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    version: JSON.parse(readFileSync("package.json", "utf8")).version,
    load1: loadavg()[0],
    cpus: cpus().length,
    liveDaemon: false,
  }),
);
const root = mkdtempSync(join(tmpdir(), "squeal-issue-156-"));
try {
  for (const [name, stop, expected] of [
    ["default", {}, 120000],
    ["custom", { slowWaitMs: 123456 }, 123456],
    ["capped", { slowWaitMs: 3600000 }, 3540000],
    ["quick-budget-only", { waitMs: 1000 }, 120000],
  ]) {
    writeFileSync(
      join(root, "squeal.config.json"),
      JSON.stringify({
        lint: { enabled: true },
        checks: [{ name: "lint", lint: true, at: "stop" }],
        stop,
      }),
    );
    const policy = readPolicy(root);
    const required = stopRequired(policy);
    assert.ok(required);
    assert.deepEqual(required.lintGroups, ["lint"]);
    assert.equal(required.waitMs, expected);
    const step = {
      kind: "open",
      open: {
        tests: [],
        refining: false,
        lint: [{ group: "lint", tool: "eslint", path: "src/a.js" }],
      },
    };
    const read = { states: [], keys: [], header: { revision: 2 } };
    const reason = stepReason(step, required, read, {
      command: "squeal",
      last: true,
      waitedMs: required.waitMs,
    });
    assert.ok(reason.includes("still not linted"));
    assert.ok(!reason.includes("stop.slowWaitMs"));
    assert.ok(!reason.includes("stop.waitMs"));
    console.log(
      JSON.stringify({
        name,
        configured: policy.stop.slowWaitMs,
        effectiveMs: required.waitMs,
        reason,
      }),
    );
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(
  "PASS: four synthetic policy/Stop-text cases; no timer wait, daemon, linter or test suite.",
);
