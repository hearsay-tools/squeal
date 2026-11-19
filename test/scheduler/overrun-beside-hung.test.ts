import { describe, expect, it } from "vitest";
import { classLines, fileEntry } from "../../src/cli/named-file-lines.js";
import { OVERRUN_FLOOR_MS } from "../../src/core/scheduler/overrun.js";
import type { CatchUpRun } from "./catch-up-fixture.js";
import { besideRuns, H, hungTier, MATES, overrunsOf, pathsOf, read } from "./overrun-fixture.js";
import { settle } from "./tier-yields-fixture.js";

const ALONE =
  "the tier it ran beside has ended and no tier starts beside it, so the lane's next tiers wait for it to end";
const WAITS =
  "it runs beside another tier, so the lane's next tiers wait for one of the two to end";

/*
 * Row 011-405 (review 0.1.567 N1): the tier beside a hung one hangs too.
 * Past its own threshold its files are reported as overrunning, in the
 * `yields` row, status's line and the named wait's JSON, as the first
 * tier's are; its lane still holds two tiers, and no third instance opens.
 * Review 0.1.570 B2: what the lane's next tiers wait for is read from the
 * tiers in flight, so when the first tier ends before the beside one, the
 * survivor says the lane waits for it alone, in either end order.
 */

/** The beside tier's files, as the lane's second run after `after` holds them. */
const besidePathsOf = (side: Parameters<typeof besideRuns>[0], after: number) =>
  pathsOf(besideRuns(side, after)[0] as CatchUpRun);

/** What status and the named wait's JSON say of the beside tier's first file. */
function besideFacts(side: Parameters<typeof read>[0], path: string) {
  const [named] = read(side, [path]);
  return {
    standing: named?.standing,
    line: classLines(read(side, [path]), "squeal").join("\n"),
    json: named === undefined ? null : fileEntry(named, "squeal"),
  };
}

describe("a hung beside tier is reported, and no third instance opens (row 011-405)", {
  timeout: 120_000,
}, () => {
  it("both tiers' files are published as overrunning; the lane keeps two tiers; no result changes", async () => {
    const { side, hung, beside, tier, after } = await hungTier(5, 12);
    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    const [second, ...more] = besideRuns(side, after);
    expect(more).toEqual([]);
    const besidePaths = pathsOf(second as CatchUpRun);
    expect(besidePaths).toHaveLength(4);
    // Under its own threshold the beside tier is not reported; the first tier's line says the
    // lane now waits, as it holds two tiers.
    expect(overrunsOf(side)).toHaveLength(1);
    expect(overrunsOf(side)[0]?.laneWaits).toBe("either");
    expect(classLines(read(side, [H]), "squeal").join("\n")).toContain(WAITS);

    // Past it, both are, each saying the lane waits for one of the two (`laneWaits: "either"`).
    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    const overruns = overrunsOf(side);
    expect(overruns).toHaveLength(2);
    const byBeside = (b: boolean) =>
      overruns.find((o) => o.files.some((f) => besidePaths.includes(f.path)) === b);
    expect(
      byBeside(false)
        ?.files.map((f) => f.path)
        .toSorted(),
    ).toEqual([H, ...MATES].toSorted());
    expect(
      byBeside(true)
        ?.files.map((f) => f.path)
        .toSorted(),
    ).toEqual(besidePaths.toSorted());
    expect(overruns.every((o) => o.laneWaits === "either")).toBe(true);
    expect(byBeside(true)?.deadline).toBeGreaterThan(byBeside(true)?.at ?? 0);

    // Still two tiers in the lane: no third run started, none ended or was cancelled.
    expect(side.runner.runs.slice(after)).toEqual([tier, second]);
    expect(tier.endedAt).toBeNull();
    expect(second?.endedAt).toBeNull();
    expect(tier.cancelled).toBe(false);
    expect(second?.cancelled).toBe(false);
    // No stored result changes: the held files have none for this edit.
    for (const path of [H, ...MATES, ...besidePaths]) expect(side.current(path)).toBe(false);

    // Status's line and the named wait's JSON name the beside file as overrunning.
    const path = besidePaths[0] as string;
    const [named] = read(side, [path]);
    expect(named?.standing).toMatchObject({
      kind: "running",
      overrun: { path, laneWaits: "either", deadline: byBeside(true)?.deadline },
    });
    expect(classLines(read(side, [path]), "squeal").slice(1)).toEqual([
      expect.stringMatching(
        /so it may be hung; it runs beside another tier, so the lane's next tiers wait for one of the two to end, and its run's deadline is \S+: test\/q\d+\.test\.ts; `squeal why test\/q\d+\.test\.ts` shows its run/,
      ),
    ]);
    expect(named === undefined ? null : fileEntry(named, "squeal")).toMatchObject({
      overrun: { path, laneWaits: "either" },
    });
    // The first tier's file says the same: neither tier makes room for the lane's next tiers.
    const first = classLines(read(side, [H]), "squeal").join("\n");
    expect(first).toContain(WAITS);
    expect(first).not.toContain("the lane runs its next tiers beside it");
    expect(read(side, [H])[0]?.standing).toMatchObject({
      overrun: { path: H, laneWaits: "either" },
    });

    hung.stop();
    beside.stop();
  });

  it("when the beside tier ends with nothing left to queue, the first tier's line says so again", async () => {
    const { side, hung, beside, after } = await hungTier(5, 4);
    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    expect(besideRuns(side, after)).toHaveLength(1);
    expect(overrunsOf(side)[0]?.laneWaits).toBe("either");

    beside.release();
    await settle(side);
    expect(besideRuns(side, after)).toHaveLength(1);
    const [overrun, ...others] = overrunsOf(side);
    expect(others).toEqual([]);
    expect(overrun?.laneWaits).toBeUndefined();
    const line = classLines(read(side, [H]), "squeal").join("\n");
    expect(line).toContain("the lane runs its next tiers beside it");
    expect(line).not.toContain(WAITS);
    hung.stop();
    beside.stop();
  });

  it("the first tier ends after both overrun: the survivor says the lane waits for it alone", async () => {
    const { side, hung, beside, tier, after } = await hungTier(5, 12);
    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    expect(overrunsOf(side)).toHaveLength(2);
    const paths = besidePathsOf(side, after);

    hung.stop();
    await settle(side);
    expect(tier.endedAt).not.toBeNull();
    // Admission as it stands: no tier starts beside the beside tier, nor in the lane it holds.
    const [second, ...others] = side.runner.runs.slice(after).slice(1);
    expect(others).toEqual([]);
    expect(second?.endedAt).toBeNull();
    const [overrun, ...more] = overrunsOf(side);
    expect(more).toEqual([]);
    expect(overrun?.files.map((f) => f.path).toSorted()).toEqual(paths.toSorted());
    expect(overrun?.laneWaits).toBe("it");
    const path = paths[0] as string;
    const facts = besideFacts(side, path);
    expect(facts.standing).toMatchObject({ kind: "running", overrun: { path, laneWaits: "it" } });
    expect(facts.line).toContain(ALONE);
    expect(facts.line).not.toContain(WAITS);
    expect(facts.json).toMatchObject({ overrun: { path, laneWaits: "it" } });
    // H's result is its own run's; the beside files have none yet.
    expect(side.current(H)).toBe(true);
    for (const p of paths) expect(side.current(p)).toBe(false);
    beside.stop();
  });

  it("the first tier ends before the beside one reaches its threshold: published later as alone", async () => {
    const { side, hung, beside, after } = await hungTier(5, 12);
    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    const paths = besidePathsOf(side, after);
    hung.stop();
    await settle(side);
    expect(overrunsOf(side)).toEqual([]);

    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    expect(side.runner.runs.slice(after)).toHaveLength(2);
    const [overrun, ...more] = overrunsOf(side);
    expect(more).toEqual([]);
    expect(overrun?.laneWaits).toBe("it");
    const path = paths[0] as string;
    const facts = besideFacts(side, path);
    expect(facts.line).toContain(ALONE);
    expect(facts.json).toMatchObject({ overrun: { path, laneWaits: "it" } });
    beside.stop();
  });
});
