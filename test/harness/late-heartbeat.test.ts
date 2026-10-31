import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { markStopped } from "../../src/core/delivery/stopped.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { lockFileFor } from "../../src/core/store/index.js";
import {
  type AbsolutePath,
  daemonExitMetaKey,
  daemonIncarnation,
  type EpochMs,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 011-276 (gh-109, gh-128; the human, 2026-10-30: wording only): a
 * heartbeat past grace whose record no shutdown cleared, while its daemon
 * holds the lock, reads as late, with its age, in the hook, in status text
 * and in status JSON; "stopped" or "no daemon" only with a recorded stop or
 * exit. Recovery says what changed. The real SIGSTOP is `hung-daemon.test.ts`.
 */

const T = Date.now() as EpochMs;
const LAST = (T - 20_000) as EpochMs;
const ISO = new Date(LAST).toISOString();
const DETAIL = `the last one was 20 s ago, at ${ISO}; the daemon may be busy or stopped`;
const EDIT = { tool_calls: [{ tool_name: "Edit", tool_input: {}, tool_use_id: "toolu_01A" }] };
const READ = { tool_calls: [{ tool_name: "Read", tool_input: {}, tool_use_id: "toolu_01B" }] };

const context = (out: HookResult): string =>
  out.stdout === ""
    ? ""
    : (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext;

/** A hook whose ensure finds the daemon holding the lock and not answering (lessons, defect 22). */
const hung: HookDeps = {
  env: {},
  cli: "/plugin/dist/cli/squeal.mjs",
  now: () => T,
  ensureDaemon: async () => "unavailable",
};

async function registered(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  await runHook("session-start", recorded("session-start", r.root), {
    env: {},
    ensureDaemon: async () => "alive",
  });
  return r;
}

/** The worktree's daemon lock, held as a live daemon holds it, or taken and let go. */
function lock(r: SquealRepo) {
  const file = lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId);
  const held = acquireDaemonLock(file);
  if (held === null) throw new Error("the lock is taken");
  return held;
}

function status(r: SquealRepo) {
  const result = readStatus(r.root as AbsolutePath, { now: () => T });
  if (!result.available) throw new Error("status unavailable");
  return { json: result.daemon, text: formatStatus(result, T, "squeal", { full: true }) };
}

describe("a late heartbeat (row 011-276)", () => {
  it("reads late with its age in the hook, status text and JSON, never stopped", async () => {
    const r = await registered();
    r.daemon("stale", LAST);
    const held = lock(r);
    try {
      const hook = context(
        await runHook("post-tool-batch", recorded("post-tool-batch", r.root, EDIT), hung),
      );
      const { json, text } = status(r);

      expect(hook).toBe(
        "SQUEAL · the daemon's heartbeat is late at revision 1\n" +
          "Revision 1 (changed src/math.ts): no check pending, stale or unknown. " +
          `The daemon's heartbeat is late: ${DETAIL}; results are as of revision 1.\n` +
          `Not validated: the daemon's heartbeat is late: ${DETAIL}; any change this call made has no result until it validates again.`,
      );
      expect(json).toEqual({ state: "down", since: LAST, heartbeatLate: { ageMs: 20_000 } });
      expect(text).toContain(`Daemon: heartbeat late: ${DETAIL}`);
      expect(text).toContain(
        `  the daemon's heartbeat is late: ${DETAIL}; results are as of revision 1; \`squeal start\` starts one once it has exited`,
      );
      expect(text).toContain("dirty state not known: the daemon's heartbeat is late");
      for (const said of [hook, text]) {
        expect(said).not.toMatch(/no daemon|stopped by request|died/i);
        // The evals read a late heartbeat as Squeal not answering, as they read the old words.
        expect(squealEvidence(said, "pull")).toMatchObject({ daemon: false });
      }
    } finally {
      held.release();
    }
  });

  it("says what changed when the heartbeat is current again, and late no more", async () => {
    const r = await registered();
    r.daemon("stale", LAST);
    const held = lock(r);
    try {
      await runHook("post-tool-batch", recorded("post-tool-batch", r.root, READ), hung);
      r.daemon("alive");

      const hook = context(
        await runHook("post-tool-batch", recorded("post-tool-batch", r.root, READ), hung),
      );
      const { json, text } = status(r);

      expect(hook).toBe(
        "SQUEAL · a daemon is validating again at revision 1: its heartbeat is current\n" +
          "Revision 1 (changed src/math.ts): no check pending, stale or unknown.",
      );
      expect(json).toEqual({ state: "alive", lastHeartbeatAt: expect.any(Number) });
      expect(text).toMatch(/^Daemon: running, last heartbeat \d+ s ago$/m);
      expect(`${hook}\n${text}`).not.toContain("late");
    } finally {
      held.release();
    }
  });
});

describe("a recorded stop or exit is not a late heartbeat (row 011-276)", () => {
  it("a stop by request reads stopped, with the record still stale", async () => {
    const r = await registered();
    r.daemon("stale", LAST);
    r.store.transaction(() =>
      markStopped(r.store, r.worktreeId as WorktreeId, (LAST + 1) as EpochMs, null),
    );
    const held = lock(r);
    try {
      const hook = context(
        await runHook("post-tool-batch", recorded("post-tool-batch", r.root, READ), hung),
      );
      const { json, text } = status(r);

      expect(hook).toMatch(/^SQUEAL · the daemon is stopped by request at revision 1\n/);
      expect(json).toEqual({ state: "down", since: LAST, stopped: true });
      expect(text).toContain("Daemon: stopped by request (`squeal stop`)");
      expect(`${hook}\n${text}`).not.toContain("late");
    } finally {
      held.release();
    }
  });

  it("an exit that cleared the record reads as no daemon since its last heartbeat", async () => {
    const r = await registered();
    r.daemon("stale", LAST);
    r.store.worktrees.setDaemon(r.worktreeId as WorktreeId, null);

    const hook = context(
      await runHook("post-tool-batch", recorded("post-tool-batch", r.root, EDIT), hung),
    );
    const { json, text } = status(r);

    expect(hook).toBe(
      "SQUEAL · no daemon is validating at revision 1\n" +
        "Revision 1 (changed src/math.ts): no check pending, stale or unknown. " +
        `No daemon has validated since ${ISO}; results are as of revision 1.\n` +
        `Not validated: no daemon has validated since ${ISO}; any change this call made has no result.`,
    );
    expect(json).toEqual({ state: "down", since: LAST });
    expect(text).toContain(`Daemon: no daemon running since ${ISO}`);
    expect(`${hook}\n${text}`).not.toContain("late");
  });

  it("an exit its shutdown marked, the record not yet cleared, is no late heartbeat", async () => {
    const r = await registered();
    r.store.worktrees.setDaemon(r.worktreeId as WorktreeId, {
      socketPath: "/tmp/squeal-test-late.sock" as AbsolutePath,
      startedAt: 1 as EpochMs,
      heartbeatAt: LAST,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
      token: "t1",
    });
    const record = r.store.worktrees.get(r.worktreeId as WorktreeId)?.daemon;
    if (record === null || record === undefined) throw new Error("no record");
    r.store.meta.set(
      daemonExitMetaKey(r.worktreeId as WorktreeId),
      daemonIncarnation(record) ?? "",
    );
    lock(r).release();

    const hook = context(
      await runHook("post-tool-batch", recorded("post-tool-batch", r.root, READ), hung),
    );
    const { json, text } = status(r);

    expect(json).toEqual({ state: "down", since: LAST });
    expect(hook).toMatch(/^SQUEAL · no daemon is validating at revision 1\n/);
    expect(`${hook}\n${text}`).not.toContain("late");
  });

  it("a death, its lock free and no shutdown recorded, names the death and no lateness", async () => {
    const r = await registered();
    r.daemon("stale", LAST);
    lock(r).release();

    const hook = context(
      await runHook("post-tool-batch", recorded("post-tool-batch", r.root, READ), hung),
    );
    const { json, text } = status(r);

    expect(json).toEqual({ state: "down", since: LAST, died: { runs: [] } });
    expect(hook).toMatch(/^SQUEAL · no daemon is validating at revision 1\n/);
    expect(hook).toContain("The last daemon died without shutting down, between runs.");
    expect(text).toContain(`Daemon: no daemon running since ${ISO}; it died without shutting down`);
    expect(`${hook}\n${text}`).not.toContain("late");
  });
});
