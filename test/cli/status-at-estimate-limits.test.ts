import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  estimateSide,
  oneGroup,
  readPoolView,
  sideText,
  type WorkGroup,
  widthsOf,
} from "../../src/cli/status-at-estimate.js";
import { workGroups } from "../../src/cli/status-at-estimate-groups.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";

/*
 * Review 0.1.599 B3 (row 023-49, V2): the estimate's width is the one the
 * daemon runs at. A group with `maxParallel: 1` ran one file while the
 * estimate used its pool share of 4 and said 30 s for 120 s of serial work;
 * a project capped at one slot was estimated 4 wide. Review 0.1.599 N1: a
 * measured rate of short files said "about 1 s" with a 600 s file left.
 */

const files = (n: number, seconds: number | null) => Array.from({ length: n }, () => seconds);
const group = (over: Partial<WorkGroup> & Pick<WorkGroup, "seconds">): WorkGroup => ({
  cap: null,
  perFile: 1,
  shared: [],
  ...over,
});

describe("the estimate at the daemon's limits (review 0.1.599 B3)", () => {
  it("runs a serial group's files one after another, whatever the pool share", () => {
    const serial = { groups: [group({ seconds: files(12, 10), cap: 1 })], measured: null };
    const e = estimateSide(serial, 4, null);
    expect(e).toMatchObject({ files: 12, width: 1, seconds: 120, basis: "durations" });
    // More host slots do not widen it.
    expect(estimateSide(serial, 16, null)).toMatchObject({ width: 1, seconds: 120 });
    expect(e === null ? "" : sideText(e)).toBe(
      "about 2 min for 12 test files, up to 1 at once, from their stored durations",
    );
  });

  it("runs groups beside each other: the longer of the pool's work and each group's own time", () => {
    const groups = [group({ seconds: files(8, 10) }), group({ seconds: files(3, 10), cap: 1 })];
    // Pool: 110 s over 4 is 27.5 s; the serial group alone takes 30 s.
    expect(estimateSide({ groups, measured: null }, 4, null)).toMatchObject({
      files: 11,
      width: 4,
      seconds: 30,
    });
    // A file that takes two workers halves the group's width at the same share.
    const two = [group({ seconds: files(8, 10), perFile: 2 })];
    expect(estimateSide({ groups: two, measured: null }, 4, null)).toMatchObject({
      width: 2,
      seconds: 40,
    });
  });

  it("counts the other side's files of a shared maxParallel slot", () => {
    const own = group({ seconds: files(4, 10), cap: 2, shared: files(4, 10) });
    expect(estimateSide({ groups: [own], measured: null }, 8, null)).toMatchObject({
      width: 2,
      seconds: 40,
    });
  });

  it("shares a capped project's slots among this call's two daemons", () => {
    const runtime = mkdtempSync(join(tmpdir(), "squeal-pool-")) as AbsolutePath;
    try {
      const repository = join(runtime, "repo") as AbsolutePath;
      const config = join(runtime, "config");
      mkdirSync(join(config, "squeal"), { recursive: true });
      const capacity = { hostSlots: 8, projects: { [repository]: { slots: 1 } } };
      writeFileSync(join(config, "squeal", "config.json"), JSON.stringify({ capacity }));
      const env = { XDG_RUNTIME_DIR: runtime, XDG_CONFIG_HOME: config, HOME: runtime };
      const sides = [
        { id: "commit-tree", want: 100 },
        { id: "worktree", want: 100 },
      ];
      expect(widthsOf(readPoolView(env, [], repository), sides)).toEqual([1, 1]);
      // Without the cap's repository, the two share the host's 8.
      expect(widthsOf(readPoolView(env, []), sides)).toEqual([4, 4]);
    } finally {
      rmSync(runtime, { recursive: true, force: true });
    }
  });

  it("N1: a measured rate is never below the longest file still to run", () => {
    const work = { groups: [oneGroup([600])], measured: { done: 10, ms: 10_000 } };
    expect(estimateSide(work, 4, null)).toMatchObject({ basis: "measured", seconds: 600 });
  });

  it("says when a side's group limits were not read", () => {
    const e = estimateSide(
      { groups: [oneGroup(files(4, 10))], measured: null, limitsUnknown: true },
      4,
      null,
    );
    expect(e).toMatchObject({ limits: "unknown" });
    expect(e === null ? "" : sideText(e)).toBe(
      "about 10 s for 4 test files, up to 4 at once (its group limits not read), from their stored durations",
    );
  });
});

describe("each side's files by group, at its policy's limits (review 0.1.599 B3)", () => {
  const ref = (path: string): TestFileRef => ({ project: "", path: path as never });
  const tree = (config: object) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-groups-"))) as AbsolutePath;
    writeFileSync(join(dir, "squeal.config.json"), JSON.stringify(config));
    return dir;
  };
  const browser = {
    checks: [
      {
        name: "browser",
        runner: "vitest",
        tests: ["test/browser/**"],
        at: "manual",
        limits: { maxParallel: 1 },
      },
    ],
  };

  it("caps a maxParallel group, shares its slot with the other side, and leaves the tests group to the pool", () => {
    const at = tree(browser);
    const now = tree(browser);
    try {
      const b = [ref("test/browser/a.test.ts"), ref("test/browser/b.test.ts")];
      const unit = ref("test/unit.test.ts");
      const { groups, unknown } = workGroups(
        [
          { root: at, files: [...b, unit] },
          { root: now, files: [b[0] as TestFileRef] },
        ],
        () => 10,
      );
      expect(unknown).toEqual([false, false]);
      const [commit, worktree] = groups;
      const byCap = (gs: readonly WorkGroup[] | undefined) =>
        (gs ?? []).map((g) => ({ cap: g.cap, files: g.seconds.length, shared: g.shared.length }));
      expect(byCap(commit)).toEqual(
        expect.arrayContaining([
          { cap: 1, files: 2, shared: 1 },
          { cap: null, files: 1, shared: 0 },
        ]),
      );
      expect(byCap(worktree)).toEqual([{ cap: 1, files: 1, shared: 2 }]);
      // The commit side: 2 serial files plus the other side's 1 on the same slot: 30 s.
      expect(estimateSide({ groups: commit ?? [], measured: null }, 8, null)).toMatchObject({
        width: 2,
        seconds: 30,
      });
    } finally {
      rmSync(at, { recursive: true, force: true });
      rmSync(now, { recursive: true, force: true });
    }
  });

  it("marks a side whose tree is gone: its limits are not known", () => {
    const { groups, unknown } = workGroups(
      [{ root: "/nonexistent/commit-tree" as AbsolutePath, files: [ref("test/a.test.ts")] }],
      () => 10,
    );
    expect(unknown).toEqual([true]);
    expect(groups[0]).toEqual([oneGroup([10])]);
  });
});
