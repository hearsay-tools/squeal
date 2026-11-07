// Throwaway research probe: synthetic revisions and lint states, real Codex hook functions.
import { cpus, loadavg } from "node:os";
import { expect, it } from "vitest";
import { readPolicy } from "../../../../../../src/core/daemon/policy.js";
import { registeredMetaKey } from "../../../../../../src/core/delivery/registered.js";
import { readStopHolds } from "../../../../../../src/core/delivery/turn.js";
import { isLintStoreOpenFailure, openLintStore } from "../../../../../../src/core/lint/store/open.js";
import { stopRequired } from "../../../../../../src/core/state/required.js";
import { parseCodexInput } from "../../../../../../src/harness/codex/input.js";
import { unchangedSinceRegistration } from "../../../../../../src/harness/shared/no-edit.js";
import { squealRepo } from "../../../../../../test/harness/helpers.js";
import {
  decision,
  HARNESSES,
  listenAsDaemon,
  mainConsumer,
  markStopWait,
} from "../../../../../../test/harness/stop-slow-helpers.js";

const harness = HARNESSES.find((h) => h.name === "codex");
if (harness === undefined) throw new Error("Codex helper missing");
const host = {
  at: new Date().toISOString(),
  node: process.version,
  load: loadavg()[0],
  cpus: cpus().length,
};
console.log(JSON.stringify({ host }));
if (host.load > host.cpus) throw new Error("Skipped: one-minute load exceeds CPU count");

const cases = [
  {
    name: "same revision and scanned daemon",
    revision: false,
    scan: true,
    intent: "parent-reply",
    hold: false,
  },
  {
    name: "clean revision after reset/build, parent wait",
    revision: true,
    scan: true,
    intent: "parent-reply",
    hold: true,
  },
  {
    name: "clean revision after reset/build, CI wait",
    revision: true,
    scan: true,
    intent: "ci",
    hold: true,
  },
  {
    name: "clean revision after reset/build, complete",
    revision: true,
    scan: true,
    intent: "complete",
    hold: true,
  },
  {
    name: "same revision, scan evidence absent",
    revision: false,
    scan: false,
    intent: "parent-reply",
    hold: true,
  },
] as const;

it.each(cases)("$name", async (scenario) => {
  const r = squealRepo();
  r.apply(r.pass());
  r.policy({
    lint: { enabled: true, blocking: false },
    checks: [{ name: "lint", lint: true, at: "stop" }],
    stop: { slowWaitMs: 150, maxHolds: 1 },
  });
  await harness.startTurn(r);
  markStopWait(r, harness.name);
  const consumer = mainConsumer(r);
  if (!scenario.scan) {
    r.store.meta.set(
      registeredMetaKey(r.worktreeId),
      JSON.stringify({
        [`${consumer.sessionId}\n${consumer.agentId}`]: { since: 1, gaps: [] },
      }),
    );
  }
  if (scenario.revision) {
    // Inject an observed generated-file change with clean commit metadata.
    // This does NOT run git reset, a build, a watcher, or a real Cezar wait.
    r.store.transaction(() =>
      r.store.revisions.append({
        worktreeId: r.worktreeId,
        createdAt: Date.now(),
        head: "a".repeat(40),
        dirty: false,
        trigger: "watch",
        changes: [{ path: "dist/cockpit.js", oldHash: "old", newHash: "new" }],
      }),
    );
  }
  const policy = readPolicy(r.root);
  const lint = openLintStore(r.repo.commonDir, policy);
  if (isLintStoreOpenFailure(lint)) throw new Error(JSON.stringify(lint));
  try {
    lint.transaction(() =>
      lint.states.upsertMany([
        {
          worktreeId: r.worktreeId,
          check: { kind: "lint", tool: "eslint", path: "src/untouched.js" },
          outcome: "pending",
          judged: null,
          stale: false,
          reason: null,
          changedAt: 0,
        },
      ]),
    );
  } finally {
    lint.close();
  }
  const asked: string[] = [];
  await listenAsDaemon(r.store, r.worktreeId, {
    requestGroup: async (group) => {
      asked.push(group);
      return { revision: r.store.revisions.latest(r.worktreeId)?.number ?? 0, queued: 1 };
    },
  });
  // Deliberately invented hints test parser behaviour, not a documented harness signal.
  const hints = {
    external_wait: scenario.intent,
    completion_claimed: scenario.intent === "complete",
  };
  const base = { session_id: consumer.sessionId, cwd: r.root, hook_event_name: "Stop" };
  expect(parseCodexInput(JSON.stringify({ ...base, ...hints }))).toEqual(
    parseCodexInput(JSON.stringify(base)),
  );
  const unchanged = unchangedSinceRegistration(r.store, consumer);
  const quick = decision(await harness.stop(r, hints));
  expect(quick).toEqual({});
  const started = performance.now();
  const waiting = decision(await harness.stopSlow(r, hints));
  const elapsedMs = Math.round(performance.now() - started);
  expect(waiting.decision).toBe(scenario.hold ? "block" : undefined);
  expect(asked).toEqual(scenario.hold ? ["lint"] : []);
  if (scenario.hold) {
    expect(waiting.reason).toContain("1 lint check is still not linted");
    expect(waiting.reason).toContain("Stop's last hold this turn");
    expect(elapsedMs).toBeGreaterThanOrEqual(140);
  }
  const holds = readStopHolds(r.store, consumer);
  expect(holds).toBe(scenario.hold ? 1 : 0);
  const again = decision(await harness.stopSlow(r, { stop_hook_active: true, ...hints }));
  expect(again).toEqual({});
  console.log(
    JSON.stringify({
      scenario: scenario.name,
      unchanged,
      revision: r.store.revisions.latest(r.worktreeId)?.number,
      dirty: r.store.revisions.latest(r.worktreeId)?.dirty,
      waitMs: stopRequired(policy)?.waitMs,
      asked,
      elapsedMs,
      holds,
      reason: waiting.reason?.split("\n\n")[0],
      again,
    }),
  );
});
