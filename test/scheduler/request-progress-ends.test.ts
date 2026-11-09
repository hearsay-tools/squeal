import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NOTHING_CHANGED, type SchedulerContext } from "../../src/core/scheduler/context.js";
import type { FileState } from "../../src/core/scheduler/files.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { priorityOf } from "../../src/core/scheduler/queue.js";
import { RequestProgress } from "../../src/core/scheduler/request-progress.js";
import { createStateSink } from "../../src/core/state/sink.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { ResultRecord } from "../../src/core/types/store-records.js";

/*
 * Row 018-12, review wave 3.6 B2: `RequestProgress` hears an asked file's
 * end from the ledger where it happens (`Ledger.ends`): a result from a run
 * or a lookup, or `unknown` from a crash or a timeout. A file that leaves
 * the queue with no end leaves its ask at the next commit, so its later
 * run, the scheduler's own, counts nothing; a run's end that puts the file
 * back in the queue in the same round (a discard) keeps it asked.
 */

const WORKTREE = "wt-018-12" as WorktreeId;
const KEY = "k".repeat(64) as CheckKey;
const EDITED = "e".repeat(64) as CheckKey;
const REF: TestFileRef = { project: "", path: "test/f.test.ts" };
const dirs: string[] = [];
const closes: (() => void)[] = [];

afterEach(() => {
  for (const close of closes.splice(0)) close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A real ledger whose one file is queued at `KEY` and asked by a request. */
function asked(): { ledger: Ledger; progress: RequestProgress; file: FileState } {
  const dir = mkdtempSync(join(tmpdir(), "sq-018-12-"));
  dirs.push(dir);
  const store = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  closes.push(() => store.close());
  const context = {
    store,
    sink: createStateSink(store),
    worktreeId: WORKTREE,
    policy: DEFAULT_POLICY,
    now: Date.now,
    keys: {
      runnerOf: () => undefined,
      writeRuntimeApplications: () => {},
      removeTestFile: () => {},
    },
  } as unknown as SchedulerContext;
  const ledger = new Ledger(context);
  const progress = new RequestProgress();
  ledger.ends = progress;
  const file = ledger.addFile(REF);
  file.key = KEY;
  queue(ledger, file);
  ledger.commit();
  progress.ask([file]);
  return { ledger, progress, file };
}

function queue(ledger: Ledger, file: FileState): void {
  ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED));
}

/** A tier takes `file` at its key, as `startTier` does. */
function start(ledger: Ledger, file: FileState): void {
  ledger.queue.remove(file.ref);
  ledger.setRunning(file, file.key);
  ledger.commit();
}

function passed(key: CheckKey = KEY): ResultRecord[] {
  const provenance = { worktreeId: WORKTREE, revision: 1, commit: null, dirty: false };
  return [
    {
      check: { kind: "test", project: "", testPath: REF.path, fullName: "t0" },
      key,
      outcome: "pass",
      durationMs: 1,
      location: null,
      fingerprint: null,
      summary: null,
      errors: [],
      provenance: { ...provenance, runId: "run-018-12", recordedAt: 1_000 },
    },
  ] as ResultRecord[];
}

describe("RequestProgress on the ledger's ends (row 018-12)", () => {
  it("counts a run that crashed or timed out: the file is unknown", () => {
    const { ledger, progress, file } = asked();
    start(ledger, file);
    ledger.setRunning(file, null);
    ledger.markUnknown([{ file, key: KEY }], "run crashed", { ran: true });
    expect(progress.count).toBe(1);
  });

  it("counts an end at once, so a re-run queued after it neither hides it nor counts again", () => {
    const { ledger, progress, file } = asked();
    start(ledger, file);
    ledger.setRunning(file, null);
    ledger.applyResults(file, KEY, passed(), null);
    queue(ledger, file);
    ledger.commit();
    expect(progress.count).toBe(1);
    start(ledger, file);
    ledger.setRunning(file, null);
    ledger.applyResults(file, KEY, passed(), null);
    expect(progress.count).toBe(1);
  });

  it("ends once at an unknown while an edit queued it at another key; the edit's run counts nothing", () => {
    const { ledger, progress, file } = asked();
    start(ledger, file);
    file.key = EDITED;
    queue(ledger, file);
    ledger.setRunning(file, null);
    ledger.markUnknown([{ file, key: KEY }], "run timed out", { ran: true });
    ledger.commit();
    expect(progress.count).toBe(1);
    start(ledger, file);
    ledger.setRunning(file, null);
    ledger.applyResults(file, EDITED, passed(EDITED), null);
    expect(progress.count).toBe(1);
  });

  it("keeps the ask of a file a run's end puts back in the queue in the same round", () => {
    const { ledger, progress, file } = asked();
    start(ledger, file);
    ledger.setRunning(file, null);
    ledger.discard(file, KEY);
    ledger.commit();
    expect(progress.count).toBe(0);
    start(ledger, file);
    ledger.setRunning(file, null);
    ledger.applyResults(file, KEY, passed(), null);
    expect(progress.count).toBe(1);
  });

  it("drops the ask of a file that leaves the queue with no end; its later run counts nothing", () => {
    const { ledger, progress, file } = asked();
    ledger.dequeue(file);
    ledger.commit();
    queue(ledger, file);
    start(ledger, file);
    ledger.setRunning(file, null);
    ledger.applyResults(file, KEY, passed(), null);
    expect(progress.count).toBe(0);
  });

  it("drops the ask of a file the ledger forgot", () => {
    const { ledger, progress, file } = asked();
    ledger.removeFile(file);
    ledger.commit();
    expect(progress.count).toBe(0);
  });
});
