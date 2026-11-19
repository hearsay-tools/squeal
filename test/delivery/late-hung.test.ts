import { beforeEach, describe, expect, it } from "vitest";
import { NO_YIELD_ROW } from "../../src/core/scheduler/yield-row.js";
import { writeYieldRow } from "../../src/core/scheduler/yields.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { TierOverrun } from "../../src/core/types/standing.js";
import { FILE, WT } from "../state/helpers.js";
import { boundary, C1, clock, delivery, editA, LATE, setUp, store, tick } from "./late-fixture.js";

/*
 * Row 011-399 (gh-233; the coordinator, request 626d65e5: the hook reports it): when an owed
 * file's tier overruns, as its daemon published it in the `yields` row, the late line says in
 * one short clause that it may be hung and names the command that shows its run.
 */

beforeEach(() => setUp());

/** The live daemon published `FILE`'s tier as overrunning since `at`. */
function overruns(at: number, ended: readonly string[] = []): void {
  const tier: TierOverrun = {
    startedAt: (at - 60_000) as EpochMs,
    at: at as EpochMs,
    deadline: (at + 540_000) as EpochMs,
    files: [{ ...FILE, usualMs: 1_000 }],
  };
  const endedFiles = new Map([["r1", ended.map((path) => ({ project: "", path }))]]);
  const row = { ...NO_YIELD_ROW, endedFiles, overruns: new Map([["r1", tier]]) };
  writeYieldRow(store, WT, clock as EpochMs, row);
}

const HUNG =
  "src/a.test.ts has run far past its usual time and may be hung; `squeal why src/a.test.ts` shows its run. " +
  "To have it now, `squeal status --wait 60000 src/a.test.ts` runs it first.";

describe("the late line names an owed file that may be hung (row 011-399)", () => {
  it("says it once, in the late line, while the file's tier overruns", async () => {
    await delivery.register(C1);
    editA();
    expect(await boundary()).toContain("Squeal saw your edit");
    tick(2_130);
    overruns(clock - 1_000);
    const said = await boundary();
    expect(said).toMatch(LATE);
    expect(said).toContain(`Squeal says once when it has caught up. ${HUNG}`);
  });

  it("says nothing of it before the tier overruns, or once the runner named the file ended", async () => {
    await delivery.register(C1);
    editA();
    expect(await boundary()).toContain("Squeal saw your edit");
    tick(2_130);
    overruns(clock + 60_000);
    const said = await boundary();
    expect(said).toMatch(LATE);
    expect(said).not.toContain("may be hung");
  });

  it("an ended file is not hung", async () => {
    await delivery.register(C1);
    editA();
    expect(await boundary()).toContain("Squeal saw your edit");
    tick(2_130);
    overruns(clock - 1_000, [FILE.path]);
    const said = await boundary();
    expect(said).toMatch(LATE);
    expect(said).not.toContain("may be hung");
  });
});
