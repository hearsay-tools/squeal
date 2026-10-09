import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startTurn } from "../../src/core/delivery/turn.js";
import { recordSlowArtifacts } from "../../src/core/slow/state.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import type { Consumer, KnownState, RevisionTrigger, Store } from "../../src/core/types/index.js";
import { check, type FakeRepo, fakeRepo, seedStore, state } from "./helpers.js";

/* The slow-tier line's fixtures (spec 004 D8), shared by its status tests. */

export const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
export const SLOW_A = "test/e2e/a.test.ts";
export const SLOW_B = "test/e2e/b.test.ts";
export const SLOW_C = "test/e2e/c.test.ts";
export const SLOW_D = "test/e2e/d.test.ts";
export const FAST = "src/a.test.ts";
export const SLOW_POLICY = {
  slow: { include: ["test/e2e/**/*.test.ts"] },
  inputs: { "test/e2e/**/*.test.ts": ["plugins/**"] },
};

export interface Seeded {
  readonly repo: FakeRepo;
  readonly store: Store;
}

/**
 * The main worktree with a live daemon, `policy` written, revisions 1 to
 * `revisions` each changing `changes`, and keys for two slow files and a
 * fast one, none pending.
 */
export function seed(
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

/**
 * Appends one revision changing `changes`; adds when `added`. The change
 * feed's start pass is an `interval` revision, an edit an agent makes a
 * `watch` one.
 */
export function revise(
  store: Store,
  repo: FakeRepo,
  changes: string[],
  { added = false, trigger = "watch" as RevisionTrigger } = {},
) {
  store.revisions.append({
    worktreeId: repo.mainId,
    createdAt: 9,
    head: null,
    dirty: true,
    trigger,
    changes: changes.map((path) => ({ path, oldHash: added ? null : "h0", newHash: "h9" })),
  });
}

export function keys(
  store: Store,
  repo: FakeRepo,
  pending: Record<string, "queued" | "running" | null>,
) {
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

export function states(
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
export function ran(
  store: Store,
  repo: FakeRepo,
  paths: string[],
  globs: string[] = ["plugins/**"],
) {
  recordSlowArtifacts(store, repo.mainId, new Map(paths.map((path) => [`key-${path}`, globs])));
}

export function status({ repo, store }: Seeded): string {
  store.close();
  return formatStatus(readStatus(repo.main, { now: () => NOW }), NOW);
}

export function slowLine(text: string): string | undefined {
  return text.split("\n").find((line) => line.startsWith("Slow tier:"));
}

/** Registers a main agent of the worktree and puts it in a turn (001 D9), as a session working does. */
export function inTurn({ repo, store }: Seeded, sessionId = "s-busy"): Consumer {
  const consumer: Consumer = { worktreeId: repo.mainId, sessionId, agentId: "main" };
  store.transaction(() => {
    store.consumers.register(consumer, NOW);
    startTurn(store, consumer);
  });
  return consumer;
}
