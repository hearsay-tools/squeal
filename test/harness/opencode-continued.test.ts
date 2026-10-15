import { existsSync, writeFileSync } from "node:fs";
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
 * The same holds when the user aborts the continuation (review 008-32 B1):
 * barriers order it, no sleep decides the race. The continuation's reply is
 * held, the recovery is current, the abort reached the plugin's listener,
 * then the reply is released.
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

/**
 * Wraps the built plugin: once its event hook has handled a
 * `MessageAbortedError`, the returned file exists.
 */
function abortMarked(): { plugin: string; seen: string } {
  const dir = tempDir("squeal-oc-aborted-");
  const plugin = join(dir, "squeal.js");
  const seen = join(dir, "aborted");
  writeFileSync(
    plugin,
    `import { writeFileSync } from "node:fs";
import mod from ${JSON.stringify(join(built.dir, "plugin.mjs"))};
export const Squeal = async (input) => {
  const hooks = await mod.server(input);
  return {
    ...hooks,
    async event(arg) {
      await hooks.event?.(arg);
      if (arg.event.properties?.error?.name === "MessageAbortedError") writeFileSync(${JSON.stringify(seen)}, "");
    },
  };
};
`,
  );
  return { plugin, seen };
}

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

  it("serve: an aborted continuation whose check recovered ends silent (review 008-32 B1)", {
    timeout: 180_000,
  }, async () => {
    const release = join(tempDir("squeal-oc-continued-"), "release");
    const { plugin, seen } = abortMarked();
    const result = await squealOpenCode({
      dist: built.dir,
      plugin,
      timeoutMs: 120_000,
      mode: "serve",
      prompt: "edit",
      plan: [
        { text: "done", delayMs: 1_500 },
        { text: "fixed", release },
        { text: "noted" },
        { text: "extra" },
      ],
      prepare: (r) => r.policy({ stop: { waitMs: 1_500 } }),
      onRegistered: (r) => r.apply(r.fail()),
      afterReply: async (live, r) => {
        await expect.poll(() => planned(live.requests).length, { timeout: 30_000 }).toBe(2);
        r.queue("k2");
        r.apply(r.pass());
        const aborted = await fetch(`${live.url}/session/${live.sessionID}/abort`, {
          method: "POST",
          headers: { "x-opencode-directory": r.root },
        });
        expect(aborted.ok).toBe(true);
        await expect.poll(() => existsSync(seen), { timeout: 30_000 }).toBe(true);
        writeFileSync(release, "");
        await sleep(QUIET_MS);
        // At 5f425783 the re-armed wait delivered the recovery here, a second continuation.
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
