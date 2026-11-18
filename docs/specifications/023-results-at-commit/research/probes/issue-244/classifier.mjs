// Throwaway classifier probe. No browser, checkout, store or test runner is started.
import assert from "node:assert/strict";
import {
  errorKind,
  proofExit,
  redOnAssertion,
  verdictOf,
} from "../../../../../../src/core/proof/verdict.ts";

const spec = "packages/web/e2e/automations-disabled.e2e.ts";
const helper = "packages/web/e2e/agent-browser.ts";
const wait = {
  name: "Error",
  message: "predicate never became truthy: document.body.textContent.includes('Automations are off')",
  stack: `Error: predicate never became truthy\n    at AgentBrowser.waitForFunction (${helper}:551:13)\n    at ${spec}:35:11`,
  location: { file: helper, line: 551, column: 13 },
  diff: null,
};
const cases = [
  ["reported-shaped helper Error", wait, "error", false],
  ["Error located directly in spec", { ...wait, stack: `Error: wait failed\n    at ${spec}:35:11`, location: { file: spec, line: 35, column: 11 } }, "error", false],
  ["runner-marked timeout", { ...wait, loadAverage: 12 }, "timeout", false],
  ["AssertionError control", { ...wait, name: "AssertionError" }, "assertion", true],
  ["ERR_ASSERTION control", { ...wait, code: "ERR_ASSERTION" }, "assertion", true],
  ["assertion during setup", { ...wait, name: "AssertionError", phase: "setup" }, "setup", false],
];

for (const [label, error, expectedKind, expectedEligible] of cases) {
  const red = { end: "fail", failures: [{ test: "automations disabled", errors: [error] }] };
  const eligible = redOnAssertion(red);
  // Use the production eligibility predicate; a passing green is synthetic.
  const result = verdictOf(red, eligible ? { end: "pass" } : null);
  const exit = proofExit([result.verdict]);
  assert.equal(errorKind(error), expectedKind);
  assert.equal(eligible, expectedEligible);
  assert.equal(result.verdict, expectedEligible ? "proven" : "red for another reason");
  assert.equal(exit, expectedEligible ? 0 : 3);
  console.log(JSON.stringify({ label, kind: errorKind(error), greenEligible: eligible, ...result, exit }));
}
