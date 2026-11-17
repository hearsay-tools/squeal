import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { formatDelta } from "../../src/core/delivery/format.js";
import { lateMetaKey } from "../../src/core/delivery/late.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import { recordRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { Consumer, Delta, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { StateSink } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import type { TestFileKeyRecord } from "../../src/core/types/store-records.js";
import { check, FILE, freshStore, result, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Row 005-97: the late tests' worktree. `FILE` (`src/a.test.ts`, check `A`) last took 1 s, so with
 * no stored run its results are late after 2 × 1 s; `OTHER_FILE` (check `B`) is another file the
 * consumer's edits do not affect. The bindings are live: `setUp` replaces them.
 */

export const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
export const OTHER_FILE: TestFileRef = { project: "", path: "src/b.test.ts" };
export const A = check("a");
export const B = check("b", OTHER_FILE);
export const NONE = { checkpointId: null };
export const LATE = /^SQUEAL · results for your edits are late at revision (\d+)$/m;
export const CAUGHT = /^SQUEAL · caught up at revision (\d+)$/m;

export let store: Store;
export let sink: StateSink;
export let delivery: HarnessDelivery;
export let revision: number;
export let clock: number;

/** A fresh worktree with a live daemon, both files passing at revision 0; `root` its folder. */
export function setUp(root?: string): void {
  store = freshStore();
  sink = createStateSink(store);
  clock = Date.now();
  delivery = createDelivery(store, { status: fixedStatus(), now: () => clock });
  revision = 0;
  liveDaemon(store, WT);
  const row = store.worktrees.get(WT);
  if (root !== undefined && row !== null) store.worktrees.upsert({ ...row, root });
  key(FILE, "k1");
  key(OTHER_FILE, "b1");
  sink.applyResults(WT, 0, [result(A, "pass"), result(B, "pass", { key: "b1" })], NONE);
  store.results.putMany([{ ...result(A, "pass"), durationMs: 1_000 }]);
}

/** A worktree whose policy runs no test group at `edit` (row 019-49). */
export function quietPolicy(): void {
  const root = mkdtempSync(join(tmpdir(), "squeal-late-quiet-"));
  writeFileSync(
    join(root, "squeal.config.json"),
    JSON.stringify({
      checks: [{ name: "unit", runner: "vitest", tests: ["src/**"], at: "stop" }],
    }),
  );
  setUp(root);
}

/** Moves the clock `ms` on. */
export const tick = (ms: number) => {
  clock += ms;
};

/** `file`'s row as the scheduler writes it at the current revision. */
export function key(file: TestFileRef, k: string, pending: TestFileKeyRecord["pending"] = null) {
  store.testFileKeys.upsertMany([{ worktreeId: WT, testFile: file, key: k, revision, pending }]);
}

/** A watched revision at the clock's time; its runner part applied unless `refined` is false. */
export function edit(paths: readonly string[], refined = true): void {
  revision = store.revisions.append({
    worktreeId: WT,
    createdAt: clock,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: paths.map((path) => ({ path, oldHash: null, newHash: `h-${path}-${revision}` })),
  }).number;
  if (refined) recordRefinedApplied(store, WT, revision);
}

/** The consumer's edit of `src/a.ts` re-keys `FILE` and queues it. */
export function editA(): void {
  edit(["src/a.ts"]);
  key(FILE, `k${revision + 1}`, "queued");
  recordRekeyed(store, WT, [{ id: testFileId(FILE), open: revision, moved: revision }], []);
}

/** `FILE`'s result at its current key lands: `outcome`, a pass by default. */
export function finishA(outcome: "pass" | "fail" = "pass"): void {
  key(FILE, `k${revision + 1}`);
  sink.applyResults(WT, revision, [result(A, outcome, { key: `k${revision + 1}` })], NONE);
  recordRekeyed(store, WT, [{ id: testFileId(FILE), open: null, moved: null }], []);
}

/** B fails anew at its unchanged key: a new failure, news that delivers on any path. */
export const failB = () =>
  sink.applyResults(WT, revision, [result(B, "fail", { key: "b1" })], NONE);
export const passB = () =>
  sink.applyResults(WT, revision, [result(B, "pass", { key: "b1" })], NONE);

export const text = (delta: Delta | null) => (delta === null ? null : formatDelta(delta));
export const boundary = async (stop = false) => text(await delivery.onToolBoundary(C1, { stop }));

/** Whether a late message is open: its slot names a revision (a failure leaves `{ ended }`). */
export const lateOpen = () =>
  Object.values(JSON.parse(store.meta.get(lateMetaKey(WT)) ?? "{}")).some(
    (v) => typeof v === "number",
  );

/** Registered, edited A, the first-edit line spent, and the late notice said. */
export async function late(): Promise<void> {
  await delivery.register(C1);
  editA();
  expect(await boundary()).toContain("Squeal saw your edit");
  tick(61_000);
  expect(await boundary()).toMatch(LATE);
  expect(lateOpen()).toBe(true);
}
