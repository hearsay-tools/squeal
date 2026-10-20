import { describe, expect, it } from "vitest";
import { REASON_GROUPS_SHOWN, reasonGroups } from "../../src/cli/named-file-lines.js";
import type { NamedFile, PendingReason } from "../../src/cli/named-files.js";
import type { EpochMs } from "../../src/core/types/index.js";

/*
 * Review wave-1.11 S1 (task 011-13): the verdict line's reason groups are
 * capped, the rest counted, however many worktrees hold the selected files.
 */

const UNTIL = Date.UTC(2026, 9, 9, 12, 10, 0) as EpochMs;

const pending = (i: number, reason: PendingReason): NamedFile => ({
  testFile: { project: "", path: `src/f${i}.test.ts` },
  state: "pending",
  pending: reason,
});
const claim = (i: number, worktree = `/repo/claimant-${i}`): NamedFile =>
  pending(i, { kind: "claim", worktree, until: UNTIL });

describe("the verdict line's reason groups (task 011-13)", () => {
  it(`names ${REASON_GROUPS_SHOWN} groups of 1,000 claimant roots and counts the rest`, () => {
    const files = Array.from({ length: 1_000 }, (_, i) => claim(i));

    const line = reasonGroups(files, "squeal");

    // 70,888 characters before the cap (review wave-1.11 S1, reproduction A).
    expect(line.length).toBeLessThan(600);
    expect(line.match(/waiting for /g)).toHaveLength(REASON_GROUPS_SHOWN);
    expect(line).toMatch(/^1 waiting for \/repo\/claimant-0's run of its key, at most until /);
    expect(line.endsWith(", and 995 more for 995 other reasons")).toBe(true);
  });

  it("counts every file of the groups it does not name, and says one reason as one", () => {
    const files = [
      ...Array.from({ length: REASON_GROUPS_SHOWN }, (_, i) => claim(i)),
      claim(10, "/repo/last"),
      claim(11, "/repo/last"),
    ];
    expect(reasonGroups(files, "squeal").endsWith(", and 2 more for 1 other reason")).toBe(true);
  });

  it("names every group up to the cap, and one promoted queue apart from a plain one", () => {
    const queued = (i: number, promoted: boolean): NamedFile =>
      pending(i, { kind: "queued", lane: "vitest", behind: null, promoted });
    const files = [
      queued(0, true),
      queued(1, false),
      queued(2, true),
      pending(3, { kind: "slow" }),
    ];
    expect(reasonGroups(files, "squeal")).toBe(
      "2 queued, promoted, 1 queued, nothing recorded holds it, 1 slow: `squeal run --slow`",
    );
  });

  it('says a slow file runs when the agent pauses under slow.trigger "idle" (004-80)', () => {
    const files = [pending(0, { kind: "slow", pausesOnly: true })];
    expect(reasonGroups(files, "squeal")).toBe(
      "1 slow, run when the agent pauses or on `squeal run --slow`",
    );
  });
});
