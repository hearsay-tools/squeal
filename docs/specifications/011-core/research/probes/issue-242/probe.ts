// Throwaway decision-boundary probe. Starts no daemon or test runner and writes no store.
import assert from "node:assert/strict";
import {
  selectionResult,
  resultCode,
  type SelectionRead,
} from "../../../../../../src/cli/verdict.js";
import type { RevisionNumber } from "../../../../../../src/core/types/common.js";

const base: SelectionRead = {
  outcome: "settled",
  verdict: {
    revision: 12 as RevisionNumber,
    testFiles: 2,
    byClass: { current: 2, pending: 0, stale: 0, unknown: 0 },
    unlisted: false,
    failures: { tests: 0, testFiles: 0 },
  },
  sync: { state: "synced", revision: 12 as RevisionNumber, incarnation: null },
  unmatched: 0,
  notRun: 0,
};
const cases: [string, Partial<SelectionRead>, string, number][] = [
  ["current and synced", {}, "pass", 0],
  ["current with failure", {
    verdict: { ...base.verdict, failures: { tests: 1, testFiles: 0 } },
  }, "fail", 1],
  ["current but unlisted", {
    outcome: "timeout", verdict: { ...base.verdict, unlisted: true },
  }, "none:unlisted", 3],
  ["current but unsynced", {
    outcome: "timeout", sync: { state: "pending" },
  }, "none:unsynced", 3],
  ["current, unlisted and unsynced", {
    outcome: "timeout", sync: { state: "pending" },
    verdict: { ...base.verdict, unlisted: true },
  }, "none:unsynced", 3],
  ["current with no daemon", { outcome: "no-daemon" }, "none:no-daemon", 3],
  ["focused without a failed check", { outcome: "focused" }, "none:focused", 3],
];
for (const [name, overrides, expected, expectedCode] of cases) {
  const read = { ...base, ...overrides };
  const result = selectionResult(read);
  const word = result.result === "none" ? `${result.result}:${result.reason}` : result.result;
  const code = resultCode(result);
  assert.equal(word, expected);
  assert.equal(code, expectedCode);
  console.log(JSON.stringify({ name, input: read, result, code }));
}
console.log("PASS: 7 synthetic decision cases; no daemon, runner or store used.");
