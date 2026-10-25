import { beforeEach, describe, expect, it } from "vitest";
import { editWindow, heldPending } from "../../src/cli/status-wait-edit.js";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import { testFileId } from "../../src/core/keys/index.js";
import { NOTHING_CHANGED, type SchedulerContext } from "../../src/core/scheduler/context.js";
import type { FileState } from "../../src/core/scheduler/files.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { priorityOf } from "../../src/core/scheduler/queue.js";
import { answerMoves, movesSeq } from "../../src/core/scheduler/rekeyed-moves.js";
import { readRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import { endRerun, queueReruns, RERUN_CAP } from "../../src/core/scheduler/rerun.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  type CheckKey,
  type Consumer,
  DEFAULT_POLICY,
  daemonIncarnation,
  type HarnessDelivery,
  type ResultRecord,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { check, FILE, freshStore, result, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/** `liveDaemon`'s incarnation: the writer of its ledger's moves (task 001-268). */
const INCARNATION = daemonIncarnation({ squealVersion: "0.0.0-test", startedAt: 1, token: "live" });

/*
 * Review wave 13v, B1 (task 001-240): the first result at an edit's key
 * discharges its attribution (task 001-194), and when that result fails
 * anew, 001-171 queues a confirmation run at the same key. The settled line
 * (task 001-223) waits for that run's result, then rides once on later news;
 * `status --wait` still holds for nothing at the same key (task 001-196).
 * Here the ledger, `queueReruns`, store, sink and delivery are real, in the
 * order a tier applies them.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const OTHER_FILE: TestFileRef = { project: "", path: "src/b.test.ts" };
const A = check("a");
const B = check("b", OTHER_FILE);
const SETTLED = /your edits since revision \d+ re-keyed is current\./;
const key = (c: string) => c.repeat(64) as CheckKey;

let store: Store;
let delivery: HarnessDelivery;
let ledger: Ledger;
let context: SchedulerContext;
let keys: Map<string, CheckKey>;

beforeEach(() => {
  store = freshStore();
  delivery = createDelivery(store, { status: fixedStatus() });
  liveDaemon(store, WT);
  keys = new Map([
    [FILE.path, key("a")],
    [OTHER_FILE.path, key("o")],
  ]);
  context = {
    store,
    sink: createStateSink(store),
    worktreeId: WT as WorktreeId,
    policy: DEFAULT_POLICY,
    now: Date.now,
    incarnation: INCARNATION,
    rerunCap: RERUN_CAP,
    note: () => {},
    keys: {
      runnerOf: () => undefined,
      index: { key: (ref: TestFileRef) => keys.get(ref.path) ?? null, keysReadAsOne: () => null },
      removeTestFile: () => {},
    },
  } as unknown as SchedulerContext;
  ledger = new Ledger(context);
});

function fileOf(ref: TestFileRef): FileState {
  const file = ledger.file(ref);
  if (!file) throw new Error(`no ${ref.path}`);
  return file;
}

/** A tier's results for `ref` at `k`: stored, applied, and a new failure's re-run queued, as `tiers.ts` does. */
function land(ref: TestFileRef, k: CheckKey, results: ResultRecord[], forced = false): void {
  const file = fileOf(ref);
  ledger.setRunning(file, null);
  store.results.putMany(results);
  ledger.applyResults(file, k, results, null);
  if (forced) endRerun(context, file);
  const failedAnew = results.some((r) => r.outcome === "fail") && !forced;
  if (failedAnew) queueReruns(context, ledger, [{ file, key: k, forced }]);
  ledger.commit();
}

/** A tier takes `ref`'s queued run at its key. */
function start(ref: TestFileRef): void {
  const file = fileOf(ref);
  ledger.queue.remove(ref);
  ledger.setRunning(file, file.key);
  ledger.commit();
}

/** The baseline: both files pass at their keys, and `C1` registers at revision 0. */
async function baseline(): Promise<void> {
  for (const ref of [FILE, OTHER_FILE]) ledger.addFile(ref);
  ledger.settle([FILE, OTHER_FILE], new Set());
  land(FILE, key("a"), [result(A, "pass", { key: key("a") })]);
  land(OTHER_FILE, key("o"), [result(B, "pass", { key: key("o") })]);
  await delivery.register(C1);
}

/** The consumer's watched edit of `src/a.ts` at the next revision moves `refs` to `to` (`FILE` to key B). */
function edit(refs: readonly TestFileRef[] = [FILE], to: CheckKey = key("b")): void {
  const latest = store.revisions.latest(WT)?.number ?? 0;
  const revision = store.revisions.append({
    worktreeId: WT,
    createdAt: latest + 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/a.ts", oldHash: null, newHash: `h${latest + 1}` }],
  }).number;
  ledger.revision = { number: revision, head: null, dirty: true };
  for (const ref of refs) keys.set(ref.path, to);
  ledger.settle(refs, new Set(), { keyedAt: revision });
  ledger.commit({ refined: revision });
}

async function text(stop = false): Promise<string | null> {
  const delta = await delivery.onToolBoundary(C1, { stop });
  return delta === null ? null : formatDelta(delta);
}

describe("the settled line over an edited file's confirmation run (review wave 13v, B1)", () => {
  it("waits while the confirmation is queued or running, then is said once on later news", async () => {
    await baseline();
    edit();
    expect(await text()).toContain("Squeal saw your edit and queued 1 test file");

    // The edit's first result fails anew: the attribution is discharged and a confirmation queued.
    land(FILE, key("b"), [result(A, "fail", { key: key("b") })]);
    expect(readRekeyed(store, WT).get(testFileId(FILE))?.open).toBeNull();
    expect(store.testFileKeys.list(WT).find((r) => r.testFile.path === FILE.path)?.pending).toBe(
      "queued",
    );
    const queued = await text();
    expect(queued).toContain("PASS -> FAIL");
    expect(queued).not.toMatch(SETTLED);

    start(FILE);
    land(OTHER_FILE, key("o"), [result(B, "fail", { key: key("o"), message: "b1" })], true);
    const running = await text();
    expect(running).toContain("src/b.test.ts");
    expect(running).not.toMatch(SETTLED);

    land(FILE, key("b"), [result(A, "fail", { key: key("b") })], true);
    expect(await text()).toBeNull();
    land(OTHER_FILE, key("o"), [result(B, "fail", { key: key("o"), message: "b2" })], true);
    expect(await text()).toMatch(SETTLED);
    land(OTHER_FILE, key("o"), [result(B, "fail", { key: key("o"), message: "b3" })], true);
    expect(await text()).not.toMatch(SETTLED);
  });

  it("waits for a forced run at the same key after the edit's result", async () => {
    await baseline();
    edit();
    await text();
    land(FILE, key("b"), [result(A, "pass", { key: key("b") })]);
    // `run --all` or `squeal run` forces the edited file again at its key.
    ledger.enqueue(fileOf(FILE), priorityOf(fileOf(FILE), NOTHING_CHANGED), true);
    ledger.commit();
    land(OTHER_FILE, key("o"), [result(B, "fail", { key: key("o"), message: "b1" })], true);
    expect(await text()).not.toMatch(SETTLED);

    start(FILE);
    land(FILE, key("b"), [result(A, "pass", { key: key("b") })], true);
    land(OTHER_FILE, key("o"), [result(B, "fail", { key: key("o"), message: "b2" })], true);
    expect(await text()).toMatch(SETTLED);
  });

  it("leaves status --wait's discharge as it was: the wait holds for no same-key confirmation", async () => {
    await baseline();
    const startedAt = movesSeq(store, WT as WorktreeId) ?? 0;
    edit();
    land(FILE, key("b"), [result(A, "fail", { key: key("b") })]);
    expect(fileOf(FILE).phase).toBe("queued");

    const answer = answerMoves(store, WT as WorktreeId, 1, startedAt, INCARNATION);
    const rekeyed = answer.state === "answered" ? answer.rekeyed : [];
    expect(rekeyed).toEqual([{ testFile: FILE, revision: 1, resolved: true }]);
    const window = editWindow(store, WT as WorktreeId, 0, 1, rekeyed);
    expect(window.ids).toEqual(new Set([testFileId(FILE)]));
    expect(heldPending(window, store.testFileKeys.list(WT))).toBe(0);
  });
});

/*
 * Task 001-396 (008 lessons, defect 4(b)): the edit's first result fails
 * anew, so its confirmation keeps the file's row pending and the settled line
 * held, while the header says nothing is pending. The message that delivers that
 * result does not also say "results arrive with later tool calls".
 */
describe("the 001-224 line beside the edit's own result (task 001-396)", () => {
  const SAW = "Squeal saw your edit";

  it("is left out with nothing pending, and spent: the next edit does not say it", async () => {
    await baseline();
    edit();
    land(FILE, key("b"), [result(A, "fail", { key: key("b") })]);
    const delta = await delivery.onToolBoundary(C1, { stop: false });
    expect(delta?.sawEdit).toBeUndefined();
    const first = delta === null ? "" : formatDelta(delta);
    expect(first).toContain("\nRevision 1: no check pending, stale or unknown.\n");
    expect(first).toContain("PASS -> FAIL");
    expect(first).not.toContain(SAW);

    edit([FILE], key("c"));
    expect(await text()).toBeNull();
  });

  it("is kept while the edit's other file is pending", async () => {
    await baseline();
    edit([FILE, OTHER_FILE]);
    land(FILE, key("b"), [result(A, "fail", { key: key("b") })]);
    const kept = await text();
    expect(kept).toContain("PASS -> FAIL");
    expect(kept).toMatch(/[1-9]\d* pending/);
    expect(kept).toContain(`${SAW} and queued 2 test files; results arrive with later tool calls`);
  });
});
