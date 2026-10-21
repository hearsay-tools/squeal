import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDelivery,
  formatDelta,
  formatRegistration,
  headerLines,
  MESSAGE_CAP_CHARS,
} from "../../src/core/delivery/index.js";
import { publishSlowActivity } from "../../src/core/slow/state.js";
import { clockText, readHeader } from "../../src/core/state/index.js";
import { readStatus } from "../../src/core/status/index.js";
import type {
  Consumer,
  SlowTierActivity,
  StatusSnapshot,
  Store,
} from "../../src/core/types/index.js";
import { fixedStatus } from "../delivery/fakes.js";
import {
  FAST,
  inTurn,
  keys,
  NOW,
  SLOW_A,
  SLOW_B,
  SLOW_C,
  SLOW_D,
  SLOW_POLICY,
  seed,
  slowLine,
  states,
  status,
} from "./slow-tier-seed.js";

// Row 011-58: a status read while the daemon waits for the slow slot reads the slot's
// directory; it is a temporary one here, never the host's.
let runtime: string;
beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "squeal-slow-tier-status-"));
  vi.stubEnv("XDG_RUNTIME_DIR", runtime);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(runtime, { recursive: true, force: true });
});

/*
 * Spec 004 D8: headers and `squeal status` carry one slow-tier line when the
 * repository declares slow files, in each of its states: current at a
 * revision, running since a time with the last run's duration, pending with
 * the daemon's reason, and not run at this revision. No artifact or source
 * change is named (004 D8 as amended 2026-10-18, task 004-81).
 */

/** The stored closure of `testFile` names `paths`, as its last keying found it. */
function closes(store: Store, testFile: string, paths: string[]): void {
  const ref = { project: "", path: testFile };
  const closure = {
    testFile: ref,
    paths,
    complete: false,
    method: "static imports plus declared inputs",
  } as const;
  store.testFiles.put({ testFile: ref, closure, updatedAt: 1, updatedBy: "test" });
}

describe("the slow-tier line (spec 004 D8)", () => {
  it("is absent without slow files declared, in the header and in status", () => {
    const s = seed(null);
    expect(readHeader(s.store, s.repo.mainId).slowTier).toBeUndefined();
    expect(readHeader(s.store, s.repo.mainId).slowPending).toBeUndefined();
    expect(slowLine(status(s))).toBeUndefined();
  });

  it("says current at a revision, and names no artifact or source change since", () => {
    const s = seed(SLOW_POLICY, { revisions: 3 });
    closes(s.store, FAST, [FAST, "src/a.ts"]);
    states(s.store, s.repo, [{ observedAt: 2 }, { observedAt: 2 }, {}], [SLOW_A, SLOW_B, FAST]);
    const header = readHeader(s.store, s.repo.mainId);
    expect(header.slowTier).toEqual({
      testFiles: 2,
      current: 2,
      pending: 0,
      notRun: 0,
      currentAt: 2,
      activity: null,
    });
    expect(header.slowPending).toEqual({ testFiles: 0, checks: 0, testFilesWithoutChecks: 0 });
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 current at revision 2. Squeal runs them after the fast tests.",
    );
  });

  it("names every revision the current results ran at (lessons defect 8b)", () => {
    const s = seed(SLOW_POLICY, { revisions: 2, changes: ["plugins/a.js"] });
    states(s.store, s.repo, [{ observedAt: 1 }, { observedAt: 2 }], [SLOW_A, SLOW_B]);
    expect(readHeader(s.store, s.repo.mainId).slowTier).toMatchObject({
      currentAt: 1,
      currentUpTo: 2,
    });
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 current at revisions 1 to 2. Squeal runs them after the fast tests.",
    );
  });

  it("says running since HH:MM with the last run's duration", () => {
    const s = seed();
    states(s.store, s.repo, [{ observedAt: 2 }], [SLOW_B]);
    keys(s.store, s.repo, { [SLOW_A]: "running" });
    const since = NOW - 30_000;
    publishSlowActivity(s.store, s.repo.mainId, {
      kind: "running",
      path: SLOW_A,
      since,
      lastDurationMs: 72_000,
    });
    expect(slowLine(status(s))).toBe(
      `Slow tier: 2 test files; 1 current at revision 2; running ${SLOW_A} since ${clockText(since)} (last run 1 min 12 s). Squeal runs them after the fast tests; \`squeal run --slow --wait 60000\` waits for its result.`,
    );
  });

  it("names both files an idle tier runs, with the longest last run (004-35)", () => {
    const s = seed();
    keys(s.store, s.repo, { [SLOW_A]: "running", [SLOW_B]: "running" });
    const since = NOW - 30_000;
    publishSlowActivity(s.store, s.repo.mainId, {
      kind: "running",
      path: SLOW_A,
      paths: [SLOW_A, SLOW_B],
      since,
      lastDurationMs: 72_000,
    });
    expect(slowLine(status(s))).toBe(
      `Slow tier: 2 test files; running 2 slow files since ${clockText(since)}: ${SLOW_A} and ${SLOW_B} (longest last run 1 min 12 s). Squeal runs them after the fast tests; \`squeal run --slow --wait 60000\` waits for their results.`,
    );
  });

  it("names two of three running files and counts the rest (004-35)", () => {
    const s = seed();
    keys(s.store, s.repo, { [SLOW_A]: "running", [SLOW_B]: "running", [SLOW_C]: "running" });
    const since = NOW - 30_000;
    publishSlowActivity(s.store, s.repo.mainId, {
      kind: "running",
      path: SLOW_A,
      paths: [SLOW_A, SLOW_B, SLOW_C],
      since,
      lastDurationMs: null,
    });
    expect(slowLine(status(s))).toBe(
      `Slow tier: 3 test files; running 3 slow files since ${clockText(since)}: ${SLOW_A}, ${SLOW_B} and 1 more (no earlier run). Squeal runs them after the fast tests; \`squeal run --slow --wait 60000\` waits for their results.`,
    );
  });

  it("names only the files still running, and counts the queued ones as pending (004-35)", () => {
    const s = seed();
    states(s.store, s.repo, [{ observedAt: 2 }], [SLOW_A]);
    keys(s.store, s.repo, { [SLOW_B]: "running", [SLOW_C]: "running", [SLOW_D]: "queued" });
    const since = NOW - 30_000;
    publishSlowActivity(s.store, s.repo.mainId, {
      kind: "running",
      path: SLOW_A,
      paths: [SLOW_A, SLOW_B, SLOW_C],
      since,
      lastDurationMs: 12_000,
    });
    expect(readHeader(s.store, s.repo.mainId).slowTier?.activity).toEqual({
      kind: "running",
      path: SLOW_B,
      paths: [SLOW_B, SLOW_C],
      since,
      lastDurationMs: 12_000,
    });
    expect(slowLine(status(s))).toBe(
      `Slow tier: 4 test files; 1 current at revision 2; 3 pending, running 2 slow files since ${clockText(since)}: ${SLOW_B} and ${SLOW_C} (longest last run 12 s). Squeal runs them after the fast tests; \`squeal run --slow --wait 60000\` waits for their results.`,
    );
  });

  it("says one file runs when the others of its tier ended (004-35)", () => {
    const s = seed();
    keys(s.store, s.repo, { [SLOW_A]: "running" });
    const since = NOW - 30_000;
    publishSlowActivity(s.store, s.repo.mainId, {
      kind: "running",
      path: SLOW_B,
      paths: [SLOW_B, SLOW_A],
      since,
      lastDurationMs: null,
    });
    expect(slowLine(status(s))).toContain(
      `; running ${SLOW_A} since ${clockText(since)} (no earlier run); 1 not run at revision 2.`,
    );
  });

  it("never says a file runs that is not running: its run ended since (review wave 2, B1)", () => {
    const s = seed();
    states(s.store, s.repo, [{ observedAt: 2 }], [SLOW_A]);
    keys(s.store, s.repo, { [SLOW_B]: "queued" });
    publishSlowActivity(s.store, s.repo.mainId, {
      kind: "running",
      path: SLOW_A,
      since: NOW - 30_000,
      lastDurationMs: null,
    });
    expect(readHeader(s.store, s.repo.mainId).slowTier?.activity).toBeNull();
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 1 current at revision 2; 1 pending. Squeal runs them after the fast tests; `squeal run --slow --wait 60000` waits for its result.",
    );
  });

  it.each<[SlowTierActivity | null, string]>([
    [{ kind: "waiting", for: "idle" }, "2 pending, waiting for the agent to pause"],
    [
      { kind: "waiting", for: "slot" },
      "2 pending, waiting for the slow slot another worktree's slow tier holds",
    ],
    [{ kind: "waiting", for: "load" }, "2 pending, waiting for host load to drop"],
    [{ kind: "waiting", for: "fast" }, "2 pending, waiting for fast test files"],
    [null, "2 pending"],
  ])("says pending with the daemon's reason, an agent in a turn: %j", (activity, words) => {
    const s = seed();
    inTurn(s);
    keys(s.store, s.repo, { [SLOW_A]: "queued", [SLOW_B]: "queued" });
    publishSlowActivity(s.store, s.repo.mainId, activity);
    expect(readHeader(s.store, s.repo.mainId).slowPending).toEqual({
      testFiles: 2,
      checks: 0,
      testFilesWithoutChecks: 2,
      files: [SLOW_A, SLOW_B].map((path) => ({ project: "", path })),
    });
    expect(slowLine(status(s))).toBe(
      `Slow tier: 2 test files; ${words}. Squeal runs them after the fast tests; \`squeal run --slow --wait 60000\` waits for their results.`,
    );
  });

  it("keeps the daemon's reason when no daemon is validating, as last reported (lessons defect 8c)", () => {
    const s = seed(SLOW_POLICY, { alive: false });
    keys(s.store, s.repo, { [SLOW_A]: "queued", [SLOW_B]: "queued" });
    publishSlowActivity(s.store, s.repo.mainId, { kind: "waiting", for: "slot" });
    expect(readHeader(s.store, s.repo.mainId).slowTier?.activity).toEqual({
      kind: "waiting",
      for: "slot",
    });
    expect(slowLine(status(s))).toContain(
      "; 2 pending, last reported waiting for the slow slot another worktree's slow tier holds.",
    );
  });

  it("says not run at this revision for stale and never-run slow files, and claims no run for them (001-323)", () => {
    const s = seed();
    states(s.store, s.repo, [{ validity: "stale", observedAt: 1 }], [SLOW_A]);
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 not run at revision 2. Squeal has not queued them; `squeal run --slow --wait 60000` waits for their results.",
    );
  });

  it("says Stop waits up to its bound with stop.requireSlowSuite on (004 D8 and D9 as amended 2026-10-12)", () => {
    const on = { ...SLOW_POLICY, stop: { requireSlowSuite: true, slowWaitMs: 90_000 } };
    const s = seed(on);
    states(s.store, s.repo, [{ validity: "stale", observedAt: 1 }], [SLOW_A]);
    expect(readHeader(s.store, s.repo.mainId).slowTier?.stopWaitMs).toBe(90_000);
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 not run at revision 2. Stop waits up to 1 min 30 s for them or holds the agent once; `squeal run --slow --wait 60000` waits for their results.",
    );
    const capped = seed({
      ...SLOW_POLICY,
      stop: { requireSlowSuite: true, slowWaitMs: 3_600_000 },
    });
    expect(readHeader(capped.store, capped.repo.mainId).slowTier?.stopWaitMs).toBe(600_000);
    const off = seed({ ...SLOW_POLICY, stop: { slowWaitMs: 90_000 } });
    expect(readHeader(off.store, off.repo.mainId).slowTier).not.toHaveProperty("stopWaitMs");
  });

  it("says Squeal runs them after the fast tests with no slow files listed yet (001-317, 004-80)", () => {
    const s = seed({ ...SLOW_POLICY, slow: { include: ["test/none/**/*.test.ts"] } });
    expect(readHeader(s.store, s.repo.mainId).slowTier).toMatchObject({ testFiles: 0 });
    expect(headerLines(readHeader(s.store, s.repo.mainId), "squeal")[1]).toBe(
      "Slow tier: no slow test files listed yet; Squeal runs them after the fast tests.",
    );
    expect(slowLine(status(s))).toBe(
      "Slow tier: no slow test files listed yet; Squeal runs them after the fast tests.",
    );
  });

  it("keeps the slow-tier line in a delta held to the 10,000-character cap (001 D6)", () => {
    const s = seed();
    keys(s.store, s.repo, { [SLOW_A]: "queued" });
    const header = readHeader(s.store, s.repo.mainId);
    const consumer: Consumer = { worktreeId: s.repo.mainId, sessionId: "s", agentId: "main" };
    const entries = Array.from({ length: 2_000 }, (_, i) => ({
      kind: "first-seen-fail" as const,
      check: {
        kind: "test" as const,
        project: "",
        testPath: `t/f${i}.test.ts`,
        fullName: `c ${i}`,
      },
      from: null,
      to: "fail" as const,
      validity: "current" as const,
      observedAt: 2,
      origin: { kind: "own" as const },
      summary: "x".repeat(300),
      location: null,
    }));
    // Task 001-407: a change delivery carries the line when the slow tier changed.
    const text = formatDelta({
      schemaVersion: 1,
      consumer,
      header,
      label: "transitions",
      entries,
      slowTierChanged: true,
    });
    expect(text.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    expect(slowLine(text)).toBe(
      "Slow tier: 2 test files; 1 pending; 1 not run at revision 2. Squeal runs the pending ones after the fast tests and has not queued the rest; `squeal run --slow --wait 60000` waits for their results.",
    );
  });

  it("is the same line in a delivered registration as in status", async () => {
    const s = seed();
    keys(s.store, s.repo, { [SLOW_A]: "queued" });
    publishSlowActivity(s.store, s.repo.mainId, { kind: "waiting", for: "idle" });
    inTurn(s);
    const consumer: Consumer = { worktreeId: s.repo.mainId, sessionId: "s", agentId: "main" };
    const delivery = createDelivery(s.store, { status: fixedStatus(), now: () => NOW });
    const registration = await delivery.register(consumer);
    const delivered = formatRegistration(registration);
    const lines = delivered.split("\n");
    expect(lines[0]).toBe("SQUEAL · registered at revision 2");
    expect(lines[2]).toBe(
      "Slow tier: 2 test files; 1 pending, waiting for the agent to pause; 1 not run at revision 2. Squeal runs the pending ones after the fast tests and has not queued the rest; `squeal run --slow --wait 60000` waits for their results.",
    );
    expect(lines[3]).toBe(
      "Known failures: 0; not current: 3 of 3 test files (1 queued, 2 unknown)",
    );
    expect(slowLine(status(s))).toBe(lines[2]);
    const snapshot = readStatus(s.repo.main, { now: () => NOW }) as StatusSnapshot;
    expect(snapshot.slowTier).toEqual(registration.header.slowTier);
  });
});

/*
 * Spec 004 D8 as amended 2026-10-18 (row 004-80): the line's ending follows
 * `slow.trigger`. The tests above read the default, `"continuous"`: "after
 * the fast tests". Under `"idle"` it is "when the agent pauses", as before.
 */
describe('the slow-tier line under slow.trigger "idle" (004-80)', () => {
  const IDLE_POLICY = { ...SLOW_POLICY, slow: { ...SLOW_POLICY.slow, trigger: "idle" } };

  it("says Squeal runs them when the agent pauses, and the header carries pausesOnly", () => {
    const s = seed(IDLE_POLICY);
    states(s.store, s.repo, [{ observedAt: 2 }, { observedAt: 2 }], [SLOW_A, SLOW_B]);
    const header = readHeader(s.store, s.repo.mainId);
    expect(header.slowTier?.pausesOnly).toBe(true);
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 current at revision 2. Squeal runs them when the agent pauses.",
    );
  });

  it("says the pending ones run when the agent pauses and the rest are not queued", () => {
    const s = seed(IDLE_POLICY);
    keys(s.store, s.repo, { [SLOW_A]: "queued" });
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 1 pending; 1 not run at revision 2. Squeal runs the pending ones when the agent pauses and has not queued the rest; `squeal run --slow --wait 60000` waits for their results.",
    );
  });

  it("carries no pausesOnly under the default", () => {
    const s = seed();
    expect(readHeader(s.store, s.repo.mainId).slowTier?.pausesOnly).toBeUndefined();
  });
});
