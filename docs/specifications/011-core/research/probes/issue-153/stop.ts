// Throwaway synthetic input probe. Imports production decisions; no daemon or test runner.
import { cpus, loadavg } from "node:os";
import { registeredMetaKey } from "../../../../../../src/core/delivery/registered.ts";
import { unchangedSinceRegistration } from "../../../../../../src/harness/shared/no-edit.ts";
import { requiredStep } from "../../../../../../src/harness/shared/stop-required.ts";
import { lintOpenReason } from "../../../../../../src/harness/shared/stop-lint.ts";
import { momentHolds } from "../../../../../../src/core/scheduler/slow-trigger.ts";
const load = loadavg()[0];
console.log(JSON.stringify({ node: process.version, load, cpus: cpus().length }));
if (load > cpus().length) process.exit(2);
const consumer = { worktreeId: "probe", sessionId: "probe", agentId: "main" };
const required = {
  groups: [],
  lintGroups: ["lint"],
  lintGroupOf: () => "lint",
  groupOf: () => null,
};
for (const scenario of [
  { name: "registered after scan, daemon recorded", scanned: 1, daemon: { startedAt: 1 } },
  { name: "registered before scan, daemon recorded", scanned: undefined, daemon: { startedAt: 1 } },
  { name: "registered after scan, daemon cleared", scanned: 1, daemon: null },
  { name: "registered before scan, daemon cleared", scanned: undefined, daemon: null },
]) {
  const store = {
    meta: {
      get: (key: string) =>
        key === registeredMetaKey("probe")
          ? JSON.stringify({ "probe\nmain": { since: 0, gaps: [], scanned: scenario.scanned } })
          : null,
    },
    worktrees: { get: () => ({ daemon: scenario.daemon }) },
    revisions: { latest: () => null },
  };
  const lint = {
    open: () => ({
      lint: { enabled: true },
      store: {
        states: {
          list: () => [
            { check: { tool: "eslint", path: "untouched.js" }, outcome: "pending", stale: false },
          ],
        },
        close() {},
      },
    }),
  };
  const context = { store, consumer, lint };
  const read = {
    states: [],
    keys: [],
    header: { revision: 0, runnerPartPending: false },
    current: [],
  };
  // Deliberately partial inputs expose the decision boundary, not a stored incident.
  const step = requiredStep(context as never, required as never, read as never, {
    untold: null,
    at: Date.now(),
    command: "squeal",
  });
  console.log(
    JSON.stringify({
      scenario: scenario.name,
      unchanged: unchangedSinceRegistration(store as never, consumer),
      step,
      reason: step?.kind === "open" ? lintOpenReason(0, step.open.lint) : null,
    }),
  );
}
const context = {
  store: { revisions: { latest: () => null }, consumers: { list: () => [] } },
  worktreeId: "probe",
  now: () => Date.now(),
};
for (const at of ["edit", "pause", "stop", "commit", "manual"])
  console.log(
    JSON.stringify({
      noRevision: true,
      moment: at,
      admittedByMoment: momentHolds(context as never, { at, quietMs: 15000 } as never),
    }),
  );
