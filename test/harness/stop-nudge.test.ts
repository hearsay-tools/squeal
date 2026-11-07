import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDaemonServer } from "../../src/core/daemon/server.js";
import type { StopWaitHarness } from "../../src/core/slow/stop-wait.js";
import type { CheckMoment } from "../../src/core/types/check-groups.js";
import { type AbsolutePath, PAYLOAD_SCHEMA_VERSION } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { runCodexHook } from "../../src/harness/codex/hooks.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { codexRecorded } from "./codex/helpers.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";
import { markStopWait } from "./stop-slow-helpers.js";

/*
 * Task 001-281: a silent Stop ends the turn, and with slow files pending it
 * nudges the daemon over the socket, so the slow tier starts now instead of
 * at its 15 s recheck. A Stop that speaks keeps the turn going and nudges
 * nothing; with no slow file pending there is nothing to nudge for. Both
 * harnesses run the shared Stop path. Row 019-23: a configured group's
 * files pending are nudged for as slow files are (spec 019 D3, D4).
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const SLOW_FILE: TestFileRef = { project: "", path: "src/slow.test.ts" };

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Harness {
  readonly name: Exclude<StopWaitHarness, "pi">;
  startTurn(r: SquealRepo): Promise<void>;
  stop(r: SquealRepo): Promise<{ readonly stdout: string }>;
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

/** A daemon socket that counts the nudges it is sent, recorded as the worktree's daemon. */
async function listening(r: SquealRepo): Promise<{ readonly nudges: () => number }> {
  const dir = mkdtempSync("/tmp/sq-nudge-");
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "d.sock") as AbsolutePath;
  let nudges = 0;
  const server = await createDaemonServer(socketPath, (request) => {
    if (request.type === "nudge") nudges++;
    return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "nudge" };
  });
  cleanups.push(() => server.close());
  const record = r.store.worktrees.get(r.worktreeId)?.daemon;
  if (!record) throw new Error("no daemon record");
  r.store.worktrees.setDaemon(r.worktreeId, { ...record, socketPath });
  return { nudges: () => nudges };
}

/** `math > adds` passes, the main agent is in a turn, and the slow file is declared. */
async function inTurn(harness: Harness, stop: object = {}): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  r.policy({ slow: { ...DEFAULT_POLICY.slow, include: [SLOW_FILE.path] }, stop });
  await harness.startTurn(r);
  return r;
}

function queueSlow(r: SquealRepo): void {
  const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
  r.store.testFileKeys.upsertMany([
    { worktreeId: r.worktreeId, testFile: SLOW_FILE, key: "slow1", revision, pending: "queued" },
  ]);
}

describe.each(HARNESSES)("Stop nudges the daemon for slow files, $name (001-281)", (harness) => {
  it("nudges once when a silent Stop leaves a slow file pending", async () => {
    const r = await inTurn(harness);
    const daemon = await listening(r);
    queueSlow(r);

    expect((await harness.stop(r)).stdout).toBe("");
    expect(daemon.nudges()).toBe(1);
  });

  it("nudges nothing when no slow file is pending", async () => {
    const r = await inTurn(harness);
    const daemon = await listening(r);

    expect((await harness.stop(r)).stdout).toBe("");
    expect(daemon.nudges()).toBe(0);
  });

  it("nudges nothing when Stop blocks and the turn goes on", async () => {
    const r = await inTurn(harness, { blockOnKnownFailures: true });
    const daemon = await listening(r);
    r.apply(r.fail());
    queueSlow(r);

    expect((await harness.stop(r)).stdout).toContain('"decision":"block"');
    expect(daemon.nudges()).toBe(0);
  });
});

describe.each(HARNESSES)(
  "Stop nudges the daemon for a configured group's files, $name (019-23)",
  (harness) => {
    /** The main agent in a turn under one group of the slow file at `at`, with no slow key. */
    async function grouped(at: CheckMoment): Promise<SquealRepo> {
      const r = squealRepo();
      r.apply(r.pass());
      r.policy({ checks: [{ name: "heavy", runner: "vitest", tests: [SLOW_FILE.path], at }] });
      await harness.startTurn(r);
      // At `stop` the waiting entry decides: the 2 s entry ends the turn silently (001-297).
      markStopWait(r, harness.name);
      return r;
    }

    for (const at of ["pause", "stop"] as const) {
      it(`nudges once when a silent Stop leaves a file of a group at ${at} pending`, async () => {
        const r = await grouped(at);
        const daemon = await listening(r);
        queueSlow(r);

        expect((await harness.stop(r)).stdout).toBe("");
        expect(daemon.nudges()).toBe(1);
      });
    }

    it("nudges nothing when no file of the group is pending", async () => {
      const r = await grouped("stop");
      const daemon = await listening(r);

      expect((await harness.stop(r)).stdout).toBe("");
      expect(daemon.nudges()).toBe(0);
    });
  },
);

it("a silent Stop with a slow file pending and no daemon listening still returns at once", async () => {
  const [harness] = HARNESSES;
  if (harness === undefined) throw new Error("no harness");
  const r = await inTurn(harness);
  queueSlow(r);

  const started = performance.now();
  expect((await harness.stop(r)).stdout).toBe("");
  expect(performance.now() - started).toBeLessThan(500);
});
