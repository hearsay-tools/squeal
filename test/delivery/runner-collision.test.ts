import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import type {
  CheckId,
  Consumer,
  Delta,
  FileCheckId,
  HarnessDelivery,
  SetupCheckId,
  StateSink,
  Store,
} from "../../src/core/types/index.js";
import { freshStore, OTHER, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Review 0.1.303 B1 (spec 016 D3): checks are shared by every worktree, and a
 * file-level check has no test name, so a pytest doctest of `docs/example.js`
 * in this worktree and a Vitest test file of the same path in another are one
 * check. The runner is recorded with each result, and this worktree's failure
 * reads the runner of the result it shows, at the key the state sink recorded
 * for it; another worktree's result at another key never changes it. A setup
 * failure has no result: its runner is this worktree's record alone.
 */

const SENTENCE = "No dependencies are installed in this worktree";
const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const FILE: FileCheckId = { kind: "file", project: "py", testPath: "docs/example.js" };
const NONE = { checkpointId: null };

let root: string;
let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-collision-"));
  store = freshStore();
  store.worktrees.upsert({
    id: WT,
    root,
    commonDir: "/repo/.git",
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  sink = createStateSink(store);
  delivery = createDelivery(store, { status: fixedStatus() });
  setKey(store, "k1", { file: { project: FILE.project, path: FILE.testPath } });
  liveDaemon(store, WT);
  // Hashed, and no installed Node lockfile among them: Node is not installed.
  store.fileHashes.upsertMany(
    WT,
    [FILE.testPath, "uv.lock"].map((path) => ({
      path,
      mtimeMs: 1,
      ctimeMs: 1,
      size: 1,
      inode: 1,
      hash: "h",
    })),
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function revision(): number {
  return store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [],
  }).number;
}

/** This worktree's run of `check` with `runner`, stored and applied at key `k1`. */
function ownRun(check: CheckId, outcome: "pass" | "fail", runner: string): void {
  const record = result(check, outcome);
  store.results.putMany([record], runner);
  sink.applyResults(WT, revision(), [record], NONE);
}

/** The other worktree's run of `check` with `runner`, at a key of its own. */
function otherRun(check: CheckId, outcome: "pass" | "fail", runner: string): void {
  store.results.putMany([result(check, outcome, { key: "k-other", worktreeId: OTHER })], runner);
}

const CALLERS = [
  [
    "the tool boundary",
    async () => formatDelta((await delivery.onToolBoundary(C1)) as Delta),
  ] as const,
  [
    "a registration",
    async () =>
      formatRegistration(await delivery.register({ ...C1, sessionId: "s2" }, { atStart: true })),
  ] as const,
];

describe.each(CALLERS)("a file-level failure shared with another worktree, at %s", (_, read) => {
  it("stays pytest's when the other worktree's run of the same check is Vitest's", async () => {
    ownRun(FILE, "pass", "pytest");
    await delivery.register(C1, { atStart: true });
    ownRun(FILE, "fail", "pytest");
    otherRun(FILE, "pass", "vitest");
    const text = await read();
    expect(text).toContain("docs/example.js");
    expect(text).not.toContain(SENTENCE);
  });

  it("stays Vitest's when the other worktree's run of the same check is pytest's", async () => {
    ownRun(FILE, "pass", "vitest");
    await delivery.register(C1, { atStart: true });
    ownRun(FILE, "fail", "vitest");
    otherRun(FILE, "pass", "pytest");
    const text = await read();
    expect(text).toContain("docs/example.js");
    expect(text).toContain(SENTENCE);
  });
});

describe.each(CALLERS)("a Vitest setup failure, at %s", (_, read) => {
  const setup: SetupCheckId = { kind: "setup", project: "", testPath: "test/global-setup.ts" };
  const error = { name: "Error", message: "no pg", stack: null, location: null, diff: null };

  it.each([
    ["is told it from this worktree's record", WT, true],
    ["reads no other worktree's record", OTHER, false],
  ] as const)("%s", async (_, recordedBy, told) => {
    await delivery.register(C1, { atStart: true });
    store.checks.recordSetupRunner(recordedBy, setup, "vitest");
    sink.setupOutcome(WT, revision(), { check: setup, commit: null, error });
    const text = await read();
    expect(text).toContain("test/global-setup.ts");
    expect(text.includes(SENTENCE)).toBe(told);
  });
});
