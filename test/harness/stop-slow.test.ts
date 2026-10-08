import { describe, expect, it } from "vitest";
import { readTurn } from "../../src/core/delivery/turn.js";
import { testFileId } from "../../src/core/keys/index.js";
import { slowFiles } from "../../src/core/slow/index.js";
import { isFastPending, readHeader } from "../../src/core/state/index.js";
import { DEFAULT_POLICY, type Policy, type TestFileRef } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { codexRecorded } from "./codex/helpers.js";
import { FILE, recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Spec 004 D9, review wave-1 B2: Stop never waits for slow files. With a
 * positive `stop.waitMs`, a Stop whose only pending work is a slow file
 * returns at once and records the file pending in the idle snapshot; with a
 * fast file pending too, it waits for the fast one only. Both harnesses run
 * the shared Stop path.
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const SLOW_FILE: TestFileRef = { project: "", path: "src/slow.test.ts" };
const WAIT_MS = 1_000;

interface Harness {
  readonly name: string;
  /** Registers the main agent and submits a prompt: in a turn. */
  startTurn(r: SquealRepo): Promise<void>;
  stop(r: SquealRepo): Promise<unknown>;
}

const HARNESSES: readonly Harness[] = [
  {
    name: "claude-code",
    async startTurn(r) {
      await runHook("session-start", recorded("session-start", r.root), deps);
      await runHook("user-prompt-submit", recorded("user-prompt-submit", r.root), deps);
    },
    stop: (r) => runHook("stop", recorded("stop", r.root), deps),
  },
  {
    name: "codex",
    async startTurn(r) {
      await runCodexHook("session-start", codexRecorded("exec", "session-start", r.root), deps);
      await runCodexHook(
        "user-prompt-submit",
        codexRecorded("exec", "user-prompt-submit", r.root),
        deps,
      );
    },
    stop: (r) => runCodexHook("stop", codexRecorded("exec", "stop", r.root), deps),
  },
];

/** `math > adds` passes, a consumer is in a turn, and the slow file without checks is queued. */
async function slowQueued(harness: Harness): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  r.policy({
    slow: { ...DEFAULT_POLICY.slow, include: [SLOW_FILE.path] },
    stop: { waitMs: WAIT_MS },
  });
  await harness.startTurn(r);
  return r;
}

function queueSlow(r: SquealRepo): void {
  const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
  r.store.testFileKeys.upsertMany([
    { worktreeId: r.worktreeId, testFile: SLOW_FILE, key: "slow1", revision, pending: "queued" },
  ]);
}

/** The main consumer is idle, waiting for exactly `files`. */
function expectIdleWaitingFor(r: SquealRepo, files: readonly TestFileRef[]): void {
  const consumers = r.store.consumers.list(r.worktreeId);
  expect(consumers).toHaveLength(1);
  const [record] = consumers;
  const turn = record === undefined ? null : readTurn(r.store, record.consumer);
  expect(turn).toMatchObject({
    turn: "idle",
    testFiles: files.map(testFileId).sort(),
  });
}

describe.each(HARNESSES)("Stop with slow files pending, $name (spec 004 D9)", (harness) => {
  it("returns at once when only a slow file is pending, and records it pending", async () => {
    const r = await slowQueued(harness);
    queueSlow(r);

    const started = performance.now();
    await harness.stop(r);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(WAIT_MS / 2);
    expectIdleWaitingFor(r, [SLOW_FILE]);
  });

  it("waits for a pending fast file, then returns with the slow file pending", async () => {
    const r = await slowQueued(harness);
    r.queue("k2");
    queueSlow(r);
    const policy: Policy = {
      ...DEFAULT_POLICY,
      slow: { ...DEFAULT_POLICY.slow, include: [SLOW_FILE.path] },
    };
    const isSlow = slowFiles(policy, policy.nodeTest);
    const header = readHeader(r.store, r.worktreeId, undefined, undefined, isSlow);
    expect(header.slowPending).toEqual({ testFiles: 1, checks: 0, testFilesWithoutChecks: 1 });
    expect(isFastPending(header)).toBe(true);
    // The fast file's run lands while Stop waits.
    const ran = setTimeout(() => r.apply(r.pass()), 300);
    try {
      const started = performance.now();
      await harness.stop(r);
      const elapsed = performance.now() - started;

      expect(elapsed).toBeGreaterThanOrEqual(290);
      expect(elapsed).toBeLessThan(WAIT_MS - 100);
      expectIdleWaitingFor(r, [SLOW_FILE]);
    } finally {
      clearTimeout(ran);
    }
  });
});

it("a Stop with only a fast file pending still waits for it (control)", async () => {
  const [harness] = HARNESSES;
  if (harness === undefined) throw new Error("no harness");
  const r = await slowQueued(harness);
  r.queue("k2");

  const started = performance.now();
  await harness.stop(r);
  const elapsed = performance.now() - started;

  expect(elapsed).toBeGreaterThanOrEqual(WAIT_MS - 10);
  expectIdleWaitingFor(r, [FILE]);
});
