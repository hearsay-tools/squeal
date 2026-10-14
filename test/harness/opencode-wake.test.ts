import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PLANNED_MODEL } from "../fixtures/opencode/scripted-provider.js";
import { opencodeUnavailable, textOf } from "../helpers/opencode.js";
import { buildOpencodeBundles } from "./opencode/helpers.js";
import { bridgesRunning, type SquealRun, squealOpenCode } from "./opencode/real.js";

/*
 * Spec 008 goals 4 and 7 with the real OpenCode 1.18.35, the scripted
 * provider and the built plugin: news at the end of a turn continues it
 * once, then silence; under `run` that continuation is not run and `run`
 * exits; under `serve` an idle agent whose pending test file finishes with a
 * regression is woken once with the report.
 */

const unavailable = opencodeUnavailable();
if (unavailable && process.env.CI)
  throw new Error(`OpenCode fixture unavailable on CI: ${unavailable}`);

/** How long silence must hold after the last expected request. */
const QUIET_MS = 4_000;

let built = { dir: "", cleanup: () => {} };
const runs: SquealRun[] = [];
beforeAll(async () => {
  built = await buildOpencodeBundles();
}, 120_000);
afterAll(() => built.cleanup());
afterEach(() => {
  for (const { run } of runs.splice(0)) run.cleanup();
});

const squeal = async (options: Omit<Parameters<typeof squealOpenCode>[0], "dist">) => {
  const result = await squealOpenCode({ dist: built.dir, timeoutMs: 120_000, ...options });
  runs.push(result);
  return result;
};

const planned = (requests: { model: string }[]) =>
  requests.filter((q) => q.model === PLANNED_MODEL);

describe.skipIf(unavailable !== undefined)("the end of a turn in OpenCode", () => {
  it("serve: news at idle continues the turn once, then silence", {
    timeout: 180_000,
  }, async () => {
    const { run } = await squeal({
      mode: "serve",
      prompt: "think",
      // No tool call: the regression is still undelivered when the turn ends.
      plan: [{ text: "done", delayMs: 1_500 }, { text: "noted" }],
      onRegistered: (r) => r.apply(r.fail()),
      afterReply: async (live) => {
        await expect.poll(() => planned(live.requests).length, { timeout: 30_000 }).toBe(2);
        await sleep(QUIET_MS);
      },
    });
    expect(run.requests).toHaveLength(2);
    const continuation = textOf(run.requests[1]?.messages.at(-1));
    expect(continuation).toMatch(/^SQUEAL · /);
    expect(continuation).toContain("PASS -> FAIL");
  });

  it("run: exits at idle with news, starting no second request", { timeout: 180_000 }, async () => {
    const { run } = await squeal({
      mode: "run",
      prompt: "think",
      plan: [{ text: "done", delayMs: 1_500 }, { text: "noted" }],
      onRegistered: (r) => r.apply(r.fail()),
    });
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.requests).toHaveLength(1);
    await expect.poll(() => bridgesRunning(built.dir, "wait.mjs")).toEqual([]);
  });
});

describe.skipIf(unavailable !== undefined)("the idle wake in OpenCode", () => {
  it("serve: an idle agent is woken once when its pending file regresses", {
    timeout: 180_000,
  }, async () => {
    const { run } = await squeal({
      mode: "serve",
      prompt: "edit",
      plan: [{ text: "done", delayMs: 500 }, { text: "woken" }],
      prepare: (r) => r.policy({ stop: { waitMs: 0 } }),
      // The re-run of `math > adds` is pending when the turn ends.
      onRegistered: (r) => r.queue("k2"),
      afterReply: async (live, r) => {
        await expect
          .poll(() => bridgesRunning(built.dir, "wait.mjs").length, { timeout: 30_000 })
          .toBe(1);
        expect(planned(live.requests)).toHaveLength(1);
        r.apply(r.fail());
        await expect.poll(() => planned(live.requests).length, { timeout: 30_000 }).toBe(2);
        await sleep(QUIET_MS);
      },
    });
    expect(run.requests).toHaveLength(2);
    const wake = textOf(run.requests[1]?.messages.at(-1));
    expect(wake).toMatch(/^SQUEAL · /);
    expect(wake).toContain("PASS -> FAIL");
  });
});
