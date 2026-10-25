import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
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

/**
 * A fresh temporary directory, removed after the test. The removal retries:
 * a detached stand-in CLI that a hook spawned (`quietCli`) can still write
 * its marker after the hook returned, so a single pass can meet
 * `ENOTEMPTY` under load (001 `reviews/wave-10d.md` N4, and its Codex twin).
 */
export function tempDir(prefix = "squeal-store-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  );
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

/**
 * Row 011-226: the store, created when missing, gains a `fault` table whose
 * index lists another column than the one it indexes. Every page is sound, so
 * `quick_check` passes; `integrity_check` lists the rows missing from the
 * index. Node 24's `defensive` option, which `@types/node` 22 lacks, is off,
 * so the schema can be written.
 */
export function seedIndexFault(commonDir: string): void {
  const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
  store.close();
  const options = { open: true, defensive: false };
  const db = new DatabaseSync(storePaths(commonDir).database, options);
  try {
    db.exec("PRAGMA busy_timeout = 10000");
    db.exec("CREATE TABLE fault(a INTEGER, b INTEGER); CREATE INDEX fault_a ON fault(a)");
    db.exec("INSERT INTO fault VALUES (1, 30), (2, 20), (3, 10)");
    db.exec("PRAGMA writable_schema = ON");
    db.exec(
      "UPDATE sqlite_schema SET sql = 'CREATE INDEX fault_a ON fault(b)' WHERE name = 'fault_a'",
    );
  } finally {
    db.close();
  }
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
