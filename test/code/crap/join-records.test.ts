import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CoverageSource } from "../../../src/core/code/coverage/types.js";
import { type JoinFunction, joinCoverage } from "../../../src/core/code/crap/join.js";
import { joinedEntries } from "../../../src/core/code/crap/match.js";

/*
 * Spec 020 D4 (row 020-04): every function the join joined before the row
 * joins the same V8 function, and every measure it could read stays, but
 * for the corrections named below. The fixture holds 26 sources of this
 * repository, at one blob each: the counter's names and ranges, up to three
 * coverage records the daemon stored for that blob, and what the join
 * before the row gave: `joined`, the index of each function's V8 function
 * in each record (-1 for none), and `measures`, each function's [ran,
 * lines, covered] from each record alone, then from all of them. Its
 * generator is in `docs/specifications/020-quality-gate/tasks/020-04/`.
 */

type Range = [number, number, number, number];
interface FixtureFile {
  readonly path: string;
  readonly names: readonly string[];
  readonly ranges: readonly Range[];
  readonly records: readonly CoverageSource[];
  readonly joined: readonly (readonly number[])[];
  readonly measures: readonly (readonly [boolean | null, number, number][])[];
}

const FILES = (
  JSON.parse(
    readFileSync(new URL("../../fixtures/code/crap/join-records.json", import.meta.url), "utf8"),
  ) as {
    files: FixtureFile[];
  }
).files;

const functionsOf = (ranges: readonly Range[]): JoinFunction[] =>
  ranges.map(([startLine, startColumn, endLine, endColumn]) => ({
    range: { startLine, startColumn, endLine, endColumn },
  }));

/** Every join and measure of the fixture that differs from the join before the row. */
function differences() {
  const changed: string[] = [];
  let joins = 0;
  let measures = 0;
  for (const file of FILES) {
    const functions = functionsOf(file.ranges);
    file.records.forEach((record, r) => {
      const now = joinedEntries(functions, record.functions);
      file.joined[r]?.forEach((before, i) => {
        if (before === -1) return;
        joins++;
        const was = String(record.functions[before]);
        const is = String(now[i]);
        if (is !== was) changed.push(`${file.path} ${file.names[i]} r${r}: [${was}] now [${is}]`);
      });
    });
    [...file.records.map((r) => [r]), file.records].forEach((set, s) => {
      joinCoverage(functions, set).forEach((j, i) => {
        const [ran, lines, covered] = file.measures[s]?.[i] ?? [null, 0, 0];
        if (ran === null) return;
        measures++;
        const was = `${ran} ${covered}/${lines}`;
        const is = `${j.ran} ${j.covered}/${j.lines}`;
        if (is !== was) changed.push(`${file.path} ${file.names[i]} s${s}: ${was} now ${is}`);
      });
    });
  }
  return { changed, joins, measures };
}

/*
 * The corrections, each read against its source. A curried arrow's outer
 * function joined the inner arrow's V8 function and read its hit: `orNull`
 * and `oneOf` ran and read never ran; `inPaths` read the inner's. A nested
 * function joined its parent's V8 function, whose end a removed type cut
 * short: `zero.<map>` (whose parent never ran, so it still reads never ran),
 * `site.getFileName`, and `refuse`'s inner arrow, which never ran and read
 * ran. `refuse` now joins its own, which ran.
 */
const POLICY = "src/core/daemon/policy.ts";
const RACY = "test/watcher/parcel-racy.test.ts <mock>.refuse";
const CORRECTIONS = [
  ...[0, 1, 2].flatMap((r) => [
    `${POLICY} orNull r${r}: [50,3,54,2,0] now [49,6,54,2,1]`,
    `${POLICY} oneOf r${r}: [56,6,58,89,0] now [55,6,58,89,1]`,
  ]),
  ...[0, 1, 2, 3].flatMap((s) => [
    `${POLICY} orNull s${s}: false 0/2 now true 1/2`,
    `${POLICY} oneOf s${s}: false 0/3 now true 1/3`,
  ]),
  "src/core/reach/analyze.ts zero.<map> r0: [23,6,24,44,0] now [null]",
  `${RACY}.<anonymous> r0: [31,8,35,4,1] now [31,18,35,4,0]`,
  ...[0, 1].flatMap((s) => [
    `${RACY} s${s}: false 0/2 now true 1/2`,
    `${RACY}.<anonymous> s${s}: true 0/3 now false 0/3`,
  ]),
  "test/lint/provider/starter.test.ts site.getFileName r0: [11,6,11,65,1] now [11,41,11,60,1]",
  "src/cli/code-report.ts inPaths r1: [125,17,126,88,1] now [125,6,126,88,1]",
  "src/cli/code-report.ts inPaths r2: [125,17,126,88,1] now [125,6,126,88,1]",
];

describe("joinCoverage over this repository's own records (spec 020 D4)", () => {
  it("joins every function joined before to the same V8 function, and reads the same measures, but for the corrections", () => {
    const { changed, joins, measures } = differences();
    expect({ files: FILES.length, joins, measures }).toEqual({
      files: 26,
      joins: 879,
      measures: 1603,
    });
    expect(changed).toEqual(CORRECTIONS);
  });
});
