import { describe, expect, it } from "vitest";
import { classLines, fileEntry } from "../../src/cli/named-file-lines.js";
import { OVERRUN_FLOOR_MS } from "../../src/core/scheduler/overrun.js";
import type { CatchUpRun } from "./catch-up-fixture.js";
import { besideRuns, H, hungTier, MATES, overrunsOf, pathsOf, read } from "./overrun-fixture.js";
import { settle } from "./tier-yields-fixture.js";

/*
 * Row 011-405 (review 0.1.567 N1): the tier beside a hung one hangs too.
 * Past its own threshold its files are reported as overrunning, in the
 * `yields` row, status's line and the named wait's JSON, as the first
 * tier's are; its lane still holds two tiers, and no third instance opens.
 */

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
    // Under its own threshold the beside tier is not reported.
    expect(overrunsOf(side)).toHaveLength(1);

    // Past it, both are: the beside tier's files with `beside: true`.
    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    const overruns = overrunsOf(side);
    expect(overruns).toHaveLength(2);
    const byBeside = (b: boolean) => overruns.find((o) => (o.beside === true) === b);
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
      overrun: { path, beside: true, deadline: byBeside(true)?.deadline },
    });
    expect(classLines(read(side, [path]), "squeal").slice(1)).toEqual([
      expect.stringMatching(
        /so it may be hung; it runs beside another tier, so the lane's next tiers wait for one of the two to end, and its run's deadline is \S+: test\/q\d+\.test\.ts; `squeal why test\/q\d+\.test\.ts` shows its run/,
      ),
    ]);
    expect(named === undefined ? null : fileEntry(named, "squeal")).toMatchObject({
      overrun: { path, beside: true },
    });
    // The first tier's file keeps its own wording.
    expect(classLines(read(side, [H]), "squeal").join("\n")).toContain(
      "the lane runs its next tiers beside it",
    );

    hung.stop();
    beside.stop();
  });
});
