import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDelivery, formatRegistration } from "../../src/core/delivery/index.js";
import { publishSlowActivity, recordSlowArtifacts } from "../../src/core/slow/state.js";
import { clockText, readHeader } from "../../src/core/state/index.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import type {
  Consumer,
  KnownState,
  SlowTierActivity,
  StatusSnapshot,
  Store,
} from "../../src/core/types/index.js";
import { fixedStatus } from "../delivery/fakes.js";
import { check, type FakeRepo, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Spec 004 D8: headers and `squeal status` carry one slow-tier line when the
 * repository declares slow files, in each of its states: current against the
 * artifact at a revision (sources changed since or not), running since a
 * time with the last run's duration, pending with the daemon's reason, and
 * not run at this revision.
 */

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const SLOW_A = "test/e2e/a.test.ts";
const SLOW_B = "test/e2e/b.test.ts";
const FAST = "src/a.test.ts";
const SLOW_POLICY = {
  slow: { include: ["test/e2e/**/*.test.ts"] },
  inputs: { "test/e2e/**/*.test.ts": ["plugins/**"] },
};

interface Seeded {
  readonly repo: FakeRepo;
  readonly store: Store;
}

/**
 * The main worktree with a live daemon, `policy` written, revisions 1 to
 * `revisions` each changing `changes`, and keys for two slow files and a
 * fast one, none pending.
 */
function seed(
  policy: object | null = SLOW_POLICY,
  { revisions = 2, changes = ["src/a.ts"], alive = true } = {},
): Seeded {
  const repo = fakeRepo();
  if (policy !== null) writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify(policy));
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: alive
      ? {
          socketPath: "/run/squeal.sock",
          startedAt: NOW - 60_000,
          heartbeatAt: NOW - 1_000,
          heartbeatIntervalMs: 5_000,
          squealVersion: "0.0.0",
        }
      : null,
  });
  store.transaction(() => {
    for (let n = 1; n <= revisions; n++) {
      store.revisions.append({
        worktreeId: repo.mainId,
        createdAt: n,
        head: null,
        dirty: true,
        trigger: "watch",
        changes: changes.map((path) => ({ path, oldHash: null, newHash: `h${n}` })),
      });
    }
  });
  keys(store, repo, { [SLOW_A]: null, [SLOW_B]: null, [FAST]: null });
  return { repo, store };
}

/** Appends one revision changing `changes`; an add when `added`, as a fresh worktree's first listing is. */
function revise(store: Store, repo: FakeRepo, changes: string[], added = false) {
  store.revisions.append({
    worktreeId: repo.mainId,
    createdAt: 9,
    head: null,
    dirty: true,
    trigger: "interval",
    changes: changes.map((path) => ({ path, oldHash: added ? null : "h0", newHash: "h9" })),
  });
}

function keys(store: Store, repo: FakeRepo, pending: Record<string, "queued" | "running" | null>) {
  store.testFileKeys.upsertMany(
    Object.entries(pending).map(([path, phase]) => ({
      worktreeId: repo.mainId,
      testFile: { project: "", path },
      key: `key-${path}`,
      revision: 1,
      pending: phase,
    })),
  );
}

function states(
  store: Store,
  repo: FakeRepo,
  list: readonly Partial<KnownState>[],
  paths: string[],
) {
  store.knownStates.upsertMany(
    paths.map((path, i) => state(repo.mainId, check(path, "works"), list[i] ?? {})),
  );
}

/** The slow runs of `paths` at their keys were declared to test `globs` (`recordSlowArtifacts`). */
function ran(store: Store, repo: FakeRepo, paths: string[], globs: string[] = ["plugins/**"]) {
  recordSlowArtifacts(store, repo.mainId, new Map(paths.map((path) => [`key-${path}`, globs])));
}

function status({ repo, store }: Seeded): string {
  store.close();
  return formatStatus(readStatus(repo.main, { now: () => NOW }), NOW);
}

function slowLine(text: string): string | undefined {
  return text.split("\n").find((line) => line.startsWith("Slow tier:"));
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

  it("does not count a fresh worktree's first listing as sources changed (lessons defect 8d)", () => {
    const s = seed(SLOW_POLICY, { revisions: 0 });
    revise(s.store, s.repo, ["src/a.ts", "plugins/a.js", SLOW_A, SLOW_B], true);
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
  ])("says pending with the daemon's reason: %j", (activity, words) => {
    const s = seed();
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
