import { writeFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { PLANNED_MODEL } from "../fixtures/opencode/scripted-provider.js";
import { type OpenCodeLive, opencodeUnavailable } from "../helpers/opencode.js";
import type { SquealRepo } from "./helpers.js";
import {
  type Barriers,
  barriers as heldStop,
  INPUT,
  logged,
  Missed,
  OLD,
  reached,
  saw,
  stopGone,
  timeline,
} from "./opencode/held-stop.js";
import { buildOpencodeBundles } from "./opencode/helpers.js";
import { type SquealRun, squealOpenCode } from "./opencode/real.js";

/*
 * Review 008-27 B1 with the real OpenCode 1.18.35: the first reply goes idle
 * and its Stop is held; `dispose` begins, and lets that idle finish to store
 * its news (008-25); then new input arrives, which OpenCode routes to the
 * plugin instance it re-creates, and in the second case that turn is
 * aborted. Only then does the held Stop answer. Its report is the old turn's
 * and must not be stored. Barriers order each step, no sleep decides the
 * race: Stop began, `dispose` entered, the input reached `chat.message`, the
 * abort reached the listeners, then Stop answers. The Stop is a stand-in
 * that answers once; every other bridge is the built one, and a wrapper
 * around the built plugin records the lifecycle and delegates to it.
 *
 * The held Stop runs inside the idle's deadline, `stop.waitMs` 1,500 plus
 * 500 ms (D4), which the plugin enforces by killing it. On a loaded host the
 * re-created instance can take longer than that to see the new input or the
 * abort (review 008-27 round 2), so the Stop is gone before its barrier: that
 * attempt never reached the order under test and says so (`Missed`), with
 * each mark's time since idle, and the test tries again, `ATTEMPTS` in all.
 * Only the plugin's kill of the Stop at or after that deadline is a miss
 * (review 008-32 B2); any other end of the Stop fails the test with its
 * marks (`held-stop.ts`).
 */

const unavailable = opencodeUnavailable();
if (unavailable && process.env.CI)
  throw new Error(`OpenCode fixture unavailable on CI: ${unavailable}`);

const ATTEMPTS = 3;

let built = { dir: "", cleanup: () => {} };
const runs: SquealRun[] = [];
beforeAll(async () => {
  built = await buildOpencodeBundles();
}, 120_000);
afterAll(() => built.cleanup());
afterEach(() => {
  for (const { run } of runs.splice(0)) run.cleanup();
});

const barriers = (releaseAtInput: boolean) => heldStop(built.dir, releaseAtInput);

/** `attempt` until one reaches its barriers, `ATTEMPTS` in all; each missed one is annotated. */
async function ordered<T>(ctx: TestContext, attempt: () => Promise<T>): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof Missed) || n === ATTEMPTS) throw error;
      await ctx.annotate(`attempt ${n} of ${ATTEMPTS} missed its barriers: ${error.message}`);
    }
  }
}

/** OpenCode's request on the fixture project's instance. */
const call = (live: OpenCodeLive, r: SquealRepo, path: string, method = "GET") =>
  fetch(`${live.url}${path}`, { method, headers: { "x-opencode-directory": r.root } });

/** The session's user message texts, as OpenCode stored them. */
async function userTexts(live: OpenCodeLive, r: SquealRepo): Promise<string[]> {
  const response = await call(live, r, `/session/${live.sessionID}/message`);
  const messages = (await response.json()) as {
    info: { role: string };
    parts: { type: string; text?: string }[];
  }[];
  return messages
    .filter((m) => m.info.role === "user")
    .map((m) => m.parts.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join(""));
}

/**
 * A `serve` run whose first reply's Stop is held; once it began, `dispose`
 * starts and, once it entered, `during` runs; then what OpenCode stored.
 */
async function overtaken(
  b: Barriers,
  during: (live: OpenCodeLive, r: SquealRepo) => Promise<void>,
): Promise<string[]> {
  let texts: string[] = [];
  const result = await squealOpenCode({
    dist: built.dir,
    plugin: b.plugin,
    timeoutMs: 120_000,
    mode: "serve",
    prompt: "think",
    plan: [{ text: "done" }, { text: "second", release: b.reply }, { text: "late" }],
    prepare: (r) => r.policy({ stop: { waitMs: 1_500 } }),
    afterReply: async (live, r) => {
      await reached(b, "Stop began", () => saw(b, "stop"));
      const disposing = call(live, r, "/instance/dispose", "POST");
      await reached(b, "dispose entered", () => saw(b, "dispose"));
      const second = live.message(INPUT).catch(() => {});
      await during(live, r);
      expect((await disposing).ok).toBe(true);
      writeFileSync(b.reply, "");
      await second;
      texts = await userTexts(live, r);
    },
  });
  runs.push(result);
  return texts;
}

describe.skipIf(unavailable !== undefined)("a report held while dispose meets newer input", () => {
  it("serve: a held Stop never released is killed at its deadline, a proven miss (review 008-32 B2)", {
    timeout: 180_000,
  }, async () => {
    const b = barriers(false);
    const result = await squealOpenCode({
      dist: built.dir,
      plugin: b.plugin,
      timeoutMs: 120_000,
      mode: "serve",
      prompt: "think",
      plan: [{ text: "done" }],
      prepare: (r) => r.policy({ stop: { waitMs: 1_500 } }),
      afterReply: async () => {
        await reached(b, "Stop began", () => saw(b, "stop"));
        await expect.poll(() => stopGone(b, Date.now()), { timeout: 30_000 }).not.toBeNull();
      },
    });
    runs.push(result);
    const gone = stopGone(b, Date.now());
    expect(gone, timeline(b)).toMatchObject({ missed: true });
    expect(gone?.why).toMatch(/^the plugin killed the held Stop at \+\d+, at or after/);
  });

  it("serve: input routed to the re-created instance drops the old turn's report", {
    timeout: 400_000,
  }, async (ctx) => {
    const { b, texts } = await ordered(ctx, async () => {
      const b = barriers(true);
      const texts = await overtaken(b, () => reached(b, "Stop answered", () => saw(b, "answered")));
      return { b, texts };
    });
    const marked = timeline(b);
    expect(logged(b).slice(0, 4), marked).toEqual(["stop", "dispose", "input", "answered"]);
    expect(texts.some((t) => t.startsWith("think"))).toBe(true);
    expect(texts.some((t) => t.startsWith(INPUT))).toBe(true);
    expect(
      texts.filter((t) => t.includes(OLD)),
      marked,
    ).toEqual([]);
  });

  it("serve: an abort of the new turn, then the old Stop's answer, stores nothing", {
    timeout: 400_000,
  }, async (ctx) => {
    const { b, texts } = await ordered(ctx, async () => {
      const b = barriers(false);
      const texts = await overtaken(b, async (live, r) => {
        const planned = () => live.requests.filter((q) => q.model === PLANNED_MODEL);
        await reached(b, "the new turn's request", () => planned().length >= 2);
        expect(planned(), timeline(b)).toHaveLength(2);
        const aborted = await call(live, r, `/session/${live.sessionID}/abort`, "POST");
        expect(aborted.ok, timeline(b)).toBe(true);
        await reached(b, "the abort reached the listeners", () => saw(b, "aborted"));
        writeFileSync(b.release, "");
        await reached(b, "Stop answered", () => saw(b, "answered"));
      });
      return { b, texts };
    });
    const marked = timeline(b);
    expect(logged(b).slice(0, 3), marked).toEqual(["stop", "dispose", "input"]);
    expect(logged(b).indexOf("aborted"), marked).toBeLessThan(logged(b).indexOf("answered"));
    expect(texts.some((t) => t.startsWith(INPUT))).toBe(true);
    expect(
      texts.filter((t) => t.includes(OLD)),
      marked,
    ).toEqual([]);
  });
});
