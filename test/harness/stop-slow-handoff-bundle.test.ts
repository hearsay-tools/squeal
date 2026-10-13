import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeTurn } from "../../src/core/delivery/turn.js";
import { PLUGIN_DIST } from "../../src/harness/claude-code/build.js";
import { CODEX_PLUGIN_DIST } from "../../src/harness/codex/build.js";
import {
  STOP_SLOW_HANDOFF_MS,
  STOP_SLOW_HANDOFF_SLACK_MS,
} from "../../src/harness/shared/stop-slow.js";
import { tempDir } from "../store/helpers.js";
import { liveSocket, quietCli, runNode, runtimeDir } from "./bundle-helpers.js";
import { codexRecorded } from "./codex/helpers.js";
import { recorded, type SquealRepo } from "./helpers.js";
import {
  decision,
  HARNESSES,
  type Harness,
  landSlow,
  mainConsumer,
  repo,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Review wave 13bc S1 (task 001-332): 001-326's fix, on the committed
 * bundles in a fresh hook process. The waiting entry's handoff cutoff is its
 * process start less `STOP_SLOW_HANDOFF_SLACK_MS`, so a stall before the
 * bundle even loads, longer than any fixed cutoff from the check such as
 * `now() - 3000`, still takes the 2 s entry's handoff; one from more than
 * the slack before the process started does not.
 */

/** Longer than the 2 s slack and a 3 s cutoff from the check: the review's 4.1 s. */
const STALL_MS = 4_100;

/** Each harness's committed waiting-entry bundle and the Stop JSON it reads. */
const BUNDLE: Record<Harness["name"], { dist: string; stdin(r: SquealRepo): string }> = {
  "claude-code": { dist: PLUGIN_DIST, stdin: (r) => recorded("stop", r.root) },
  codex: { dist: CODEX_PLUGIN_DIST, stdin: (r) => codexRecorded("exec", "stop", r.root) },
};

/**
 * Runs `harness`'s committed `stop-slow.mjs` in a fresh Node process, blocked
 * `stallMs` by a preload before the bundle loads: after the process start,
 * as a loaded host stalls it. A live socket stands in for the daemon; HOME
 * is scratch, and a spawned CLI would only record that it ran.
 */
async function waitingBundle(harness: Harness, r: SquealRepo, stallMs = 0) {
  const env = {
    HOME: tempDir("squeal-home-"),
    XDG_RUNTIME_DIR: runtimeDir(),
    SQUEAL_CLI: quietCli().cli,
  };
  await liveSocket(join(env.XDG_RUNTIME_DIR, `squeal-${r.worktreeId}.sock`));
  const stall = `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${stallMs})`;
  const { dist, stdin } = BUNDLE[harness.name];
  const out = await runNode(
    [
      "--disable-warning=ExperimentalWarning",
      `--import=data:text/javascript,${encodeURIComponent(stall)}`,
      join(dist, "stop-slow.mjs"),
    ],
    stdin(r),
    env,
  );
  expect(out).toMatchObject({ stderr: "", code: 0 });
  return { ...decision(out), ms: out.ms };
}

describe.each(HARNESSES)("the bundled waiting Stop's handoff, $name (001-332)", (harness) => {
  it("a fresh process stalled past any fixed cutoff before it loads still takes the handoff and blocks", {
    timeout: 30_000,
  }, async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    expect(decision(await harness.stop(r))).toEqual({});
    landSlow(r, "fail");
    // No wait before the spawn: it would move the child's start, and its cutoff, past the handoff.
    const out = await waitingBundle(harness, r, STALL_MS);
    expect(out.ms).toBeGreaterThanOrEqual(STALL_MS);
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/ran at revision 1: 1 check fails: test\/e2e\/slow\.test\.ts/);
    expect(turnOf(r)).toBe("in-turn");
  });

  it("a handoff from more than the slack before the process started is stale: silent after the handoff wait", {
    timeout: 30_000,
  }, async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    const at = Date.now() - STOP_SLOW_HANDOFF_SLACK_MS - 500;
    r.store.transaction(() =>
      writeTurn(r.store, mainConsumer(r), {
        turn: "idle",
        testFiles: [],
        newTestFiles: false,
        handoff: { at },
      }),
    );
    landSlow(r, "fail");
    const out = await waitingBundle(harness, r);
    expect(out.decision).toBeUndefined();
    expect(out.ms).toBeGreaterThanOrEqual(STOP_SLOW_HANDOFF_MS);
    expect(turnOf(r)).toBe("idle");
  });
});
