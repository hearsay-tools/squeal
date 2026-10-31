import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLANNED_MODEL } from "../fixtures/opencode/scripted-provider.js";
import { opencodeUnavailable } from "../helpers/opencode.js";
import { buildOpencodeBundles } from "./opencode/helpers.js";
import { squealOpenCode } from "./opencode/real.js";

/*
 * Row 011-287 (`research/ci-opencode-continued.md` section 3): when a test's
 * `afterReply` fails under `serve`, the error it throws carries what decides
 * the cause, read before OpenCode is stopped and its directory removed: the
 * provider's requests, OpenCode's stderr, and the store's consumer, turn,
 * view and known state. The error stays the test's own, so its assertion,
 * diff and stack are unchanged.
 */

const unavailable = opencodeUnavailable();
if (unavailable && process.env.CI)
  throw new Error(`OpenCode fixture unavailable on CI: ${unavailable}`);

let built = { dir: "", cleanup: () => {} };
beforeAll(async () => {
  built = await buildOpencodeBundles();
}, 120_000);
afterAll(() => built.cleanup());

describe.skipIf(unavailable !== undefined)("a failed afterReply under serve", () => {
  it("throws its own error with the run's evidence, and the run's directory is removed", {
    timeout: 120_000,
  }, async () => {
    const thrown = new Error("afterReply failed on purpose");
    let dir = "";
    const run = squealOpenCode({
      dist: built.dir,
      timeoutMs: 90_000,
      mode: "serve",
      prompt: "edit",
      // As in `opencode-continued.test.ts`: the failure is known before the first reply ends.
      plan: [{ text: "done", delayMs: 1_500 }],
      onRegistered: (r) => r.apply(r.fail()),
      afterReply: async (_live, r) => {
        dir = dirname(r.root);
        throw thrown;
      },
    });
    const error = await run.then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBe(thrown);
    const message = thrown.message;
    expect(message).toMatch(/^afterReply failed on purpose\n/);
    expect(message).toMatch(/model requests: 1 planned, \d+ in all/);
    expect(message).toMatch(
      new RegExp(`\\d\\. ${PLANNED_MODEL} #0, last user \\(\\d+ chars\\): "edit`),
    );
    expect(message).toMatch(/OpenCode stderr \(\d+ chars\):/);
    expect(message).toMatch(/consumer ses_\S+\/main: registered at \d+/);
    expect(message).toMatch(/turn: \{"turn":"(idle|in-turn)"/);
    expect(message).toMatch(/view: .+ (pass|fail) told at \d+/);
    expect(message).toMatch(/state: .+ fail current/);
    expect(dir).not.toBe("");
    expect(existsSync(dir)).toBe(false);
  });
});
