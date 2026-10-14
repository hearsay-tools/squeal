import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import type { Consumer } from "../../src/core/types/index.js";
import { type WaiterLockState, waiterLockState } from "../../src/core/waiter-lock/index.js";
import { type SquealRepo, squealRepo } from "../harness/helpers.js";
import { buildPiBundles } from "../harness/pi/helpers.js";
import {
  atGate,
  gateCall,
  lastMessage,
  piWorld,
  runWithExtension,
  squealMessages,
} from "../harness/pi/real-pi.js";
import { type PiRun, type PiRunOptions, piUnavailable, textOf } from "../helpers/pi.js";

/*
 * Spec 009 goal 7 and D5 against the real Pi 1.0.4 and the shipped bundle:
 * in `rpc`, a result landing after the run settled starts one run carrying
 * it; under `-p` and `json` no wake is armed and Pi exits; a prompt first
 * cancels the wake, and the news comes with that prompt's run.
 */

const unavailable = piUnavailable();
if (unavailable && process.env.CI) throw new Error(`Pi unavailable on CI: ${unavailable}`);

let extension = "";
let cleanup = () => {};
beforeAll(async () => {
  const built = await buildPiBundles();
  extension = join(built.dir, "extension.mjs");
  cleanup = built.cleanup;
}, 60_000);
afterAll(() => cleanup());

const runs: PiRun[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
});

const FAIL = "PASS -> FAIL";
const PROMPT_EXIT_MS = 8_000;
const WRITE = { name: "write", arguments: { path: "out.txt", content: "x\n" } };

const mentions = (text: string, request: PiRun["requests"][number] | undefined) =>
  squealMessages(request).filter((message) => textOf(message).includes(text)).length;

/** The session Pi registered: the worktree's one consumer. */
function piConsumer(r: SquealRepo): Consumer | null {
  const [record, ...more] = r.store.consumers.list(r.worktreeId);
  return record === undefined || more.length > 0 ? null : record.consumer;
}

function lockState(r: SquealRepo, consumer = piConsumer(r)): WaiterLockState | null {
  return consumer === null
    ? null
    : waiterLockState(storePaths(r.repo.commonDir).locksDir, consumer);
}

/** Until the wake holds its consumer's waiter lock. */
async function armed(r: SquealRepo): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (lockState(r) !== "held") {
    if (performance.now() > deadline) throw new Error("the idle wake was never armed");
    await sleep(20);
  }
}

function passing(): SquealRepo {
  const r = squealRepo();
  r.apply(r.pass());
  return r;
}

/** Runs Pi in `r` with the extension; each gate's callback lands when the run reaches it. */
async function inRepo(
  r: SquealRepo,
  options: Pick<PiRunOptions, "mode" | "prompts" | "plan">,
  gates: readonly (() => void)[],
): Promise<[PiRun, number]> {
  const world = await piWorld(r);
  const started = performance.now();
  const run = await runWithExtension(
    extension,
    { ...options, cwd: r.root, env: world.env },
    async (done) => {
      for (const [n, then] of gates.entries()) await atGate(world, n, done, then);
    },
  );
  runs.push(run);
  return [run, performance.now() - started];
}

const runsStarted = (run: PiRun) => run.events.filter((e) => e.type === "agent_start").length;

describe.skipIf(unavailable !== undefined)("the idle wake with real Pi", () => {
  it("rpc: a failing result landing after the run settled starts exactly one run carrying it", {
    timeout: 60_000,
  }, async () => {
    const r = passing();
    const [run] = await inRepo(
      r,
      {
        mode: "rpc",
        prompts: [
          "work",
          {
            type: "idle",
            land: async () => {
              await armed(r);
              r.apply(r.fail());
            },
          },
        ],
        // The write queues the re-run of `math > adds` at gate 0, as the daemon would.
        plan: [{ tools: [WRITE, gateCall(0)] }, { text: "done" }, { text: "seen" }],
      },
      [() => r.queue("k2")],
    );

    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stderr).not.toMatch(/Extension error/);
    const [, settled, woken, more] = run.requests;
    expect(mentions(FAIL, settled)).toBe(0);
    expect(textOf(lastMessage(woken))).toMatch(/^SQUEAL · /);
    expect(textOf(lastMessage(woken))).toContain(FAIL);
    expect(mentions(FAIL, woken)).toBe(1);
    expect(more).toBeUndefined();
    expect(runsStarted(run)).toBe(2);
  });

  it.each(["print", "json"] as const)(
    "%s: no wake is armed, and Pi exits promptly",
    { timeout: 60_000 },
    async (mode) => {
      const r = passing();
      let consumer: Consumer | null = null;
      const [run, ms] = await inRepo(
        r,
        { mode, prompts: ["work"], plan: [{ tools: [WRITE, gateCall(0)] }, { text: "done" }] },
        [
          () => {
            consumer = piConsumer(r);
            r.queue("k2");
          },
        ],
      );

      expect(run.exitCode, run.stderr).toBe(0);
      expect(run.requests).toHaveLength(2);
      // A wake takes its consumer's waiter lock, creating its file: none ever ran.
      expect(consumer).not.toBeNull();
      expect(lockState(r, consumer)).toBe("absent");
      expect(ms).toBeLessThan(PROMPT_EXIT_MS);
    },
  );

  it("rpc: a prompt before the result cancels the wake, and the news comes with its run", {
    timeout: 60_000,
  }, async () => {
    const r = passing();
    let duringNext: WaiterLockState | null = null;
    const [run] = await inRepo(
      r,
      {
        mode: "rpc",
        prompts: ["work", "next"],
        plan: [
          { tools: [WRITE, gateCall(0)] },
          { text: "done" },
          { tools: [gateCall(1)] },
          { text: "seen" },
        ],
      },
      [
        () => r.queue("k2"),
        () => {
          duringNext = lockState(r);
          r.apply(r.fail());
        },
      ],
    );

    expect(run.exitCode, run.stderr).toBe(0);
    // The prompt released the wake's lock, if it was armed yet: no wait outlives a run's start.
    expect(duringNext).not.toBe("held");
    const [, , next, seen, more] = run.requests;
    expect(mentions(FAIL, next)).toBe(0);
    expect(mentions(FAIL, seen)).toBe(1);
    expect(more).toBeUndefined();
    expect(runsStarted(run)).toBe(2);
  });
});
