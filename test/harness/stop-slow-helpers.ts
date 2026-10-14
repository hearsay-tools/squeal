import { squealVersion } from "../../src/core/daemon/version.js";
import { readTurn } from "../../src/core/delivery/turn.js";
import { recordStopWait, type StopWaitHarness } from "../../src/core/slow/index.js";
import {
  type Consumer,
  DEFAULT_POLICY,
  type PolicyFile,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { check, result } from "../state/helpers.js";
import { codexRecorded } from "./codex/helpers.js";
import { FILE, recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * The fixture of the waiting Stop entry's tests (spec 004 D9 as amended
 * 2026-10-12): both harnesses' Stop entries, a fast file passing and one
 * slow file whose runs land as the daemon's slow tier stores them.
 */

export const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive", pollIntervalMs: 20 };
export const SLOW_FILE: TestFileRef = { project: "", path: "test/e2e/slow.test.ts" };
export const POSTS = check("ledger > posts", SLOW_FILE);

export interface Out {
  readonly stdout: string;
}

export interface Harness {
  /** A harness with a waiting Stop entry: Pi has none. */
  readonly name: Exclude<StopWaitHarness, "pi">;
  startTurn(r: SquealRepo, overrides?: object, hookDeps?: HookDeps): Promise<void>;
  stop(r: SquealRepo, overrides?: object, hookDeps?: HookDeps): Promise<Out>;
  stopSlow(r: SquealRepo, overrides?: object, hookDeps?: HookDeps): Promise<Out>;
}

export const HARNESSES: readonly Harness[] = [
  {
    name: "claude-code",
    async startTurn(r, o, d = deps) {
      await runHook("session-start", recorded("session-start", r.root, o), d);
      await runHook("user-prompt-submit", recorded("user-prompt-submit", r.root, o), d);
    },
    stop: (r, o, d = deps) => runHook("stop", recorded("stop", r.root, o), d),
    stopSlow: (r, o, d = deps) => runHook("stop-slow", recorded("stop", r.root, o), d),
  },
  {
    name: "codex",
    async startTurn(r, o, d = deps) {
      await runCodexHook("session-start", codexRecorded("exec", "session-start", r.root, o), d);
      await runCodexHook(
        "user-prompt-submit",
        codexRecorded("exec", "user-prompt-submit", r.root, o),
        d,
      );
    },
    stop: (r, o, d = deps) => runCodexHook("stop", codexRecorded("exec", "stop", r.root, o), d),
    stopSlow: (r, o, d = deps) =>
      runCodexHook("stop-slow", codexRecorded("exec", "stop", r.root, o), d),
  },
];

/**
 * `math > adds` passes, the slow file is queued at revision 1, the agent is
 * in a turn; `marked`: the harness's waiting entry ran for this session before.
 */
export async function repo(
  harness: Harness,
  stop: NonNullable<PolicyFile["stop"]>,
  marked = true,
): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  r.policy({ slow: { ...DEFAULT_POLICY.slow, include: [SLOW_FILE.path, FILE.path] }, stop });
  slowKey(r, "queued");
  await harness.startTurn(r);
  if (marked) markStopWait(r, harness.name);
  return r;
}

/** The registered main agent of the session's turn: the only consumer, as `startTurn` leaves it. */
export function mainConsumer(r: SquealRepo): Consumer {
  const [record, ...more] = r.store.consumers.list(r.worktreeId);
  if (record === undefined || more.length > 0) throw new Error("not one consumer");
  return record.consumer;
}

/** The waiting entry of `harness` ran for the session's main agent (001-285, 001-297). */
export function markStopWait(r: SquealRepo, harness: StopWaitHarness): void {
  recordStopWait(r.store, mainConsumer(r), harness, squealVersion());
}

export function slowKey(r: SquealRepo, pending: "queued" | null, key = "slow1"): void {
  const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
  r.store.testFileKeys.upsertMany([
    { worktreeId: r.worktreeId, testFile: SLOW_FILE, key, revision, pending },
  ]);
}

/** The slow file's run lands at the current revision, as the daemon's slow tier stores it. */
export function landSlow(
  r: SquealRepo,
  outcome: "pass" | "fail",
  key = "slow1",
  message?: string,
): void {
  const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
  const ran = result(POSTS, outcome, {
    key,
    worktreeId: r.worktreeId,
    revision,
    ...(message === undefined ? {} : { message }),
  });
  r.store.transaction(() => r.store.results.putMany([ran]));
  slowKey(r, null, key);
  r.sink.applyResults(r.worktreeId, revision, [ran], { checkpointId: null });
}

/** A new revision moves the slow file to `slow2` and queues it, as the scheduler does. */
export function queueSlowAgain(r: SquealRepo): void {
  r.apply();
  slowKey(r, "queued", "slow2");
  r.sink.refresh(r.worktreeId, r.store.revisions.latest(r.worktreeId)?.number ?? 0, {
    checkpointId: null,
  });
}

/**
 * The entry's clock, running `at[n]` at its `n`th call: 1 is the handoff's
 * start, 2 the first poll, 3 the second, and so on while each poll still
 * sees the slow tier unsettled. A poll reads it inside its read transaction,
 * after the states and keys, so a write there lands from the fixture's own
 * SQLite connection while that poll keeps its older snapshot.
 */
export function clock(at: Readonly<Record<number, () => void>>): HookDeps {
  let calls = 0;
  return {
    ...deps,
    now: () => {
      calls++;
      at[calls]?.();
      return Date.now();
    },
  };
}

/** The 2 s entry alone, then `between`, then the waiting entry with `hookDeps`. */
export async function stopThenWait(
  harness: Harness,
  r: SquealRepo,
  between: () => void = () => {},
  hookDeps: HookDeps = deps,
) {
  const quick = decision(await harness.stop(r));
  between();
  const waiting = decision(await harness.stopSlow(r, {}, hookDeps));
  return { quick, waiting };
}

export function decision(out: Out): { decision?: string; reason?: string } {
  return out.stdout.trim() === "" ? {} : (JSON.parse(out.stdout) as { decision?: string });
}

/** Both entries at once, as the harness runs them; `during` acts while they run. */
export async function stopBoth(
  harness: Harness,
  r: SquealRepo,
  during: () => void = () => {},
  afterMs = 300,
) {
  const timer = setTimeout(during, afterMs);
  try {
    const started = performance.now();
    const [quick, waiting] = await Promise.all([harness.stop(r), harness.stopSlow(r)]);
    return { quick: decision(quick), waiting: decision(waiting), ms: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** The main agent's turn state; each harness names its session. */
export function turnOf(r: SquealRepo) {
  const [record] = r.store.consumers.list(r.worktreeId);
  if (record === undefined) throw new Error("no consumer");
  return readTurn(r.store, record.consumer).turn;
}
