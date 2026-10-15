import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PLANNED_MODEL } from "../fixtures/opencode/scripted-provider.js";
import { opencodeUnavailable, textOf } from "../helpers/opencode.js";
import { tempDir } from "../store/helpers.js";
import { buildOpencodeBundles } from "./opencode/helpers.js";
import { type SquealRun, squealOpenCode } from "./opencode/real.js";

/*
 * Spec 008 goal 4 under `serve` with the real OpenCode 1.18.35, the scripted
 * provider and the built plugin (lessons, defect 5): turn 1's regression is
 * known before its idle, so Squeal continues it; the continued turn's own
 * edit flips the check back before that turn's idle. The continued idle ends
 * silent, and the `FAIL -> PASS` reaches the model with the next user prompt.
 */

const unavailable = opencodeUnavailable();
if (unavailable && process.env.CI)
  throw new Error(`OpenCode fixture unavailable on CI: ${unavailable}`);

/** How long silence must hold after the continued turn. */
const QUIET_MS = 4_000;
const NEXT = "anything new?";

let built = { dir: "", cleanup: () => {} };
const runs: SquealRun[] = [];
beforeAll(async () => {
  built = await buildOpencodeBundles();
}, 120_000);
afterAll(() => built.cleanup());
afterEach(() => {
  for (const { run } of runs.splice(0)) run.cleanup();
});

const planned = <T extends { model: string }>(requests: T[]) =>
  requests.filter((q) => q.model === PLANNED_MODEL);

describe.skipIf(unavailable !== undefined)("a continued turn in OpenCode", () => {
  it("serve: a continued turn whose edit flips a check before its idle ends silent", {
    timeout: 180_000,
  }, async () => {
    const release = join(tempDir("squeal-oc-continued-"), "release");
    const result = await squealOpenCode({
      dist: built.dir,
      timeoutMs: 120_000,
      mode: "serve",
      prompt: "edit",
      plan: [
        { text: "done", delayMs: 1_500 },
        { text: "fixed", release },
        { text: "noted" },
        { text: "extra" },
      ],
      // Turn 1's regression is known before its idle: the turn is continued.
      onRegistered: (r) => r.apply(r.fail()),
      afterReply: async (live, r) => {
        await expect.poll(() => planned(live.requests).length, { timeout: 30_000 }).toBe(2);
        // The continuation's edit and its re-run land before the continued turn's idle.
        r.queue("k2");
        r.apply(r.pass());
        writeFileSync(release, "");
        await sleep(QUIET_MS);
        expect(planned(live.requests)).toHaveLength(2);
        await live.message(NEXT);
      },
    });
    runs.push(result);
    const requests = planned(result.run.requests);
    expect(requests).toHaveLength(3);
    expect(textOf(requests[1]?.messages.at(-1))).toContain("PASS -> FAIL");
    const next = textOf(requests[2]?.messages.at(-1));
    expect(next).toContain(NEXT);
    expect(next).toContain("FAIL -> PASS");
  });
});
