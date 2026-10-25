import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import type {
  CheckKey,
  NodeTestProject,
  RunnerAdapter,
  RunOptions,
  Store,
  TestFileRef,
} from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, ref, SLOW } from "./helpers.js";

/*
 * Row 011-71 (`research/stuck-tier.md` section 4, done-when 1 to 3): a tier
 * runs a test file at key C. While it runs, an edit moves the file to key B,
 * which has a stored result: the lookup applies it and takes no claim. The
 * older tier's outcome is superseded (review wave-4 B1), but its own claim at
 * C must end with it: on 0.1.238 it stayed, and an edit back to C read the
 * file as running with no tier, never queued again, its checkpoint owed.
 * Done-when 4 is `edit-beside-backlog.test.ts` tests 2 to 4, unchanged.
 */

/** A test file and the source it imports, whose contents A, B and C give it three keys. */
interface Subject {
  readonly file: TestFileRef;
  readonly source: string;
  readonly A: string;
  readonly B: string;
  readonly C: string;
}

const VITEST: Subject = {
  file: ref("test/math.test.ts"),
  source: "src/math.ts",
  A: "export const add = (a: number, b: number) => a + b;\n",
  B: "export const add = (a: number, b: number) => b + a;\n",
  C: "export const add = (a: number, b: number) => a + b + 0;\n",
};

/**
 * node:test cannot cancel a run: built as the daemon builds it, its lane runs
 * the backlog in slots, and an edit's tier of it gets no cancel.
 */
const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};
const NODE_TEST: Subject = {
  file: { project: "nt", path: "nt/test/math.test.mjs" },
  source: "nt/src/math.mjs",
  A: "export const add = (a, b) => a + b;\n",
  B: "export const add = (a, b) => b + a;\n",
  C: "export const add = (a, b) => a + b + 0;\n",
};

/** The daemon's node:test runners of `nt`, written first: the adapter lists its files when created. */
function nodeTestRunners(root: string): RunnerAdapter[] {
  mkdirSync(join(root, "nt/src"), { recursive: true });
  mkdirSync(join(root, "nt/test"), { recursive: true });
  writeFileSync(join(root, NODE_TEST.source), NODE_TEST.A);
  writeFileSync(
    join(root, NODE_TEST.file.path),
    [
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      'import { add } from "../src/math.mjs";',
      'test("adds", () => assert.equal(add(1, 2), 3));',
      "",
    ].join("\n"),
  );
  const tempDir = join(root, "..");
  return createNodeTestRunners([NT], { root, tempDir, tierSize: () => 4, note: () => {} });
}

/** The key the subject's file has now, by its row (`Harness.keyOf` reads Vitest's project only). */
function keyOf(h: Harness, subject: Subject): CheckKey | null {
  return h.store.testFileKeys.list(h.worktreeId, [subject.file])[0]?.key ?? null;
}

/** Writes `content` to the subject's source and hands the scheduler the batch. */
async function edit(h: Harness, subject: Subject, content: string): Promise<void> {
  h.write(subject.source, content);
  await h.batch(subject.source);
}

/** A scheduler at A whose subject has a stored result at key B, which it returns. */
async function atA(
  subject: Subject,
  options: { allowErrors?: boolean } = {},
): Promise<{ h: Harness; store: Store; keyB: CheckKey | null }> {
  const { main, commonDir } = createRepo();
  const store = openRepoStore(commonDir);
  const adapters = subject === NODE_TEST ? nodeTestRunners(main) : [];
  const h = await openHarness(main, store, commonDir, {
    tierSize: 4,
    backlogTierSize: 8,
    adapters,
    ...options,
  });
  await h.scheduler.start();
  await h.scheduler.idle();
  await edit(h, subject, subject.B);
  await h.scheduler.idle();
  const keyB = keyOf(h, subject);
  await edit(h, subject, subject.A);
  await h.scheduler.idle();
  return { h, store, keyB };
}

/**
 * Edits to C, whose tier is held at its start, then to B while it is held,
 * and releases it; returns key C, the held run's options and every run's
 * files from then.
 */
async function supersedeHeldTier(
  h: Harness,
  subject: Subject,
  keyB: CheckKey | null,
  beforeRelease: () => void = () => {},
): Promise<{ keyC: CheckKey | null; held: RunOptions; runs: (readonly TestFileRef[])[] }> {
  let release: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  // A failed assertion still lets the scheduler close.
  onTestFinished(() => release());
  const runs: (readonly TestFileRef[])[] = [];
  let held: RunOptions | null = null;
  h.gate.before = async (files, options) => {
    runs.push(files);
    if (held !== null || !files.some((f) => f.path === subject.file.path)) return;
    held = options;
    await hold;
  };
  await edit(h, subject, subject.C);
  await expect.poll(() => held !== null, { timeout: 30_000 }).toBe(true);
  const keyC = keyOf(h, subject);
  expect(keyC).not.toBe(keyB);

  await edit(h, subject, subject.B);
  expect(keyOf(h, subject)).toBe(keyB);
  beforeRelease();
  release();
  await h.scheduler.idle();
  return { keyC, held: held as unknown as RunOptions, runs };
}

/**
 * After the held tier at `keyC` ended: an edit back to C runs the subject
 * again, its row is not `running`, and a `run --all` requested afterwards
 * completes.
 */
async function expectRunsAgainAtC(
  h: Harness,
  subject: Subject,
  runs: (readonly TestFileRef[])[],
  keyC: CheckKey | null,
): Promise<void> {
  const before = runs.length;
  await edit(h, subject, subject.C);
  await h.scheduler.idle();

  const [row] = h.store.testFileKeys.list(h.worktreeId, [subject.file]);
  expect(row?.key).toBe(keyC);
  expect(row?.pending).not.toBe("running");
  expect(runs.slice(before).some((files) => files.some((f) => f.path === subject.file.path))).toBe(
    true,
  );
  const known = h.store.knownStates
    .list(h.worktreeId)
    .find(({ check }) => check.kind === "test" && check.testPath === subject.file.path);
  expect(known?.outcome).toBe("pass");

  const checkpoint = await h.scheduler.requestFullSuite();
  await h.scheduler.idle();
  expect(h.store.checkpoints.get(checkpoint.id)?.completedAt ?? null).not.toBeNull();
  expect(h.scheduler.owedWork()).toBeNull();
}

describe("a superseded tier's own claim ends with it (row 011-71)", () => {
  it(
    "1. a cancelled tier at C, a store hit at B: the edit back to C runs the file",
    SLOW,
    async () => {
      const { h, keyB } = await atA(VITEST);
      const { keyC, held, runs } = await supersedeHeldTier(h, VITEST, keyB);
      // The held tier was cancelled for the edit at B.
      expect(held.signal?.aborted).toBe(true);
      // Key C is the cancelled tier's own key again.
      await expectRunsAgainAtC(h, VITEST, runs, keyC);
    },
  );

  it(
    "2. the same when recording the tier fails once: the re-queue ends the claim",
    SLOW,
    async () => {
      const { h, store, keyB } = await atA(VITEST, { allowErrors: true });
      const writes = failWrites(store);
      try {
        const { keyC, runs } = await supersedeHeldTier(h, VITEST, keyB, () =>
          writes.fail(busyError(), "recordTier"),
        );
        // The record threw: `#requeue` ended the tier, not `recordTier`.
        expect(h.errors.map((error) => error.message)).toEqual(["database is locked"]);
        await expectRunsAgainAtC(h, VITEST, runs, keyC);
      } finally {
        writes.restore();
      }
    },
  );

  it("3. the same when the tier is not cancelled and runs to its end", SLOW, async () => {
    const { h, keyB } = await atA(NODE_TEST);
    const { keyC, held, runs } = await supersedeHeldTier(h, NODE_TEST, keyB);
    expect(held.signal?.aborted ?? false).toBe(false);
    await expectRunsAgainAtC(h, NODE_TEST, runs, keyC);
  });
});

/** A busy store's error, as `node:sqlite` throws it (`busy-record.test.ts`). */
function busyError(): Error {
  return Object.assign(new Error("database is locked"), { errcode: 5 });
}

/** Makes the store's next write transaction whose stack names `within` throw `error`. */
function failWrites(store: Store): { fail(error: Error, within: string): void; restore(): void } {
  const realTransaction = store.transaction.bind(store);
  let next: { error: Error; within: string } | null = null;
  store.transaction = ((fn: () => unknown) => {
    if (next !== null && new Error().stack?.includes(next.within)) {
      const { error } = next;
      next = null;
      throw error;
    }
    return realTransaction(fn);
  }) as typeof store.transaction;
  return {
    fail(error, within) {
      next = { error, within };
    },
    restore() {
      store.transaction = realTransaction;
    },
  };
}
