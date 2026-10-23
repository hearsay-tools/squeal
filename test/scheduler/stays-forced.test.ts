import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import type { FileState } from "../../src/core/scheduler/files.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { createStateSink } from "../../src/core/state/index.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";

/*
 * Row 011-120 (011 C4 step 5; 001-171 S1): a forced run of a file that did
 * not store its result is queued forced again while the file is at the key
 * the tier ran it at, or while a strict `run --all --force` checkpoint
 * holds it; never otherwise.
 */

const WORKTREE = "wt-120" as WorktreeId;
const FILE: TestFileRef = { project: "", path: "test/a.test.ts" };
const RAN = "a".repeat(64) as CheckKey;
const MOVED = "b".repeat(64) as CheckKey;
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A ledger over a fresh store, holding `FILE` at `MOVED`. */
function moved(): { ledger: Ledger; file: FileState } {
  const dir = mkdtempSync(join(tmpdir(), "sq-120-"));
  const store = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => store.close());
  const context = {
    store,
    sink: createStateSink(store),
    worktreeId: WORKTREE,
    policy: DEFAULT_POLICY,
    now: Date.now,
  } as unknown as SchedulerContext;
  const ledger = new Ledger(context);
  const file = ledger.addFile(FILE);
  file.key = MOVED;
  return { ledger, file };
}

describe("Ledger.staysForced (row 011-120)", () => {
  it("keeps a forced run forced at the key it ran at, and drops it at a moved one", () => {
    const { ledger, file } = moved();
    expect(ledger.staysForced(file, MOVED, true)).toBe(true);
    expect(ledger.staysForced(file, RAN, true)).toBe(false);
    expect(ledger.staysForced(file, MOVED, false)).toBe(false);
  });

  it("keeps it forced at a moved key while a strict checkpoint holds the file, and only then", () => {
    const { ledger, file } = moved();
    ledger.checkpoints.start("run-all", "run-all", 1, [FILE]);
    expect(ledger.staysForced(file, RAN, true)).toBe(false);

    ledger.checkpoints.start("forced", "run-all", 1, [FILE], true);
    expect(ledger.staysForced(file, RAN, true)).toBe(true);
    expect(ledger.staysForced(file, RAN, false)).toBe(false);
    // Its own run's result ends the hold.
    ledger.checkpoints.done(FILE, "forced");
    expect(ledger.staysForced(file, RAN, true)).toBe(false);
  });
});
