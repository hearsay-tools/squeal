import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallOptions } from "../../../src/harness/opencode/bridge-client.js";
import { IDLE_WAIT_MS } from "../../../src/harness/opencode/bridge-turn.js";
import { deadlineIn } from "../../../src/harness/opencode/deadline.js";
import type { OcAnswers, OcConsumer } from "../../../src/harness/opencode/protocol.js";
import {
  type Ask,
  turns,
  WAIT_BOUND_MS,
  WAKE_REARMS,
} from "../../../src/harness/opencode/turns.js";
import { chatOutput, MESSAGE_ID, ROOT_ID, stubClient } from "./stub.js";

/*
 * Row 011-433, spec 008 D5: an idle wait that ends empty before the
 * waiter's bound, not cancelled, is armed again, a bounded number of times;
 * a cancelled wait, and one that lasted the bound, stay ended.
 */

const REPORT = "SQUEAL · revision 4: PASS -> FAIL";
const ROOT: OcConsumer = { sessionId: ROOT_ID };

/** What one wait answers: news, empty, a failed bridge, or nothing until cancelled. */
type WaitEnd = OcAnswers["wait"] | null | "stall";

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The plugin's turns on a stub client and a bridge whose waits end as
 * `ends` say in order, `{ text: null }` past the end; Stop has no news.
 * `beforeEnd` runs as each wait is asked.
 */
function idleWith(ends: WaitEnd[], rearmDelayMs = 0, beforeEnd = () => {}) {
  const client = stubClient();
  let waits = 0;
  const ask = (async (
    kind: string,
    _request: unknown,
    _deadline: unknown,
    options?: CallOptions,
  ) => {
    if (kind === "stop") return { report: null };
    if (kind !== "wait") return null;
    waits++;
    beforeEnd();
    const end = ends.shift() ?? { text: null };
    if (end !== "stall") return end;
    return new Promise<null>((resolve) =>
      options?.signal?.addEventListener("abort", () => resolve(null)),
    );
  }) as Ask;
  const turn = turns(client, ask, rearmDelayMs);
  const idle = async () => {
    turn.message(ROOT_ID, MESSAGE_ID, chatOutput(ROOT_ID).parts);
    await turn.idle(ROOT, deadlineIn(2_000));
  };
  return { client, turn, idle, waits: () => waits };
}

// Counts its sleeps, not the clock: one test fakes `performance`.
async function until(done: () => boolean, ms = 2_000): Promise<void> {
  for (let slept = 0; !done() && slept < ms; slept += 10) await sleep(10);
}

describe("the idle wait's re-arm", () => {
  it.each([
    ["ended empty", { text: null }],
    ["failed in the bridge", null],
  ] as const)("delivers the news of a re-arm after a first wait that %s", async (_, first) => {
    const run = idleWith([first, { text: REPORT }]);
    await run.idle();
    await until(() => run.client.prompted.length === 1);
    expect(run.client.prompted).toEqual([{ id: ROOT_ID, text: REPORT }]);
    expect(run.waits()).toBe(2);
  });

  it("is armed again a bounded number of times, then stays silent", async () => {
    const run = idleWith([]);
    await run.idle();
    await until(() => run.waits() === 1 + WAKE_REARMS);
    await sleep(100);
    expect(run.waits()).toBe(1 + WAKE_REARMS);
    expect(run.client.prompted).toEqual([]);
  });

  it("is not armed again when the empty wait lasted the waiter's bound: that is expiry", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const run = idleWith([], 0, () => vi.advanceTimersByTime(WAIT_BOUND_MS));
    await run.idle();
    await sleep(100);
    expect(run.waits()).toBe(1);
  });

  it.each(["message", "forget", "stop"] as const)(
    "is not armed again once a %s cancelled the wait",
    async (cancel) => {
      const run = idleWith(["stall", { text: REPORT }]);
      await run.idle();
      await until(() => run.waits() === 1);
      if (cancel === "message") run.turn.message(ROOT_ID, "msg_next", chatOutput(ROOT_ID).parts);
      else if (cancel === "forget") run.turn.forget(ROOT_ID);
      else run.turn.stop(deadlineIn(500));
      await sleep(100);
      expect(run.waits()).toBe(1);
      expect(run.client.prompted).toEqual([]);
    },
  );

  it.each(["message", "none"] as const)(
    "in the pause before a re-arm, is cancelled by %s",
    async (cancel) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const run = idleWith([{ text: null }, { text: REPORT }], 60_000);
      await run.idle();
      // The empty answer reached the plugin once the start of its pause is pending.
      await until(() => vi.getTimerCount() === 1);
      if (cancel === "message") run.turn.message(ROOT_ID, "msg_next", chatOutput(ROOT_ID).parts);
      vi.advanceTimersByTime(60_000);
      await sleep(100);
      expect(run.waits()).toBe(cancel === "message" ? 1 : 2);
    },
  );

  it("keeps the waiter's own bound", () => {
    expect(WAIT_BOUND_MS).toBe(IDLE_WAIT_MS);
  });
});
