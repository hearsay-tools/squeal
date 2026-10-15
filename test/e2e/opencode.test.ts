import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { PRIMER_OPENING } from "../../src/harness/shared/primer.js";
import {
  type ChatMessage,
  PLANNED_MODEL,
  type ScriptedRequest,
} from "../fixtures/opencode/scripted-provider.js";
import { type OpenCodeRun, opencodeUnavailable, textOf } from "../helpers/opencode.js";
import { fixtureInstall, type Install } from "./install.js";
import { OpenCodeE2E, type OpenCodeE2EOptions } from "./opencode-fixture.js";
import { type Timeline, timeline } from "./opencode-timeline.js";
import { type Watched, watchRun } from "./opencode-watch.js";
import { MATH, SLOW } from "./sources.js";
import { daemonPids, until } from "./support.js";

/*
 * Spec 008 Testing, end to end (`opencode-fixture.ts`): the shipped OpenCode
 * package, installed with the real `opencode plugin file:<...>/current -g`,
 * validating a fixture repository through the daemon its bridge spawns, or
 * the copy's daemon started first (`started`). With nothing standing in for
 * Squeal: the baseline, a `PASS -> FAIL` in the next model request (goals 1
 * and 2), the primer (5), the block of the next edit (3), one continuation
 * then silence (4), the idle wake under `serve` (7), `squeal status` from the
 * agent's shell pulled as its consumer (D2, D7), and silence where Squeal is
 * not set up.
 */

const unavailable = opencodeUnavailable();
if (unavailable && process.env.CI) throw new Error(`OpenCode unavailable on CI: ${unavailable}`);

/** A delivered regression's line; the primer names `PASS -> FAIL` too. */
const FAIL = "PASS -> FAIL, seen by Squeal";
const ADDS = "FAIL  test/math.test.ts > math > adds";
/** How long silence must hold after the last expected request. */
const QUIET_MS = 4_000;
/**
 * Stop's longest wait, so the idle's deadline is 2 s, not 500 ms (D4): the tests that settle the
 * regression before the turn ends test its delivery, not the deadline (review 008-27 S1).
 */
const STOP_WAIT_MS = 1_500;
/** Tries of the stored-once `run --continue` check; each but the last may miss a deadline. */
const CONTINUE_ATTEMPTS = 3;

let install: Install = { ok: false, reason: "the install did not run" };
beforeAll(async () => {
  install = await fixtureInstall("vitest");
}, 400_000);

const fixtures: OpenCodeE2E[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
}, 60_000);

const plugins: string[] = [];
afterAll(async () => {
  await until("no fixture daemon left", 10_000, async () =>
    plugins.every((plugin) => daemonPids(plugin).length === 0) ? true : null,
  );
}, 20_000);

function fixture(ctx: TestContext, options: OpenCodeE2EOptions = {}): OpenCodeE2E {
  const ready = install;
  if (!ready.ok && process.env.CI) throw new Error(`end to end install failed: ${ready.reason}`);
  if (!ready.ok) return ctx.skip(`end to end skipped: ${ready.reason}`);
  const made = OpenCodeE2E.create(ready.dir, options);
  fixtures.push(made);
  plugins.push(made.plugin);
  return made;
}

/**
 * Goal 4 and D5 under `run`: a fresh fixture whose regression is known before the turn's last
 * reply returns, so it is undelivered when the turn ends and `run` disposes the instance; then
 * `run --continue`, and the timeline of the first run's end (review 008-27 S1).
 */
async function storedThenContinued(
  ctx: TestContext,
): Promise<{ e2e: OpenCodeE2E; first: OpenCodeRun; next: OpenCodeRun; marked: Timeline }> {
  const e2e = fixture(ctx, { started: true, stopWaitMs: STOP_WAIT_MS });
  let watched: Promise<Watched> = Promise.resolve({
    consumers: [],
    bridges: [],
    host: null,
    gap: 0,
  });
  const exits: Record<string, number> = {};
  const first = await e2e.run(
    {
      mode: "run",
      plan: [{ tools: [e2e.gateCall(0)] }, { text: "done", release: e2e.releasePath(1) }],
    },
    async (world) => {
      try {
        if (!(await e2e.atGate(world, 0, async () => {}))) return;
        await until("request 1", 60_000, async () =>
          world.planned().length > 1 || world.done() ? true : null,
        );
        e2e.edit("math", MATH("-"));
        await e2e.settled("fail");
      } finally {
        // From the last reply to the exit: Stop's delivery, the bridges, `dispose`'s end.
        watched = watchRun(e2e.store.database, e2e.base, world);
        e2e.release(1);
      }
    },
  );
  exits.run = Date.now();
  expectClean(first, "run");
  // No model request after the last reply: `run` ends at idle.
  expect(first.requests).toHaveLength(2);
  expect(
    mentions(
      FAIL,
      first.requests.flatMap((r) => r.messages),
    ),
  ).toBe(0);
  const next = await e2e.continue({ plan: [{ text: "noted" }], prompt: "what is new?" });
  exits["run --continue"] = Date.now();
  const marked = timeline({
    first,
    session: first.sessionID ?? "",
    database: e2e.store.database,
    stopWaitMs: STOP_WAIT_MS,
    watched: await watched,
    exits,
  });
  return { e2e, first, next, marked };
}

/** The messages `next` carries that `previous` did not: the last turn's reply and results. */
const added = (next: ScriptedRequest | undefined, previous: ScriptedRequest | undefined) =>
  (next?.messages ?? []).slice(previous?.messages.length ?? 0);

const mentions = (text: string, messages: ChatMessage[]) =>
  messages.filter((message) => textOf(message).includes(text)).length;

/** How many requests went to the planned model, OpenCode's title requests left out. */
const planned = (requests: ScriptedRequest[]) =>
  requests.filter((q) => q.model === PLANNED_MODEL).length;

const system = (request: ScriptedRequest | undefined) =>
  (request?.messages ?? [])
    .filter((m) => m.role === "system")
    .map((m) => textOf(m))
    .join("\n");

const squealText = (request: ScriptedRequest | undefined) =>
  (request?.messages ?? []).filter((m) => m.role !== "system" && textOf(m).includes("SQUEAL"));

function expectClean(run: OpenCodeRun, mode: "run" | "serve"): void {
  expect(run.exitCode, run.stderr).toBe(mode === "run" ? 0 : null);
  expect(
    run.events.some((e) => e.type === "error"),
    run.stdout,
  ).toBe(false);
}

describe.skipIf(unavailable !== undefined)(
  "the shipped OpenCode package, installed with opencode plugin",
  () => {
    it("run: starts the copy's daemon, which passes a baseline, and a PASS -> FAIL reaches the next request", {
      timeout: 240_000,
    }, async (ctx) => {
      const e2e = fixture(ctx);
      let pids: number[] = [];
      const run = await e2e.run(
        {
          mode: "run",
          plan: [
            { tools: [e2e.gateCall(0)] },
            { tools: [e2e.writeCall("math", MATH("-")), e2e.gateCall(1)] },
            { tools: [e2e.writeCall("math", MATH()), e2e.gateCall(2)] },
            { text: "done" },
          ],
        },
        async (world) => {
          await e2e.atGate(world, 0, async () => {
            pids = await e2e.baseline();
          });
          await e2e.atGate(world, 1, () => e2e.settled("fail"));
          await e2e.atGate(world, 2, () => e2e.settled("pass"));
        },
      );
      expectClean(run, "run");
      // Goal 8: one entry in OpenCode's global config, the stable path, and nothing Squeal wrote.
      const config = JSON.parse(readFileSync(join(e2e.globalConfig, "opencode.json"), "utf8"));
      expect(config.plugin).toEqual([`file:${e2e.current}`]);
      expect(readdirSync(e2e.globalConfig).sort()).toEqual([
        ".gitignore",
        "node_modules",
        "opencode.json",
        "package-lock.json",
        "package.json",
      ]);
      // The bridge spawned the daemon from the installed copy's CLI.
      expect(pids).toHaveLength(1);

      const [start, broken, fixed, last, more] = run.requests;
      expect(more).toBeUndefined();
      // A fresh repository has no store at the first message: the first tool call's result,
      // once the bridge's daemon made one, carries the registration.
      expect(mentions("registered at revision", start?.messages ?? [])).toBe(0);
      const gate = added(broken, start).find((m) => m.role === "tool");
      expect(textOf(gate)).toMatch(/\n\nSQUEAL · registered at revision \d+/);
      expect(mentions(FAIL, added(broken, start))).toBe(0);
      // Goal 1: in a tool result of the call during which it became known.
      const news = added(fixed, broken).filter((m) => textOf(m).includes(FAIL));
      expect(news).toHaveLength(1);
      expect(news[0]?.role).toBe("tool");
      expect(textOf(news[0])).toMatch(/\n\nSQUEAL · /);
      expect(textOf(news[0])).toContain(ADDS);
      // Goal 2: the fix arrives the same way, and the regression is not repeated.
      const fix = added(last, fixed);
      expect(mentions("FAIL -> PASS", fix)).toBe(1);
      expect(mentions(FAIL, fix)).toBe(0);
      // Goal 5 from a tool boundary (008-22): no primer before the store exists, then the
      // primer from the request after the tool call that registered the consumer.
      expect(system(start)).not.toContain(PRIMER_OPENING);
      for (const request of run.requests.slice(1)) {
        expect(system(request)).toContain(PRIMER_OPENING);
        expect(system(request)).toContain(e2e.cliPath);
      }
      // A daemon that left with its session may have been replaced: the copy's either way.
      expect(daemonPids(e2e.plugin)).toHaveLength(1);
    });

    it("run: the next write after an undelivered PASS -> FAIL is blocked once, and can be re-issued", {
      timeout: 240_000,
    }, async (ctx) => {
      const e2e = fixture(ctx, { started: true });
      const out = { name: "write", arguments: { filePath: "out.txt", content: "x\n" } };
      const run = await e2e.run(
        {
          mode: "run",
          // The test breaks `math > adds` only once request 1 is in flight, past the gate's
          // boundary, and the model returns that request's write only once the re-run has
          // landed, so the write is the first to meet it.
          plan: [
            { tools: [e2e.gateCall(0)] },
            { tools: [out], release: e2e.releasePath(1) },
            { tools: [out] },
            { text: "done" },
          ],
        },
        async (world) => {
          try {
            if (!(await e2e.atGate(world, 0, async () => {}))) return;
            await until("request 1", 60_000, async () =>
              world.planned().length > 1 || world.done() ? true : null,
            );
            e2e.edit("math", MATH("-"));
            await e2e.settled("fail");
          } finally {
            e2e.release(1);
          }
        },
      );
      expectClean(run, "run");
      const [start, boundary, blocked, reissued, more] = run.requests;
      // The store exists at the first message: it registers, with the header in that message.
      expect(textOf(start?.messages.at(-1))).toMatch(/SQUEAL · registered at revision \d+/);
      // Goal 5: the primer, naming the copy's CLI, in every request.
      for (const request of run.requests) {
        expect(system(request)).toContain(PRIMER_OPENING);
        expect(system(request)).toContain(e2e.cliPath);
      }
      expect(more).toBeUndefined();
      expect(mentions(FAIL, added(boundary, run.requests[0]))).toBe(0);
      const denial = added(blocked, boundary);
      expect(mentions(FAIL, denial)).toBe(1);
      const reason = textOf(denial.find((m) => m.role === "tool"));
      expect(reason).toContain(ADDS);
      expect(reason).toContain("denied this write call, so the edit was not applied");
      const written = added(reissued, blocked);
      expect(textOf(written.find((m) => m.role === "tool"))).toContain("Wrote file successfully");
      expect(mentions(FAIL, written)).toBe(0);
      expect(readFileSync(join(e2e.project, "out.txt"), "utf8")).toBe("x\n");
    });

    it("serve: news at the end of a turn continues it once, then silence", {
      timeout: 240_000,
    }, async (ctx) => {
      const e2e = fixture(ctx, { stopWaitMs: STOP_WAIT_MS });
      const run = await e2e.run(
        {
          mode: "serve",
          // No tool call after the regression: it is undelivered when the turn ends.
          plan: [
            { tools: [e2e.gateCall(0)] },
            { text: "done", release: e2e.releasePath(1) },
            { text: "noted" },
          ],
          afterReply: async (live) => {
            await until("the continuation", 60_000, async () =>
              planned(live.requests) > 2 ? true : null,
            );
            await sleep(QUIET_MS);
          },
        },
        async (world) => {
          try {
            if (!(await e2e.atGate(world, 0, () => e2e.baseline()))) return;
            await until("request 1", 60_000, async () =>
              world.planned().length > 1 || world.done() ? true : null,
            );
            e2e.edit("math", MATH("-"));
            await e2e.settled("fail");
          } finally {
            e2e.release(1);
          }
        },
      );
      expectClean(run, "serve");
      const [, ended, continued, more] = run.requests;
      expect(more).toBeUndefined();
      expect(mentions(FAIL, added(ended, run.requests[0]))).toBe(0);
      const report = added(continued, ended).filter((m) => m.role === "user");
      expect(report).toHaveLength(1);
      expect(textOf(report[0])).toMatch(/^SQUEAL · /);
      expect(textOf(report[0])).toContain(ADDS);
    });

    it("run: news at the end of the turn is stored in the session, and run --continue reads it once", {
      timeout: 600_000,
    }, async (ctx) => {
      // An attempt whose report missed one of D4's deadlines, as its timeline proves, is load's
      // silence, not the defect this checks (review 008-27 S1): annotated, then tried again.
      for (let n = 1; ; n++) {
        const { e2e, first, next, marked } = await storedThenContinued(ctx);
        expectClean(next, "run");
        expect(next.sessionID, marked.text).toBe(first.sessionID);
        const [resumed, more] = next.requests;
        expect(more, marked.text).toBeUndefined();
        // The stored continuation, a user message between the last reply and the new prompt.
        const since = added(resumed, first.requests[1]).filter((m) => m.role === "user");
        const stored = since.filter((m) => textOf(m).includes(FAIL));
        if (stored.length === 0 && marked.missedDeadline && n < CONTINUE_ATTEMPTS) {
          await ctx.annotate(
            `attempt ${n} of ${CONTINUE_ATTEMPTS} stored nothing:\n${marked.text}`,
          );
          // Its daemon would load the next attempt; `afterEach` finds it stopped.
          await e2e.cleanup();
          continue;
        }
        expect(stored, marked.text).toHaveLength(1);
        expect(textOf(stored[0])).toMatch(/^SQUEAL · /);
        expect(textOf(stored[0])).toContain(ADDS);
        // Only the report: the plugin instance OpenCode re-creates to store it adds no header.
        expect(textOf(stored[0])).not.toContain("registered at revision");
        expect(textOf(since.at(-1))).toContain("what is new?");
        return;
      }
    });

    it("serve: the agent's own edit failing after its turn ended wakes it with the PASS -> FAIL, once", {
      timeout: 240_000,
    }, async (ctx) => {
      const e2e = fixture(ctx, { slow: true });
      const run = await e2e.run(
        {
          mode: "serve",
          // The turn ends while its edit's slow re-run is pending; the plugin starts the next.
          plan: [
            { tools: [e2e.gateCall(0)] },
            { tools: [e2e.writeCall("slow", SLOW(3)), e2e.gateCall(1)] },
            { text: "done" },
            { text: "seen" },
          ],
          afterReply: async (live) => {
            await until("the idle wake", 60_000, async () =>
              planned(live.requests) > 3 ? true : null,
            );
            await sleep(QUIET_MS);
          },
        },
        async (world) => {
          if (!(await e2e.atGate(world, 0, () => e2e.baseline()))) return;
          await e2e.atGate(world, 1, () =>
            until("the slow re-run to start", 20_000, async () =>
              (await e2e.status()).counts.pending > 0 ? true : null,
            ),
          );
        },
      );
      expectClean(run, "serve");
      const [, , settled, woken, more] = run.requests;
      expect(more).toBeUndefined();
      expect(squealText(settled).filter((m) => textOf(m).includes(FAIL))).toEqual([]);
      const wake = added(woken, settled).filter((m) => m.role === "user");
      expect(wake).toHaveLength(1);
      expect(textOf(wake[0])).toMatch(/^SQUEAL · /);
      expect(textOf(wake[0])).toContain("FAIL  test/slow.test.ts > doubles slowly");
    });

    it("run: squeal status in the agent's shell is this package's, and its pull is its consumer's", {
      timeout: 240_000,
    }, async (ctx) => {
      const e2e = fixture(ctx, { started: true, slow: true });
      const shell = {
        name: "bash",
        arguments: {
          command: "env | grep '^OPENCODE_' | sort; command -v squeal; squeal status --wait 60000",
          description: "status",
        },
      };
      // Long enough that the agent's shell pulls while the re-run is in flight.
      const slowEdit = SLOW(3).replace(/SLOW_MS = \d+/, "SLOW_MS = 15000");
      const registered: string[] = [];
      const run = await e2e.run(
        {
          mode: "run",
          // The agent's own edit queues the slow file; its shell's pull waits for that re-run.
          plan: [
            { tools: [e2e.gateCall(0)] },
            { tools: [e2e.writeCall("slow", slowEdit)] },
            { tools: [shell] },
            { text: "done" },
          ],
        },
        async (world) => {
          await e2e.atGate(world, 0, async () => {
            registered.push(...e2e.sessions());
            // D7: a shell under OpenCode where the plugin never ran is told how to install it.
            const before = await e2e.cli(["status"], { OPENCODE: "1", OPENCODE_PID: "1" });
            expect(before.stdout).toMatch(/^OpenCode: .*install\.sh/m);
          });
        },
      );
      expectClean(run, "run");
      expect(run.sessionID).toBeDefined();
      expect(registered).toEqual([run.sessionID]);
      const output = textOf(added(run.requests[3], run.requests[2]).find((m) => m.role === "tool"));
      // D2: the shell names the session's consumer, and `squeal` there is the copy's launcher.
      expect(output).toContain(`OPENCODE_SESSION_ID=${run.sessionID}\n`);
      expect(output).toContain("OPENCODE_AGENT_ID=main\n");
      expect(output).toContain(`${join(e2e.plugin, "bin/squeal")}\n`);
      // The pull is the consumer's: it holds for the re-run its edit queued and returns its news.
      expect(output).toMatch(/^Returned on news: 1 transition/m);
      expect(output).toContain("FAIL  test/slow.test.ts > doubles slowly");
      // D7: the consumer is registered, so status adds no OpenCode line.
      expect(output).not.toMatch(/^OpenCode: /m);
    });

    it.for(["run", "serve"] as const)(
      "%s: in a repository where Squeal is not set up, it starts no daemon and says nothing",
      { timeout: 180_000 },
      async (mode, ctx) => {
        const e2e = fixture(ctx, { squeal: false });
        // A handle the plugin held would keep `run` up past `runOpenCode`'s timeout, which throws.
        const run = await e2e.run({
          mode,
          plan: [
            { tools: [{ name: "write", arguments: { filePath: "out.txt", content: "x\n" } }] },
            { text: "done" },
          ],
        });
        expectClean(run, mode);
        expect(run.requests).toHaveLength(2);
        for (const request of run.requests) {
          expect(squealText(request)).toEqual([]);
          expect(system(request)).not.toContain(PRIMER_OPENING);
        }
        expect(daemonPids(e2e.plugin)).toEqual([]);
        expect(existsSync(e2e.store.dir)).toBe(false);
      },
    );
  },
);
