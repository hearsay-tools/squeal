import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PRIMER_OPENING } from "../../src/harness/shared/primer.js";
import { type SquealRepo, squealRepo } from "../harness/helpers.js";
import { buildPiBundles } from "../harness/pi/helpers.js";
import {
  atGate,
  duringRequest,
  gateCall,
  lastMessage,
  piWorld,
  runWithExtension,
  squealMessages,
} from "../harness/pi/real-pi.js";
import { type PiMode, type PiRun, piUnavailable, textOf } from "../helpers/pi.js";

/*
 * Spec 009 goals 1 to 4 against the real Pi 1.0.4 and the shipped extension
 * bundle, built into a temp dir: each delivery in the next model request,
 * once per batch; the end of a run speaks once, as a continuation; an edit
 * over an undelivered regression is blocked once and can be re-issued.
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

/** A fixture repository at a passing baseline. */
function passing(): SquealRepo {
  const r = squealRepo();
  r.apply(r.pass());
  return r;
}

const FAIL = "PASS -> FAIL";
const mentions = (text: string) => (request: { messages: unknown[] } | undefined) =>
  squealMessages(request as never).filter((message) => textOf(message).includes(text)).length;

describe.skipIf(unavailable !== undefined)("the Pi events with real Pi", () => {
  it.each<PiMode>(["print", "json", "rpc"])(
    "%s: a PASS -> FAIL during a tool call reaches the next request, once",
    { timeout: 60_000 },
    async (mode) => {
      const r = passing();
      const world = await piWorld(r);
      const run = await runWithExtension(
        extension,
        {
          mode,
          cwd: r.root,
          prompts: ["work"],
          env: world.env,
          plan: [
            {
              tools: [
                gateCall(0),
                { name: "read", arguments: { path: ".git/HEAD" } },
                { name: "read", arguments: { path: ".git/HEAD" } },
              ],
            },
            { text: "done" },
          ],
        },
        (done) => atGate(world, 0, done, () => r.apply(r.fail())).then(() => {}),
      );
      runs.push(run);

      expect(run.exitCode, run.stderr).toBe(0);
      expect(run.stderr).not.toMatch(/Extension error/);
      const [first, second, third] = run.requests;
      expect(third).toBeUndefined();
      expect(mentions("registered at revision")(first)).toBe(1);
      expect(mentions(FAIL)(first)).toBe(0);
      // Three parallel calls, one delivery, after the last of their results.
      expect(mentions(FAIL)(second)).toBe(1);
      expect(textOf(lastMessage(second))).toContain(FAIL);
      expect(second?.messages.filter((m) => m.role === "toolResult")).toHaveLength(3);
      for (const request of run.requests) {
        expect(request.systemPrompt).toContain(`<squeal>\n${PRIMER_OPENING}`);
      }
      expect(world.spawnedDaemon()).toBe(false);
    },
  );

  it.each<PiMode>(["print", "rpc"])(
    "%s: news after the last tool call continues the run once, then silence",
    { timeout: 60_000 },
    async (mode) => {
      const r = passing();
      const world = await piWorld(r);
      const run = await runWithExtension(
        extension,
        {
          mode,
          cwd: r.root,
          prompts: ["work"],
          env: world.env,
          plan: [{ tools: [gateCall(0)] }, { text: "done", delayMs: 1_500 }, { text: "seen" }],
        },
        (done) => duringRequest(world, 1, done, () => r.apply(r.fail())),
      );
      runs.push(run);

      expect(run.exitCode, run.stderr).toBe(0);
      const [, last, continued, more] = run.requests;
      // The final turn_end delivers nothing: the settle carries the news, as one more request.
      expect(mentions(FAIL)(last)).toBe(0);
      expect(textOf(lastMessage(continued))).toContain(FAIL);
      expect(mentions(FAIL)(continued)).toBe(1);
      expect(more).toBeUndefined();
    },
  );

  it.each<PiMode>(["print", "rpc"])(
    "%s: an edit over an undelivered regression is blocked once and can be re-issued",
    { timeout: 60_000 },
    async (mode) => {
      const r = passing();
      const world = await piWorld(r);
      const write = { name: "write", arguments: { path: "out.txt", content: "x\n" } };
      const run = await runWithExtension(
        extension,
        {
          mode,
          cwd: r.root,
          prompts: ["work"],
          env: world.env,
          plan: [
            { tools: [gateCall(0)] },
            { tools: [write], delayMs: 1_500 },
            { tools: [write] },
            { text: "done" },
          ],
        },
        (done) => duringRequest(world, 1, done, () => r.apply(r.fail())),
      );
      runs.push(run);

      expect(run.exitCode, run.stderr).toBe(0);
      const [, , blocked, reissued, after] = run.requests;
      const denial = lastMessage(blocked);
      expect(denial).toMatchObject({ role: "toolResult", toolName: "write", isError: true });
      expect(textOf(denial)).toMatch(/^SQUEAL · /);
      expect(textOf(denial)).toContain(FAIL);
      expect(textOf(denial)).toContain("denied this write call, so the edit was not applied");
      // The block delivered the regression: no entry repeats it.
      expect(mentions(FAIL)(blocked)).toBe(0);
      expect(lastMessage(reissued)).toMatchObject({ role: "toolResult", isError: false });
      expect(readFileSync(join(r.root, "out.txt"), "utf8")).toBe("x\n");
      expect(mentions(FAIL)(reissued)).toBe(0);
      expect(after).toBeUndefined();
    },
  );
});
