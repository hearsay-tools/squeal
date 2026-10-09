import { describe, expect, it } from "vitest";
import { createDelivery, formatRegistration } from "../../src/core/delivery/index.js";
import { publishSlowActivity, recordSlowArtifacts } from "../../src/core/slow/state.js";
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
  ran,
  revise,
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

/*
 * Spec 004 D8: headers and `squeal status` carry one slow-tier line when the
 * repository declares slow files, in each of its states: current against the
 * artifact at a revision (sources changed since or not), running since a
 * time with the last run's duration, pending with the daemon's reason, and
 * not run at this revision.
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

  it("says current against the artifact at a revision, and that sources changed since", () => {
    const s = seed(SLOW_POLICY, { revisions: 3 });
    closes(s.store, FAST, [FAST, "src/a.ts"]);
    states(s.store, s.repo, [{ observedAt: 2 }, { observedAt: 2 }, {}], [SLOW_A, SLOW_B, FAST]);
    ran(s.store, s.repo, [SLOW_A, SLOW_B]);
    const header = readHeader(s.store, s.repo.mainId);
    expect(header.slowTier).toMatchObject({
      testFiles: 2,
      current: 2,
      pending: 0,
      notRun: 0,
      currentAt: 2,
      artifact: ["plugins/**"],
      sourcesChangedSince: true,
    });
    expect(header.slowPending).toEqual({ testFiles: 0, checks: 0, testFilesWithoutChecks: 0 });
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 current against plugins/** as of revision 2, sources changed since. Not covered by Stop's wait.",
    );
  });

  it("does not say sources changed when only the artifact changed since", () => {
    const s = seed(SLOW_POLICY, { revisions: 3, changes: ["plugins/claude-code/dist/a.js"] });
    states(s.store, s.repo, [{ observedAt: 2 }, { observedAt: 2 }], [SLOW_A, SLOW_B]);
    ran(s.store, s.repo, [SLOW_A, SLOW_B]);
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 current against plugins/** as of revision 2. Not covered by Stop's wait.",
    );
  });

  it("does not say sources changed when only test files changed since (lessons defect 8a)", () => {
    const s = seed(SLOW_POLICY, { revisions: 2, changes: ["plugins/a.js"] });
    revise(s.store, s.repo, [SLOW_A, FAST, "test/e2e/fixtures/app.json"]);
    closes(s.store, SLOW_A, [SLOW_A, FAST, "test/e2e/fixtures/app.json"]);
    states(s.store, s.repo, [{ observedAt: 2 }, { observedAt: 2 }], [SLOW_A, SLOW_B]);
    ran(s.store, s.repo, [SLOW_A, SLOW_B]);
    expect(readHeader(s.store, s.repo.mainId).slowTier?.sourcesChangedSince).toBe(false);
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 current against plugins/** as of revision 2. Not covered by Stop's wait.",
    );
  });

  it("names every revision the current results ran at (lessons defect 8b)", () => {
    const s = seed(SLOW_POLICY, { revisions: 2, changes: ["plugins/a.js"] });
    states(s.store, s.repo, [{ observedAt: 1 }, { observedAt: 2 }], [SLOW_A, SLOW_B]);
    ran(s.store, s.repo, [SLOW_A, SLOW_B]);
    expect(readHeader(s.store, s.repo.mainId).slowTier).toMatchObject({
      currentAt: 1,
      currentUpTo: 2,
    });
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 current against plugins/** as of revisions 1 to 2. Not covered by Stop's wait.",
    );
  });

  it("says no sources changed for inherited results in a fresh worktree (lessons defect 8d)", () => {
    // Its first listing makes no revision: the start walk seeds the files beneath linked directories (001-166).
    const s = seed(SLOW_POLICY, { revisions: 0 });
    const inherited = { kind: "inherited", worktreeId: "other", commit: "c0" } as const;
    states(
      s.store,
      s.repo,
      [
        { observedAt: 0, origin: inherited },
        { observedAt: 0, origin: inherited },
      ],
      [SLOW_A, SLOW_B],
    );
    recordSlowArtifacts(
      s.store,
      "other",
      new Map([SLOW_A, SLOW_B].map((p) => [`key-${p}`, ["plugins/**"]])),
    );
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 current against plugins/** as of revision 0. Not covered by Stop's wait.",
    );
  });

  it.each([
    ["an agent's add in a watch batch", "watch"],
    ["an add made while no daemon ran", "start"],
    ["an add only interval reconciliation found", "interval"],
  ] as const)(
    "counts %s at a worktree's first revision as sources changed (review wave 4 B4, wave 4.5 B2)",
    (_, trigger) => {
      const s = seed(SLOW_POLICY, { revisions: 0 });
      states(s.store, s.repo, [{ observedAt: 0 }, { observedAt: 0 }], [SLOW_A, SLOW_B]);
      ran(s.store, s.repo, [SLOW_A, SLOW_B]);
      revise(s.store, s.repo, ["src/new.ts"], { added: true, trigger });
      // Its importer's edit keyed it into a closure (lessons defect 18).
      closes(s.store, FAST, [FAST, "src/a.ts", "src/new.ts"]);
      expect(readHeader(s.store, s.repo.mainId).slowTier).toMatchObject({
        currentAt: 0,
        sourcesChangedSince: true,
      });
      expect(slowLine(status(s))).toBe(
        "Slow tier: 2 test files; 2 current against plugins/** as of revision 0, sources changed since. Not covered by Stop's wait.",
      );
    },
  );

  it("counts adds in a later interval pass", () => {
    const s = seed(SLOW_POLICY, { revisions: 1, changes: ["plugins/a.js"] });
    states(s.store, s.repo, [{ observedAt: 1 }, { observedAt: 1 }], [SLOW_A, SLOW_B]);
    ran(s.store, s.repo, [SLOW_A, SLOW_B]);
    revise(s.store, s.repo, ["src/new.ts"], { added: true, trigger: "interval" });
    closes(s.store, FAST, [FAST, "src/a.ts", "src/new.ts"]);
    expect(readHeader(s.store, s.repo.mainId).slowTier?.sourcesChangedSince).toBe(true);
  });

  it("says when no artifact is declared", () => {
    const s = seed({ slow: SLOW_POLICY.slow }, { revisions: 2 });
    states(s.store, s.repo, [{ observedAt: 2 }, { observedAt: 2 }], [SLOW_A, SLOW_B]);
    ran(s.store, s.repo, [SLOW_A, SLOW_B], []);
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 current at revision 2, against no declared artifact. Not covered by Stop's wait.",
    );
  });

  it("says running since HH:MM with the last run's duration", () => {
    const s = seed();
    states(s.store, s.repo, [{ observedAt: 2 }], [SLOW_B]);
    ran(s.store, s.repo, [SLOW_B]);
    keys(s.store, s.repo, { [SLOW_A]: "running" });
    const since = NOW - 30_000;
    publishSlowActivity(s.store, s.repo.mainId, {
      kind: "running",
      path: SLOW_A,
      since,
      lastDurationMs: 72_000,
    });
    expect(slowLine(status(s))).toBe(
      `Slow tier: 2 test files; 1 current against plugins/** as of revision 2; running ${SLOW_A} since ${clockText(since)} (last run 1 min 12 s). Not covered by Stop's wait; \`squeal run --slow\` runs them now.`,
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
      `Slow tier: 2 test files; running 2 slow files since ${clockText(since)}: ${SLOW_A} and ${SLOW_B} (longest last run 1 min 12 s). Not covered by Stop's wait; \`squeal run --slow\` runs them now.`,
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
      `Slow tier: 3 test files; running 3 slow files since ${clockText(since)}: ${SLOW_A}, ${SLOW_B} and 1 more (no earlier run). Not covered by Stop's wait; \`squeal run --slow\` runs them now.`,
    );
  });

  it("names only the files still running, and counts the queued ones as pending (004-35)", () => {
    const s = seed();
    states(s.store, s.repo, [{ observedAt: 2 }], [SLOW_A]);
    ran(s.store, s.repo, [SLOW_A]);
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
      `Slow tier: 4 test files; 1 current against plugins/** as of revision 2; 3 pending, running 2 slow files since ${clockText(since)}: ${SLOW_B} and ${SLOW_C} (longest last run 12 s). Not covered by Stop's wait; \`squeal run --slow\` runs them now.`,
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
    ran(s.store, s.repo, [SLOW_A]);
    keys(s.store, s.repo, { [SLOW_B]: "queued" });
    publishSlowActivity(s.store, s.repo.mainId, {
      kind: "running",
      path: SLOW_A,
      since: NOW - 30_000,
      lastDurationMs: null,
    });
    expect(readHeader(s.store, s.repo.mainId).slowTier?.activity).toBeNull();
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 1 current against plugins/** as of revision 2; 1 pending. Not covered by Stop's wait; `squeal run --slow` runs them now.",
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
    });
    expect(slowLine(status(s))).toBe(
      `Slow tier: 2 test files; ${words}. Not covered by Stop's wait; \`squeal run --slow\` runs them now.`,
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

  it("says not run at this revision for stale and never-run slow files", () => {
    const s = seed();
    states(s.store, s.repo, [{ validity: "stale", observedAt: 1 }], [SLOW_A]);
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 not run at revision 2. Not covered by Stop's wait; `squeal run --slow` runs them now.",
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
      "Slow tier: 2 test files; 1 pending, waiting for the agent to pause; 1 not run at revision 2. Not covered by Stop's wait; `squeal run --slow` runs them now.",
    );
    expect(lines[3]).toBe("Known failures: 0");
    expect(slowLine(status(s))).toBe(lines[2]);
    const snapshot = readStatus(s.repo.main, { now: () => NOW }) as StatusSnapshot;
    expect(snapshot.slowTier).toEqual(registration.header.slowTier);
  });
});
