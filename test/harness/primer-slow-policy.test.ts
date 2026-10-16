import { describe, expect, it } from "vitest";
import { bridgeDeps, register } from "../../src/harness/opencode/bridge.js";
import { startRun } from "../../src/harness/pi/run.js";
import { workerDeps } from "../../src/harness/pi/worker.js";
import { PRIMER_CAP_CHARS } from "../../src/harness/shared/primer.js";
import { SESSION } from "./helpers.js";
import { primerOf, repoFor, sessionStart } from "./primer-helpers.js";

/*
 * Spec 004 D8 as amended 2026-10-16 (task 004-62, issue #5): the primer
 * states this repository's `stop.requireSlowSuite`, since that is what the
 * agent's "done" requires. Off, no step before done: the slow tier is not
 * required, and a claim that slow tests pass needs the `Slow tier:` line
 * current. On, 001-283's step before done and Stop's wait. Read from
 * `squeal.config.json` through each harness's own entry, as each names the
 * CLI: `squeal`, the Codex path, Pi's and OpenCode's Node and path.
 */

const env = { env: {}, ensureDaemon: async () => "alive" as const };

const PRIMERS: Record<string, (root: string, r: ReturnType<typeof repoFor>) => Promise<string>> = {
  "claude-code": async (_root, r) => primerOf(await sessionStart(r, "claude-code")).primer,
  codex: async (_root, r) => primerOf(await sessionStart(r, "codex")).primer,
  pi: async (root) =>
    (
      await startRun(
        { sessionId: SESSION, cwd: root },
        { ...workerDeps(new URL("file:///pkg/dist/worker.mjs")), ...env },
      )
    ).primer ?? "",
  opencode: async (root) =>
    (
      await register(
        { kind: "register", consumer: { sessionId: SESSION }, worktree: root, pid: process.pid },
        {
          ...bridgeDeps(new URL("file:///pkg/dist/hooks/register.mjs"), {
            worktree: "/",
            pid: process.pid,
          }),
          ...env,
        },
      )
    ).primer ?? "",
};

async function primerUnder(harness: string, requireSlowSuite: boolean): Promise<string> {
  const r = repoFor({
    policy: { slow: { include: ["test/slow/**/*.test.ts"] }, stop: { requireSlowSuite } },
    files: [{ project: "", path: "test/slow/ledger.test.ts" }],
  });
  return (PRIMERS[harness] as (typeof PRIMERS)[string])(r.root, r);
}

describe("the primer states the slow-suite policy, in every harness (004-62)", () => {
  it.each(Object.keys(PRIMERS))("off: no step before done, under %s", async (harness) => {
    const text = await primerUnder(harness, false);
    expect(text).toContain("this repository does not require them before you finish");
    expect(text).toContain(
      "say slow tests pass only when the latest `Slow tier:` line states every slow file is current, else say how many are not;",
    );
    expect(text).toContain("run --slow --wait 60000` runs them now.");
    expect(text).not.toContain("before you say the task is done");
    expect(text).not.toContain("Stop");
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
  });

  it.each(Object.keys(PRIMERS))(
    "on: the step before done and Stop's wait, under %s",
    async (harness) => {
      const text = await primerUnder(harness, true);
      expect(text).toContain(
        "this repository requires them before you finish: before you say the task is done, run ",
      );
      expect(text).toContain(
        "run --slow --wait 60000` unless the latest `Slow tier:` line states every slow file is current; Stop waits for them or holds you once.",
      );
      expect(text).not.toContain("does not require");
      expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    },
  );
});
