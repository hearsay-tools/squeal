// Throwaway research probe. No runner, daemon, real store or worktree is created.
import assert from "node:assert/strict";
import { cpus, loadavg } from "node:os";
import { assembleClosure, selectDeclaredInputs } from "../../../../../../src/core/keys/closure.js";
import { attribute } from "../../../../../../src/core/delivery/attribution.js";
import { registeredMetaKey } from "../../../../../../src/core/delivery/registered.js";
import { slot } from "../../../../../../src/core/delivery/slots.js";
import { closureLine } from "../../../../../../src/core/delivery/provenance.js";
import { sharedClosure } from "../../../../../../src/core/delivery/shared-closure.js";
import type { Store } from "../../../../../../src/core/types/store.js";
import type { Consumer, TransitionEntry } from "../../../../../../src/core/types/delivery.js";

console.log(`Node ${process.version}; load ${loadavg()[0]}; CPUs ${cpus().length}`);
if (loadavg()[0] > cpus().length) {
  console.log("SKIPPED: one-minute load exceeds CPU count");
  process.exit(2);
}
const changed = [
  "packages/web/src/api/queries.ts",
  "packages/web/src/routes/github/github.test.tsx",
  "packages/web/src/routes/github/use-github-refresh.ts",
];
const testFile = { project: "root:test:unit", path: "scripts/regression-proof.test.mjs" };
const runnerPaths = [testFile.path, "scripts/regression-proof.mjs"];
const declared = selectDeclaredInputs(
  { [testFile.path]: ["packages/*/src/**/*.{ts,tsx}"] },
  [...runnerPaths, ...changed], testFile.path,
);
const closure = assembleClosure({ testFile, paths: runnerPaths }, declared);
assert.deepEqual(declared, changed);
assert.equal(changed.some((p) => runnerPaths.includes(p)), false);
const consumer: Consumer = { worktreeId: "local", sessionId: "probe", agentId: "main" };
let historyReads = 0;
const otherFailures = [
  { outcome: "fail", provenance: { worktreeId: "other-dirty", revision: 50, dirty: true } },
  { outcome: "fail", provenance: { worktreeId: "other-clean", revision: 0, dirty: false } },
];
// Only methods attribute() actually reads are supplied. listForCheck offers
// synthetic history and counts whether this non-timeout PASS -> FAIL reads it.
const fakeStore = {
  meta: { get: (key: string) => key === registeredMetaKey(consumer.worktreeId)
    ? JSON.stringify({ [slot(consumer)]: { since: 0, gaps: [], scanned: 1 } }) : null },
  worktrees: { get: () => ({ daemon: { startedAt: 1 } }) },
  revisions: { range: () => [{ number: 1, trigger: "edit", changes: changed.map((path) => ({ path })) }] },
  testFiles: { get: () => ({ testFile, closure, updatedBy: consumer.worktreeId }) },
  results: { listForCheck: () => { historyReads++; return otherFailures; } },
} as unknown as Store;
const entries: TransitionEntry[] = Array.from({ length: 4 }, (_, i) => ({
  check: { kind: "test", project: testFile.project, testPath: testFile.path, fullName: `case ${i + 1}` },
  kind: "pass-to-fail", from: "pass", to: "fail", validity: "current", observedAt: 1,
  origin: { kind: "own" }, summary: "synthetic non-timeout failure", location: null,
}));
const attributed = attribute(fakeStore, consumer, entries, 1);
for (const entry of attributed) assert.deepEqual(entry.changesInClosure, changed);
console.log(`Runner imports intersect changed paths: ${JSON.stringify(runnerPaths.filter((p) => changed.includes(p)))}`);
console.log(`Declared inputs: ${JSON.stringify(declared)}`);
console.log(closureLine(attributed[0]?.changesInClosure));
console.log(sharedClosure(attributed.map((entry) => [entry.changesInClosure])).line);
console.log(`Synthetic other-worktree failures available: ${otherFailures.length} (1 clean at revision 0)`);
console.log(`Other-worktree result-history reads by attribute: ${historyReads}`);
console.log(`Attribution-added fields: ${JSON.stringify(Object.keys(attributed[0]!).filter((key) => !(key in entries[0]!)))}`);
assert.equal(historyReads, 0);
console.log("Probe assertions: PASS; synthetic revision 1, registered at revision 0");
