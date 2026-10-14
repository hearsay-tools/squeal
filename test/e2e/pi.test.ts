import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { waiterLockState } from "../../src/core/waiter-lock/index.js";
import { PRIMER_OPENING } from "../../src/harness/shared/primer.js";
import {
  atGate,
  gateCall,
  lastMessage,
  requestStarted,
  squealMessages,
} from "../harness/pi/real-pi.js";
import { type PiRequest, type PiRun, piUnavailable, textOf } from "../helpers/pi.js";
import { fixtureInstall, type Install } from "./install.js";
import { filesUnder, installedPackages, PiE2E, type PiE2EOptions } from "./pi-fixture.js";
import { MATH, SLOW } from "./sources.js";
import { daemonPids, until } from "./support.js";

/*
 * Spec 009 Testing, end to end (`pi-fixture.ts`): the shipped Pi package,
 * installed with `pi install`, validating a fixture repository through the
 * daemon it spawns. Goals 1 to 8 with nothing standing in for Squeal: the
 * baseline, a `PASS -> FAIL` in the next model request, the deny of the next
 * edit, the idle wake in `rpc`, and silence where Squeal is not set up.
 */

const unavailable = piUnavailable();
if (unavailable && process.env.CI) throw new Error(`Pi unavailable on CI: ${unavailable}`);

const FAIL = "PASS -> FAIL";
const ADDS = "FAIL  test/math.test.ts > math > adds";
/**
 * The fake model's delay on the request the deny scenario's re-run lands in: the daemon's
 * debounce, a Vitest run of one file and its store write, with room for a loaded host.
 */
const RERUN_WINDOW_MS = 15_000;

let install: Install = { ok: false, reason: "the install did not run" };
beforeAll(async () => {
  install = await fixtureInstall("vitest");
}, 400_000);

const fixtures: PiE2E[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
}, 60_000);

const plugins: string[] = [];
afterAll(async () => {
  await until("no fixture daemon left", 10_000, async () =>
    plugins.every((plugin) => daemonPids(plugin).length === 0) ? true : null,
  );
}, 20_000);

function fixture(ctx: TestContext, options: PiE2EOptions = {}): PiE2E {
  const ready = install;
  if (!ready.ok && process.env.CI) throw new Error(`end to end install failed: ${ready.reason}`);
  if (!ready.ok) return ctx.skip(`end to end skipped: ${ready.reason}`);
  const made = PiE2E.create(ready.dir, options);
  fixtures.push(made);
  plugins.push(made.plugin);
  return made;
}

const mentions = (text: string, request: PiRequest | undefined) =>
  squealMessages(request).filter((message) => textOf(message).includes(text)).length;

const breakMath = (e2e: PiE2E) => e2e.writeCall("math", MATH("-"));

function expectClean(run: PiRun): void {
  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.stderr).not.toMatch(/Extension error/);
  expect(run.events.some((e) => e.type === "extension_error")).toBe(false);
}

describe.skipIf(unavailable !== undefined)(
  "the shipped Pi package, installed with pi install",
  () => {
    it("print: starts the copy's daemon, which passes a baseline, and a PASS -> FAIL reaches the next request", {
      timeout: 180_000,
    }, async (ctx) => {
      const e2e = fixture(ctx);
      // Goal 8: a Pi shell where the extension never ran is told how to install it.
      const before = await e2e.cli(["status"], {
        PI_SESSION_ID: "019a0000-0000-7000-8000-0000000000e2",
      });
      expect(before.stdout).toMatch(/^Pi: .*pi install/m);

      const { run: first, pids } = await e2e.baseline();
      expectClean(first);
      expect(installedPackages(first.agentDir)).toEqual([e2e.plugin]);
      // The extension spawned the daemon from the installed copy's CLI.
      expect(pids).toHaveLength(1);
      // Pi's agent dir holds Pi's own files and the session, nothing Squeal wrote.
      const own = filesUnder(first.agentDir).filter((path) => !path.startsWith("sessions/"));
      expect(own.sort()).toEqual(["auth.json", "models-store.json", "settings.json"]);

      const run = await e2e.run(
        {
          mode: "print",
          prompts: ["work"],
          plan: [
            { tools: [breakMath(e2e), gateCall(0)] },
            { tools: [e2e.writeCall("math", MATH()), gateCall(1)] },
            { text: "done" },
          ],
        },
        async (world, done) => {
          await atGate(world, 0, done, async () => {
            await e2e.settled("fail");
          });
          await atGate(world, 1, done, async () => {
            await e2e.settled("pass");
          });
        },
      );
      expectClean(run);
      const [start, next, fixed, more] = run.requests;
      expect(more).toBeUndefined();
      expect(mentions("registered at revision", start)).toBe(1);
      expect(mentions(FAIL, start)).toBe(0);
      expect(textOf(lastMessage(next))).toMatch(/^SQUEAL · /);
      expect(textOf(lastMessage(next))).toContain(ADDS);
      expect(mentions(FAIL, next)).toBe(1);
      // Goal 2: the fix arrives the same way, and the regression is not repeated.
      expect(textOf(lastMessage(fixed))).toContain("FAIL -> PASS");
      expect(mentions("FAIL -> PASS", fixed)).toBe(1);
      expect(mentions(FAIL, fixed)).toBe(1);
      for (const request of run.requests) {
        expect(request.systemPrompt).toContain(`<squeal>\n${PRIMER_OPENING}`);
        expect(request.systemPrompt).toContain(e2e.cliPath);
      }
      // The baseline's daemon exits 3 s after its session leaves (spec 001 D10, the departure
      // grace), so this session may have spawned another: the copy's either way.
      expect(daemonPids(e2e.plugin)).toHaveLength(1);
    });

    it("print: the next write after an undelivered PASS -> FAIL is denied once, and can be re-issued", {
      timeout: 180_000,
    }, async (ctx) => {
      const e2e = fixture(ctx);
      await e2e.baseline();
      const out = { name: "write", arguments: { path: "out.txt", content: "x\n" } };
      let landed: number | null = null;
      const run = await e2e.run(
        {
          mode: "print",
          prompts: ["work"],
          // The model breaks a test; its re-run lands while the next request is in flight, after
          // the batch's boundary, so the write that request returns is the first to meet it.
          plan: [
            { tools: [breakMath(e2e), gateCall(0)] },
            { tools: [out], delayMs: RERUN_WINDOW_MS },
            { tools: [out] },
            { text: "done" },
          ],
        },
        async (world, done) => {
          const log = await atGate(world, 0, done);
          if (log === null) return;
          await requestStarted(log, 1, done);
          const started = performance.now();
          await e2e.settled("fail");
          landed = performance.now() - started;
        },
      );
      expectClean(run);
      // A re-run slower than the delay meets no write, and the assertions below would mislead.
      expect(landed, "the re-run landed inside the fake model's delay").not.toBeNull();
      expect(landed).toBeLessThan(RERUN_WINDOW_MS);
      const [, boundary, blocked, reissued, more] = run.requests;
      expect(more).toBeUndefined();
      expect(mentions(FAIL, boundary)).toBe(0);
      const denial = blocked?.messages.filter((m) => m.role === "toolResult").at(-1);
      expect(denial).toMatchObject({ role: "toolResult", toolName: "write", isError: true });
      expect(textOf(denial)).toMatch(/^SQUEAL · /);
      expect(textOf(denial)).toContain(ADDS);
      expect(textOf(denial)).toContain("denied this write call, so the edit was not applied");
      // The deny delivered the regression: no entry repeats it.
      expect(mentions(FAIL, blocked)).toBe(0);
      expect(lastMessage(reissued)).toMatchObject({ role: "toolResult", isError: false });
      expect(mentions(FAIL, reissued)).toBe(0);
      expect(readFileSync(join(e2e.project, "out.txt"), "utf8")).toBe("x\n");
    });

    it("rpc: the agent's own edit failing after its run settled wakes it with the PASS -> FAIL, once", {
      timeout: 180_000,
    }, async (ctx) => {
      const e2e = fixture(ctx, { slow: true });
      await e2e.baseline();
      const known = new Set(e2e.sessions());
      let armed = false;
      const run = await e2e.run(
        {
          mode: "rpc",
          // The run ends while its edit's slow re-run is pending; Pi starts the next run itself.
          prompts: [
            "work",
            {
              type: "idle",
              land: async () => {
                // Armed: the wake holds the waiter lock of the session's consumer.
                await until("the idle wake", 20_000, async () => {
                  const session = e2e.sessions().find((id) => !known.has(id));
                  if (session === undefined) return null;
                  const state = waiterLockState(e2e.store.locksDir, e2e.consumer(session));
                  return state === "held" ? state : null;
                });
                armed = true;
              },
            },
          ],
          plan: [
            { tools: [e2e.writeCall("slow", SLOW(3)), gateCall(0)] },
            { text: "done" },
            { text: "seen" },
          ],
          timeoutMs: 90_000,
        },
        async (world, done) => {
          await atGate(world, 0, done, async () => {
            await until("the slow re-run to start", 20_000, async () =>
              (await e2e.status()).counts.pending > 0 ? true : null,
            );
          });
        },
      );
      expectClean(run);
      expect(armed).toBe(true);
      const [, settled, woken, more] = run.requests;
      expect(more).toBeUndefined();
      expect(mentions(FAIL, settled)).toBe(0);
      expect(textOf(lastMessage(woken))).toMatch(/^SQUEAL · /);
      expect(textOf(lastMessage(woken))).toContain("FAIL  test/slow.test.ts > doubles slowly");
      expect(mentions(FAIL, woken)).toBe(1);
      expect(run.events.filter((e) => e.type === "agent_settled")).toHaveLength(2);
    });

    it.for(["print", "rpc"] as const)(
      "%s: in a repository where Squeal is not set up, it starts no daemon and says nothing",
      { timeout: 120_000 },
      async (mode, ctx) => {
        const e2e = fixture(ctx, { squeal: false });
        // A handle the extension held would keep Pi up past `runPi`'s timeout, which throws.
        const run = await e2e.run({
          mode,
          prompts: ["work"],
          plan: [
            { tools: [{ name: "write", arguments: { path: "out.txt", content: "x\n" } }] },
            { text: "done" },
          ],
        });
        expectClean(run);
        expect(run.stderr).toBe("");
        expect(run.requests).toHaveLength(2);
        for (const request of run.requests) {
          expect(squealMessages(request)).toEqual([]);
          expect(request.systemPrompt).not.toContain("<squeal>");
        }
        expect(daemonPids(e2e.plugin)).toEqual([]);
        expect(existsSync(e2e.store.dir)).toBe(false);
      },
    );
  },
);
