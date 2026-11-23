import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupBatch } from "../../src/cli/status-at-call-run.js";
import {
  estimateLine,
  estimateSide,
  sideText,
  type WorkGroup,
} from "../../src/cli/status-at-estimate.js";
import { workGroups } from "../../src/cli/status-at-estimate-groups.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";

/*
 * Row 023-66 (dogfood round 8, V2): the call's rate is per group. Round 8
 * s1 told "about 11 min for 96 test files, at this call's rate there (14
 * results in 98 s)": the 14 were unit files, the 96 left were browser
 * files at 30 to 135 s each, one at a time, an hour or more.
 */

const files = (n: number, seconds: number | null) => Array.from({ length: n }, () => seconds);
const group = (over: Partial<WorkGroup> & Pick<WorkGroup, "seconds">): WorkGroup => ({
  cap: null,
  perFile: 1,
  shared: [],
  ...over,
});
const ROUND8 = { done: 14, ms: 98_000 };

describe("the call's rate per group (row 023-66, V2)", () => {
  it("gives the browser files no unit-rate time: round 8 s1", () => {
    // The unit group is done (14 results); the browser group has none and no stored duration.
    const browser = group({ seconds: files(96, null), cap: 1, name: "browser", done: 0 });
    const e = estimateSide({ groups: [browser], measured: ROUND8 }, 4, null);
    expect(e).toMatchObject({ files: 96, seconds: null, basis: "unknown", group: "browser" });
    const text = e === null ? "" : sideText(e);
    expect(text).toBe(
      "96 test files, time unknown: none has a stored duration and this call measured no rate for the browser group (0 of its 14 results there in 98 s were that group's)",
    );
    expect(text).not.toMatch(/about \d+ min/);
    // Before row 023-66: 96 × 98 s / 14 = 672 s, "about 11 min".
    expect(e?.seconds).not.toBe(672);
  });

  it("uses the browser group's stored durations when it has them, at its own width", () => {
    const browser = group({ seconds: files(96, 60), cap: 1, name: "browser", done: 0 });
    const e = estimateSide({ groups: [browser], measured: ROUND8 }, 4, null);
    expect(e).toMatchObject({ seconds: 96 * 60, basis: "durations", group: "browser" });
    expect(e === null ? "" : sideText(e)).toBe(
      "about 96 min for 96 test files, up to 1 at once, from their stored durations",
    );
  });

  it("keeps a group's own rate when it measured enough results there", () => {
    const tests = group({ seconds: files(100, null), name: "tests", done: 14 });
    const e = estimateSide({ groups: [tests], measured: ROUND8 }, 4, null);
    // The side's rate is the group's: the old text, unchanged.
    expect(e).toMatchObject({ seconds: 700, basis: "measured", rate: { done: 14, seconds: 98 } });
    expect(e?.group).toBeUndefined();
    expect(e === null ? "" : sideText(e)).toBe(
      "about 12 min for 100 test files, at this call's rate there (14 results in 98 s)",
    );
  });

  it("estimates each group alone when two remain, the side the longest, unknown if one is", () => {
    const tests = group({ seconds: files(20, null), name: "tests", done: 12 });
    const browser = group({ seconds: files(10, null), cap: 1, name: "browser", done: 2 });
    const measured = { done: 14, ms: 98_000 };
    const e = estimateSide({ groups: [tests, browser], measured }, 4, null);
    expect(e).toMatchObject({ files: 30, seconds: null, basis: "groups" });
    expect(e?.groups?.map((g) => [g.group, g.basis, g.seconds])).toEqual([
      ["tests", "measured", Math.ceil((20 * 98) / 12)],
      ["browser", "unknown", null],
    ]);
    expect(e === null ? "" : sideText(e)).toBe(
      "30 test files, time unknown, by group: tests: about 3 min for 20 test files, at this call's rate for the tests group (12 results in 98 s); browser: 10 test files, time unknown: none has a stored duration and this call measured no rate for the browser group (2 of its 14 results there in 98 s were that group's)",
    );
    // With stored browser durations: the side takes the longer group, 10 × 60 s one at a time.
    const known = { ...browser, seconds: files(10, 60) };
    const both = estimateSide({ groups: [tests, known], measured }, 4, null);
    expect(both).toMatchObject({ basis: "groups", seconds: 600 });
    expect(estimateLine({ commit: both, now: null }, "abc1234", null)).toContain(
      "Still to run, at abc1234: about 10 min for 30 test files, by group: tests: ",
    );
  });

  it("keeps the whole side's estimate when nothing was counted per group, or nothing measured", () => {
    const tests = group({ seconds: files(100, 2) });
    expect(estimateSide({ groups: [tests], measured: ROUND8 }, 4, null)).toMatchObject({
      basis: "measured",
      seconds: 700,
    });
    const named = group({ seconds: files(100, 2), name: "tests", done: 0 });
    expect(estimateSide({ groups: [named], measured: null }, 4, null)).toMatchObject({
      basis: "durations",
      seconds: 50,
    });
  });
});

describe("the results counted per group (row 023-66, V2)", () => {
  const ref = (path: string): TestFileRef => ({ project: "", path: path as never });
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

  it("counts a side's results in the group they ran in, and names the group", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-rate-"))) as AbsolutePath;
    try {
      writeFileSync(join(dir, "squeal.config.json"), JSON.stringify(browser));
      const todo = [ref("test/browser/a.test.ts"), ref("test/browser/b.test.ts")];
      const done = Array.from({ length: 14 }, (_, i) => ref(`test/u${i}.test.ts`));
      const { groups, doneIn } = workGroups([{ root: dir, files: todo, done }], () => null);
      expect(groups[0]?.map((g) => [g.name, g.done, g.seconds.length])).toEqual([
        ["browser", 0, 2],
      ]);
      expect(doneIn[0]?.(todo[0] as TestFileRef)).toBe(0);
      expect(doneIn[0]?.(ref("test/u99.test.ts"))).toBe(14);
      const e = estimateSide({ groups: groups[0] ?? [], measured: ROUND8 }, 4, null);
      expect(e).toMatchObject({ basis: "unknown", seconds: null, group: "browser" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("times a named file's batch at its group's rate, not the side's", () => {
    const named: TestFileRef = ref("test/browser/a.test.ts");
    const rates: unknown[] = [];
    const find = (rate: { done: number; ms: number } | null) => {
      rates.push(rate);
      return { named: [named], files: 30, startedAt: 0 as never, ran: 0, known: 0, seconds: null };
    };
    // The browser group measured 2 of the side's 14: the batch gets 2, too few to count.
    groupBatch(find, () => 2, ROUND8);
    expect(rates).toEqual([null, { done: 2, ms: 98_000 }]);
    // Not counted per group (the side's tree is gone): the side's rate, as before.
    rates.length = 0;
    groupBatch(find, () => null, ROUND8);
    expect(rates).toEqual([null, ROUND8]);
  });
});
