import { describe, expect, it } from "vitest";
import { declareTraits, liveTraits, NO_TRAITS } from "../../src/core/types/runner-traits.js";
import { nodeTestTraits } from "../../src/runners/node-test/traits.js";
import { pytestTraits } from "../../src/runners/pytest/traits.js";
import { vitestTraits } from "../../src/runners/vitest/traits.js";
import { A, answers, B, DEFAULTS, VITEST_TABLE } from "./runner-traits-fixture.js";

/*
 * Spec 011 C14 (row 011-329, `research/runner-traits.md`): one table at the
 * traits' interface. Each row is a holder's `traits`, read as the scheduler
 * reads them; the columns are the eight traits at fixed files and grants.
 */

describe("runner traits: the defaults and clamps (declareTraits)", () => {
  it.each([
    ["no statement", NO_TRAITS, DEFAULTS],
    ["an empty statement", declareTraits({}), DEFAULTS],
    [
      "a statement that answers undefined",
      declareTraits({
        omittedTestFiles: () => undefined,
        slowWidth: () => undefined,
        tierWidth: () => undefined,
        tierPart: () => undefined,
        besideBacklog: () => undefined,
        backlogSlot: () => undefined,
        focuses: () => undefined,
        lane: () => undefined,
      }),
      DEFAULTS,
    ],
    [
      "a full statement",
      declareTraits({
        omittedTestFiles: () => 2,
        slowWidth: () => 2,
        tierWidth: () => 3,
        tierPart: () => "p",
        besideBacklog: () => true,
        backlogSlot: () => 5,
        focuses: () => true,
        lane: () => "l",
      }),
      {
        omitted: 2,
        slowWidth: 2,
        tierWidth: 3,
        tierPart: "p",
        besideBacklog: true,
        backlogSlot: 5,
        focuses: true,
        lane: "l",
      },
    ],
    [
      "widths and a slot below 1",
      declareTraits({ slowWidth: () => 0, tierWidth: () => 0, backlogSlot: () => 0 }),
      { ...DEFAULTS, slowWidth: 1, tierWidth: 1, backlogSlot: 1 },
    ],
    [
      "a slot of part of a file",
      declareTraits({ backlogSlot: () => 2.7 }),
      { ...DEFAULTS, backlogSlot: 2 },
    ],
    ["an explicit no slot", declareTraits({ backlogSlot: () => null }), DEFAULTS],
  ])("%s", (_, traits, expected) => {
    expect(answers(traits)).toEqual(expected);
  });

  it("clamps a grant of 0 to one worker, and passes the grant and files to the statement", () => {
    expect(NO_TRAITS.tierWidth(A, 0)).toBe(1);
    expect(NO_TRAITS.slowWidth([])).toBe(1);
    const seen: unknown[] = [];
    const traits = declareTraits({
      slowWidth: (files) => {
        seen.push(files);
        return files.length - 1;
      },
      tierWidth: (file, grant) => {
        seen.push([file, grant]);
        return grant * 2;
      },
    });
    expect([traits.slowWidth([A, B]), traits.tierWidth(B, 3)]).toEqual([1, 6]);
    expect(seen).toEqual([
      [A, B],
      [B, 3],
    ]);
  });

  it("answers from the traits current at each read (liveTraits)", () => {
    let current = NO_TRAITS;
    const live = liveTraits(() => current);
    expect(answers(live)).toEqual(DEFAULTS);
    current = declareTraits({ tierWidth: () => 4, focuses: () => true });
    expect(answers(live)).toEqual({ ...DEFAULTS, tierWidth: 4, focuses: true });
  });
});

describe("runner traits: each runner kind's statement", () => {
  let tierSize = 4;
  it.each([
    ["Vitest over no values", vitestTraits(), { ...DEFAULTS, focuses: true }],
    [
      "Vitest over a width table and a listing's count",
      vitestTraits({ widths: () => VITEST_TABLE, omitted: () => 3 }),
      { ...DEFAULTS, omitted: 3, slowWidth: 2, tierWidth: 2, focuses: true },
    ],
    [
      "Vitest over a width table that does not decode",
      vitestTraits({ widths: () => ({ projects: [{ project: "" }] }), omitted: () => undefined }),
      { ...DEFAULTS, focuses: true },
    ],
    [
      "node:test over no values",
      nodeTestTraits(),
      { ...DEFAULTS, besideBacklog: true, backlogSlot: 1 },
    ],
    [
      "node:test at runner.tierSize 4",
      nodeTestTraits({ tierSize: () => tierSize }),
      { ...DEFAULTS, tierWidth: 4, besideBacklog: true, backlogSlot: 1 },
    ],
    [
      "pytest with no batch size",
      pytestTraits({ tierSize: () => tierSize }),
      { ...DEFAULTS, tierWidth: 4, besideBacklog: true, backlogSlot: 5, focuses: true },
    ],
    [
      "pytest with a batch size of 2",
      pytestTraits({ tierSize: () => tierSize, batchSize: () => 2 }),
      { ...DEFAULTS, tierWidth: 4, besideBacklog: true, backlogSlot: 2, focuses: true },
    ],
  ])("%s", (_, traits, expected) => {
    expect(answers(traits)).toEqual(expected);
  });

  it("reads runner.tierSize and the width table at each answer", () => {
    let table: unknown = null;
    const vitest = vitestTraits({ widths: () => table, omitted: () => 0 });
    const nodeTest = nodeTestTraits({ tierSize: () => tierSize });
    const pytest = pytestTraits({ tierSize: () => tierSize });
    expect([vitest.tierWidth(A, 8), nodeTest.tierWidth(A, 8), pytest.tierWidth(A, 1)]).toEqual([
      8, 4, 4,
    ]);
    table = VITEST_TABLE;
    tierSize = 6;
    expect([vitest.tierWidth(A, 8), nodeTest.tierWidth(A, 8), pytest.tierWidth(A, 1)]).toEqual([
      2, 6, 6,
    ]);
  });
});
