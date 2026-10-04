import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import type {
  CheckId,
  KnownState,
  ResultRecord,
  Store,
  TestCheckId,
  WorktreeRecord,
} from "../../src/core/types/index.js";

export const DAY_MS = 24 * 60 * 60 * 1000;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A fresh temporary directory, removed after the test. */
export function tempDir(prefix = "squeal-store-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A fake git common dir: a directory with `HEAD`, like `.git`. */
export function fakeCommonDir(): string {
  const dir = join(tempDir(), ".git");
  mkdirSync(dir);
  writeFileSync(join(dir, "HEAD"), "ref: refs/heads/main\n");
  return dir;
}

/** Opens a store that must open, closed after the test. */
export function open(commonDir: string): Store {
  const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
  cleanups.push(() => store.close());
  return store;
}

export function testCheck(fullName: string, path = "src/a.test.ts"): TestCheckId {
  return { kind: "test", project: "", testPath: path, fullName };
}

export function worktree(id: string, root: string, overrides: Partial<WorktreeRecord> = {}) {
  return {
    id,
    root,
    commonDir: "/repo/.git",
    isMain: false,
    registeredAt: 1,
    daemon: null,
    ...overrides,
  } satisfies WorktreeRecord;
}

export function result(
  check: CheckId,
  key: string,
  overrides: {
    outcome?: ResultRecord["outcome"];
    worktreeId?: string;
    recordedAt?: number;
    runId?: string;
    errors?: ResultRecord["errors"];
  } = {},
): ResultRecord {
  const outcome = overrides.outcome ?? "pass";
  return {
    check,
    key,
    outcome,
    durationMs: 12,
    location: { path: "src/a.test.ts", line: 3, column: 5 },
    fingerprint:
      outcome === "fail" ? "AssertionError: expected 1 to be 2 @ src/a.test.ts:3:5" : null,
    summary: outcome === "fail" ? "expected 1 to be 2" : null,
    errors: overrides.errors ?? [],
    provenance: {
      worktreeId: overrides.worktreeId ?? "wt-main",
      revision: 4,
      commit: "abc123",
      dirty: true,
      runId: overrides.runId ?? "run-1",
      recordedAt: overrides.recordedAt ?? 1_000,
    },
  };
}

export function knownState(worktreeId: string, check: CheckId): KnownState {
  return {
    worktreeId,
    check,
    outcome: "fail",
    validity: "current",
    pendingPhase: null,
    observedAt: 3,
    commit: null,
    origin: { kind: "inherited", worktreeId: "wt-other", commit: null },
    durationMs: 7,
    location: null,
    summary: "boom",
    fingerprint: "Error: boom",
  };
}
