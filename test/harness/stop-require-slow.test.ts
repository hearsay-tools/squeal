import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type TestFileRef } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { codexRecorded } from "./codex/helpers.js";
import { FILE, recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Spec 004 D7: with `stop.requireSlowSuite` on, a main agent's Stop blocks
 * while a slow test file is not current at this revision, naming the files
 * and that `squeal run --slow` runs them; it still never waits for them
 * (D9). Off, the default, slow files never hold a Stop. Both harnesses run
 * the shared Stop path.
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const SLOW_FILE: TestFileRef = { project: "", path: "test/e2e/slow.test.ts" };
const WAIT_MS = 1_000;

interface Harness {
  readonly name: string;
  startTurn(r: SquealRepo): Promise<void>;
  stop(r: SquealRepo): Promise<{ readonly stdout: string }>;
}

const HARNESSES: readonly Harness[] = [
  {
    name: "claude-code",
    async startTurn(r) {
      await runHook("session-start", recorded("session-start", r.root), deps);
      await runHook("user-prompt-submit", recorded("user-prompt-submit", r.root), deps);
    },
    stop: (r) => runHook("stop", recorded("stop", r.root), deps),
  },
  {
    name: "codex",
    async startTurn(r) {
      await runCodexHook("session-start", codexRecorded("exec", "session-start", r.root), deps);
      await runCodexHook(
        "user-prompt-submit",
        codexRecorded("exec", "user-prompt-submit", r.root),
        deps,
      );
    },
    stop: (r) => runCodexHook("stop", codexRecorded("exec", "stop", r.root), deps),
  },
];

/** `math > adds` passes; `include` marks slow files; the agent is in a turn. */
async function repo(harness: Harness, include: readonly string[], require: boolean) {
  const r = squealRepo();
  r.apply(r.pass());
  r.policy({
    slow: { ...DEFAULT_POLICY.slow, include },
    stop: { waitMs: WAIT_MS, requireSlowSuite: require },
  });
  await harness.startTurn(r);
  return r;
}

function slowKey(r: SquealRepo, pending: "queued" | null): void {
  const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
  r.store.testFileKeys.upsertMany([
    { worktreeId: r.worktreeId, testFile: SLOW_FILE, key: "slow1", revision, pending },
  ]);
}

function decision(stdout: string): { decision?: string; reason?: string } {
  return stdout.trim() === "" ? {} : (JSON.parse(stdout) as { decision?: string });
}

describe.each(HARNESSES)("stop.requireSlowSuite, $name (spec 004 D7)", (harness) => {
  it.each<"queued" | null>(["queued", null])(
    "on: blocks at once while a slow file is not current (%s), naming it and run --slow",
    async (pending) => {
      const r = await repo(harness, [SLOW_FILE.path], true);
      slowKey(r, pending);
      const started = performance.now();
      const out = decision((await harness.stop(r)).stdout);
      expect(performance.now() - started).toBeLessThan(WAIT_MS / 2);
      expect(out.decision).toBe("block");
      expect(out.reason).toMatch(
        /^Squeal policy stop.requireSlowSuite is on and 1 slow test file is not current at revision 1: test\/e2e\/slow.test.ts. `.*squeal.* run --slow` runs them.\n\n/,
      );
    },
  );

  it("on: lets the Stop end when every slow file is current", async () => {
    const r = await repo(harness, [FILE.path], true);
    expect(decision((await harness.stop(r)).stdout).decision).toBeUndefined();
  });

  it("off: a slow file not current never holds the Stop", async () => {
    const r = await repo(harness, [SLOW_FILE.path], false);
    slowKey(r, "queued");
    expect(decision((await harness.stop(r)).stdout).decision).toBeUndefined();
  });
});
