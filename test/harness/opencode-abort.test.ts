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
 * Review 008-16 B2 with the real OpenCode 1.18.35, which does not await an
 * event callback before the next event: the first reply goes idle and its
 * Stop is slow; a new user message starts the next turn, which is then
 * aborted, while the old idle decision still waits. Its news must not start
 * a continuation. The Stop is a stand-in that answers news late; every other
 * bridge is the built one.
 */

const unavailable = opencodeUnavailable();
if (unavailable && process.env.CI)
  throw new Error(`OpenCode fixture unavailable on CI: ${unavailable}`);

const LATE = "SQUEAL late report";
/** How long the stand-in Stop takes, inside idle's 2 s at `stop.waitMs` 1,500. */
const STOP_MS = 1_200;
/** How long silence must hold after the abort. */
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

/** Replaces the built Stop bridge with one that marks its start and answers `LATE` after `STOP_MS`. */
function slowStop(): string {
  const started = join(tempDir("squeal-oc-stop-"), "started");
  writeFileSync(
    join(built.dir, "hooks", "stop.mjs"),
    `import { readFileSync, writeFileSync } from "node:fs";
readFileSync(0, "utf8");
writeFileSync(${JSON.stringify(started)}, "");
setTimeout(() => process.stdout.write(JSON.stringify({ answer: { report: ${JSON.stringify(LATE)} } })), ${STOP_MS});
`,
  );
  return started;
}

describe.skipIf(unavailable !== undefined)("an idle decision overtaken in OpenCode", () => {
  it("serve: a new message and an abort while Stop decides start no continuation", {
    timeout: 180_000,
  }, async () => {
    const started = slowStop();
    const result = await squealOpenCode({
      dist: built.dir,
      timeoutMs: 120_000,
      mode: "serve",
      prompt: "think",
      plan: [
        { text: "done" },
        { text: "second", delayMs: 10_000 },
        { text: "late" },
        { text: "late" },
      ],
      prepare: (r) => r.policy({ stop: { waitMs: 1_500 } }),
      afterReply: async (live, r) => {
        const planned = () => live.requests.filter((q) => q.model === PLANNED_MODEL);
        // The first reply's idle is deciding.
        await expect.poll(() => existsSync(started), { timeout: 30_000 }).toBe(true);
        const second = live.message("next").catch(() => {});
        await expect.poll(() => planned().length, { timeout: 30_000 }).toBe(2);
        const abort = await fetch(`${live.url}/session/${live.sessionID}/abort`, {
          method: "POST",
          headers: { "x-opencode-directory": r.root },
        });
        expect(abort.ok).toBe(true);
        await second;
        await sleep(STOP_MS + QUIET_MS);
      },
    });
    runs.push(result);
    const { run } = result;
    expect(run.requests.map((q) => textOf(q.messages.at(-1)))).not.toContain(LATE);
    expect(run.requests).toHaveLength(2);
  });
});
