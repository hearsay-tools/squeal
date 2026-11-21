import { describe, expect, it } from "vitest";
import {
  COMMIT_IDLE_EXIT_MS,
  COMMIT_MAX_LIFE_MS,
  type CommitLife,
  type CommitWork,
  type CommitWorktrees,
  commitCheck,
  commitModeOf,
  commitPolicy,
  NO_COMMIT_WORKTREES,
  removesAtExit,
} from "../../src/core/daemon/commit-mode.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";

/* Spec 023 D7.2 (row 023-39): the commit daemon's mode, its idle period and its cap. */

const ROOT = "/tmp/commit-tree" as AbsolutePath;
const START = 1_000_000 as EpochMs;
const MINUTE = 60_000;

function marked(marker: unknown): CommitWorktrees {
  return { ...NO_COMMIT_WORKTREES, read: () => marker };
}

describe("which daemon runs in commit mode (D7.2)", () => {
  it("a worktree with a commit marker does; one without does not", () => {
    expect(commitModeOf({ commitWorktrees: marked({ commit: "abc" }) }, ROOT)).not.toBeNull();
    expect(commitModeOf({ commitWorktrees: marked(null) }, ROOT)).toBeNull();
    expect(commitModeOf({}, ROOT)).toBeNull();
  });

  it("the explicit option wins over the marker, both ways", () => {
    expect(commitModeOf({ commitMode: true }, ROOT)).not.toBeNull();
    expect(
      commitModeOf({ commitMode: false, commitWorktrees: marked({ commit: "abc" }) }, ROOT),
    ).toBeNull();
  });

  it("lives 10 minutes idle and 3 hours at most, unless a test sets other times", () => {
    expect(commitModeOf({ commitMode: true }, ROOT)).toMatchObject({
      idleMs: 10 * MINUTE,
      maxLifeMs: 3 * 60 * MINUTE,
    });
    expect(
      commitModeOf({ commitMode: true, commitTimes: { idleMs: 5, maxLifeMs: 9 } }, ROOT),
    ).toMatchObject({ idleMs: 5, maxLifeMs: 9 });
  });
});

describe("a commit daemon's policy (D7.2, D7.1)", () => {
  it("starts lookup-only whatever the file says", () => {
    const file = { ...DEFAULT_POLICY, baseline: { onStart: "lookup-then-run-missing" as const } };
    expect(commitPolicy(file).baseline.onStart).toBe("lookup-only");
  });

  it("keeps every other key, so its result keys equal D2's (coverage needs complexity on)", () => {
    const file = {
      ...DEFAULT_POLICY,
      baseline: { onStart: "lookup-then-run-missing" as const },
      lint: { ...DEFAULT_POLICY.lint, enabled: true },
    };
    const { baseline: _mode, ...rest } = commitPolicy(file);
    const { baseline: _file, ...expected } = file;
    expect(rest).toEqual(expected);
    expect(commitPolicy(DEFAULT_POLICY)).toBe(DEFAULT_POLICY);
  });
});

describe("removal at exit (D7.2)", () => {
  it("every exit removes the worktree but a step-down, whose successor serves the same tree", () => {
    for (const reason of ["idle", "lifetime-cap", "stop-requested", "signal"] as const) {
      expect(removesAtExit(reason)).toBe(true);
    }
    expect(removesAtExit("superseded")).toBe(false);
  });
});

describe("a commit daemon's lifecycle check (D7.2)", () => {
  function life(work: CommitWork | null = { queued: 0, running: 0 }): CommitLife {
    const mode = commitModeOf({ commitMode: true }, ROOT);
    if (mode === null) throw new Error("no commit mode");
    return { mode, startedAt: START, work: () => work };
  }
  function check(l: CommitLife, at: number, lastActive: number) {
    let active = lastActive;
    const exit = commitCheck(
      l,
      at as EpochMs,
      () => active as EpochMs,
      (t) => {
        active = t;
      },
    );
    return { exit, active };
  }

  it("exits 10 minutes after its last activity, not before", () => {
    const quiet = life();
    expect(check(quiet, START + COMMIT_IDLE_EXIT_MS - 1, START).exit).toBeNull();
    expect(check(quiet, START + COMMIT_IDLE_EXIT_MS, START).exit?.reason).toBe("idle");
  });

  it("a queued file is activity: a queue waiting for a pool permit keeps the daemon (open question 4)", () => {
    const at = START + 2 * COMMIT_IDLE_EXIT_MS;
    const { exit, active } = check(life({ queued: 3, running: 0 }), at, START);
    expect(exit).toBeNull();
    expect(active).toBe(at);
  });

  it("a running tier is activity", () => {
    const at = START + 2 * COMMIT_IDLE_EXIT_MS;
    expect(check(life({ queued: 0, running: 1 }), at, START)).toEqual({ exit: null, active: at });
  });

  it("before the scheduler started, only the time since the last activity counts", () => {
    expect(check(life(null), START + COMMIT_IDLE_EXIT_MS, START).exit?.reason).toBe("idle");
  });

  it("exits at the cap 3 hours after its start, even with work queued and fresh activity", () => {
    const busy = life({ queued: 5, running: 1 });
    const cap = START + COMMIT_MAX_LIFE_MS;
    expect(check(busy, cap - 1, cap - 1).exit).toBeNull();
    const { exit } = check(busy, cap, cap);
    expect(exit?.reason).toBe("lifetime-cap");
    expect(exit?.text).toContain("3 h");
  });
});
