import { afterEach, describe, expect, it, vi } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import type { Life } from "../../src/core/daemon/terminate.js";
import { DAEMON_START_GRACE_MS, DAEMON_START_SLOW_MS } from "../../src/core/presence/heartbeat.js";
import { utcTimeText } from "../../src/core/text.js";
import { holdStart, newWorktree, T } from "./starting-fixture.js";

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
