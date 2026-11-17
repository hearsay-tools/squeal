import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import type { Life } from "../../src/core/daemon/terminate.js";
import { markRest } from "../../src/core/presence/events.js";
import { DAEMON_START_GRACE_MS, DAEMON_START_SLOW_MS } from "../../src/core/presence/heartbeat.js";
import { lockFileFor } from "../../src/core/store/paths.js";
import { utcTimeText } from "../../src/core/text.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/common.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { recorded, squealRepo } from "./helpers.js";
import { holdStart, newWorktree, T, text } from "./starting-fixture.js";

/*
 * Row 005-111 (005-108's open point): a daemon stopped (SIGSTOP) while it holds the lock and its
 * start mark, not registered, read as a slow start: starting, then "still starting" at 60 s, with
 * no end. Driven through the production Claude Code hooks with an injected process-state reader:
 * `lifeOf` answers as the real one, with the state `stoppedPids` says.
 */

const stoppedPids = new Set<number>();

vi.mock("../../src/core/daemon/terminate.js", async (real) => {
  const actual = await real<typeof import("../../src/core/daemon/terminate.js")>();
  return {
    ...actual,
    lifeOf: (pid: number): Life | null => {
      const life = actual.lifeOf(pid);
      return life === null ? null : { ...life, stopped: stoppedPids.has(pid) };
    },
  };
});

const realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
afterEach(() => {
  stoppedPids.clear();
  if (realPlatform !== undefined) Object.defineProperty(process, "platform", realPlatform);
});

const since = utcTimeText(T + 1_000);
// `squeal status` keeps its neighbours' ISO time.
const sinceIso = new Date(T + 1_000).toISOString();
const AFTER_GRACE = DAEMON_START_GRACE_MS + 1_000;
const STOPPED =
  "SQUEAL · a starting daemon may be stopped at revision 0\n" +
  `Revision 0: A daemon has been starting since ${since}, and it may be stopped: no results ` +
  "come until it runs again, and Squeal has no results in this worktree yet.";
const SLOW =
  "SQUEAL · a daemon is still starting at revision 0\n" +
  `Revision 0: A daemon has been starting since ${since}, ` +
  "and Squeal has no results in this worktree yet.";

describe("a starting daemon whose process is stopped (row 005-111)", () => {
  it("is said once, at the first boundary that sees it stopped, with its start's time", async () => {
    const { batch, spawns, lockFile } = await newWorktree();
    holdStart(lockFile, 1_000);

    const running = await batch(2_000);
    stoppedPids.add(process.pid);
    const said = [];
    // Within the spawn's grace the told start reads no marks (review 0.1.403-r2 B2): nothing yet.
    for (const ms of [5_000, AFTER_GRACE, 20_000, DAEMON_START_SLOW_MS + 5_000, 5 * 60_000])
      said.push(await batch(ms));

    expect(running).toBe("");
    expect(said).toEqual(["", STOPPED, "", "", ""]);
    expect(said[1]).not.toContain("start`");
    expect(said[1]).not.toContain(String(process.pid));
    // The evals read it as no daemon validating (`NO_DAEMON`).
    expect(squealEvidence(said[1] ?? "", "push")?.daemon).toBe(false);
    expect(squealEvidence((said[1] ?? "").split("\n")[0] ?? "", "push")?.daemon).toBe(false);
    // 005-108's rule holds: no hook spawns a second daemon while it holds the lock.
    expect(spawns).toEqual([0]);
  });

  it("leaves no notice once it continues: the slow start follows as it would", async () => {
    const { batch, lockFile } = await newWorktree();
    holdStart(lockFile, 1_000);
    stoppedPids.add(process.pid);

    const stopped = await batch(AFTER_GRACE);
    stoppedPids.clear();
    const continued = [await batch(AFTER_GRACE + 5_000), await batch(30_000)];
    const slow = await batch(1_000 + DAEMON_START_SLOW_MS + 1_000);

    expect(stopped).toBe(STOPPED);
    expect(continued).toEqual(["", ""]);
    expect(slow).toBe(SLOW);
  });

  it("agrees at Stop and in squeal status: may be stopped, since its start, no `squeal start`", async () => {
    const { stop, status, lockFile } = await newWorktree();
    holdStart(lockFile, 1_000);
    stoppedPids.add(process.pid);

    const atStop = await stop(AFTER_GRACE);
    const statusText = status(AFTER_GRACE);

    expect(atStop.trimEnd()).toBe(STOPPED);
    expect(statusText).toContain(
      `a daemon has been starting since ${sinceIso}, and it may be stopped`,
    );
    expect(statusText).not.toContain("start` starts one");
  });
});

describe("a starting daemon whose process runs (row 005-111: as before)", () => {
  it("is no news until DAEMON_START_SLOW_MS, then still starting, once", async () => {
    const { batch, lockFile } = await newWorktree();
    holdStart(lockFile, 1_000);

    const before = [await batch(5_000), await batch(30_000)];
    const slow = await batch(1_000 + DAEMON_START_SLOW_MS + 1_000);

    expect(before).toEqual(["", ""]);
    expect(slow).toBe(SLOW);
    expect(await batch(DAEMON_START_SLOW_MS + 20_000)).toBe("");
  });
});

describe("a stopped starting daemon off Linux (row 005-111: no state read, as before)", () => {
  it("reads as a slow start", async () => {
    const { batch, lockFile } = await newWorktree();
    holdStart(lockFile, 1_000);
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    stoppedPids.add(process.pid);

    const before = await batch(5_000);
    const slow = await batch(1_000 + DAEMON_START_SLOW_MS + 1_000);

    expect(before).toBe("");
    expect(slow).toBe(SLOW);
  });
});

/**
 * Review 0.1.551 B1: a worktree whose daemon heartbeat last at `T`, cleared its record and rested
 * at `T + 500`; a session registered then. No hook spawns here, so no spawn mark follows the rest.
 */
async function restedWorktree() {
  const r = squealRepo();
  r.daemon("stale", T);
  r.store.worktrees.setDaemon(r.worktreeId, null);
  markRest(r.store, r.worktreeId, (T + 500) as EpochMs);
  let clock = T + 500;
  const spawns: number[] = [];
  const deps: HookDeps = {
    env: {},
    now: () => clock,
    ensureDaemon: async () => {
      spawns.push(clock - T);
      return "unavailable";
    },
  };
  await runHook("session-start", recorded("session-start", r.root), deps);
  const lockFile = lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId);
  mkdirSync(dirname(lockFile), { recursive: true });
  const batch = async (ms: number) => {
    clock = T + ms;
    return text(await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps));
  };
  return { batch, lockFile, spawns };
}

describe("a start after the last daemon rested (review 0.1.551 B1)", () => {
  it("is said once when its process is stopped, not hidden as a quiet rest", async () => {
    const { batch, lockFile, spawns } = await restedWorktree();
    holdStart(lockFile, 1_000);
    stoppedPids.add(process.pid);

    const said = [await batch(11_000), await batch(20_000)];

    expect(said[0]).toContain(
      `A daemon has been starting since ${since}, and it may be stopped: no results come until it runs again`,
    );
    expect(said[0]).not.toContain("start`");
    expect(said[1]).toBe("");
    // 005-108's rule: no hook spawns while the start mark names a live process.
    expect(spawns.filter((ms) => ms >= 1_000)).toEqual([]);
  });

  it("stays quiet while its process runs, as before", async () => {
    const { batch, lockFile } = await restedWorktree();
    holdStart(lockFile, 1_000);

    expect([await batch(11_000), await batch(20_000)]).toEqual(["", ""]);
  });
});
