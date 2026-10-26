import { describe, expect, it } from "vitest";
import { formatCodeReport } from "../../../src/cli/code.js";
import { readCodeReport } from "../../../src/cli/code-report.js";
import { COVERAGE_MEASURES } from "../../../src/core/code/crap/index.js";
import { toldOver } from "../../../src/core/delivery/code-told.js";
import { WT } from "../../state/helpers.js";
import { consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-75 part 4 (the coordinator's decision, 2026-10-26): the agent
 * hears once, at the session start, that functions only a runner without
 * coverage runs read not measured, and no later hook message names or
 * counts such a source. pytest is that runner here, as node:test gives
 * records from row 015-86. `squeal code` prints `not measured: <runner> gives
 * no coverage` for each of its functions, and no CRAP value.
 */

const S1 = consumer("s1");
const SENTENCE = (runners: string) =>
  `Coverage comes from Vitest runs only; functions that only ${runners} tests run read not measured.`;

/** The registration's code line: the one that starts `Complexity:`. */
const codeLine = (lines: readonly string[]) => lines.filter((l) => l.startsWith("Complexity:"));

/** Every delivered line that names `classify` or speaks of coverage. */
const aboutCoverage = (lines: readonly string[]) =>
  lines.filter((l) => /classify|coverage|untested|CRAP|records/i.test(l));

describe("the session start's sentence on runners without coverage (row 015-75)", () => {
  it.each([
    ["pytest alone", ["pytest"], "pytest"],
    ["node:test and pytest", ["node-test", "pytest"], "node:test or pytest"],
  ] as const)("ends the code line with it, %s", async (_, configured, runners) => {
    const rig = coverageRig();
    rig.configure(configured);
    await rig.edit({ "src/a.ts": "hot 12 h1\n" });
    expect(codeLine(await rig.register(S1))).toEqual([
      `Complexity: 0 functions over 20; squeal code lists them. ${SENTENCE(runners)}`,
    ]);
  });

  it.each([
    ["every configured runner records", [], {}],
    ["coverage is off", ["pytest"], { coverage: { enabled: false } }],
  ] as const)("is absent when %s", async (_, configured, more) => {
    const rig = coverageRig();
    rig.configure(configured, more);
    await rig.edit({ "src/a.ts": "hot 12 h1\n" });
    expect(codeLine(await rig.register(S1))).toEqual([
      "Complexity: 0 functions over 20; squeal code lists them.",
    ]);
  });
});

describe("a pytest-only source after the session start (row 015-75, e-order)", () => {
  async function helperTested() {
    const rig = coverageRig();
    rig.configure(["pytest"]);
    rig.closures.setEnvironment({ runner: "pytest", files: [] });
    rig.loader("scripts/other.test.ts", { closure: [] });
    await rig.edit({ "src/a.ts": "hot 12 h1\n" });
    rig.step();
    expect(codeLine(await rig.register(S1))).toEqual([
      `Complexity: 0 functions over 20; squeal code lists them. ${SENTENCE("pytest")}`,
    ]);
    // The agent writes the helper first: no test loads it, so it is untested, and told so.
    await rig.edit({ "scripts/helper.ts": "classify 4 h1\n" });
    rig.step();
    expect(aboutCoverage(await rig.told(S1))).toEqual([
      "FAIL untested: classify (scripts/helper.ts:1): no test file loads this file (complexity 4, CRAP 20)",
    ]);
    // Then its pytest test file.
    await rig.edit({ "scripts/helper.test.ts": "it\n" });
    rig.loader("scripts/helper.test.ts", { closure: ["scripts/helper.ts"] });
    rig.step();
    return rig;
  }

  it("tells nothing more of it, and the told count leaves it out", async () => {
    const rig = await helperTested();
    expect(aboutCoverage(await rig.told(S1))).toEqual([]);
    expect(toldOver(rig.store, WT, [S1], COVERAGE_MEASURES)).toEqual([]);
    // An edit to it is no STILL FAIL either.
    await rig.edit({ "scripts/helper.ts": "classify 4 h2\n" });
    rig.step();
    expect(aboutCoverage(await rig.told(S1))).toEqual([]);
  });

  it("is listed by squeal code as not measured, with no CRAP value", async () => {
    const rig = await helperTested();
    const report = readCodeReport(
      rig.main,
      rig.store,
      WT,
      { threshold: 20, maxFileBytes: 524_288 },
      { paths: ["scripts/helper.ts"], changed: false, shell: null },
    );
    expect(report.functions.map((f) => f.coverage)).toEqual([{ notMeasured: ["pytest"] }]);
    expect(formatCodeReport(report)).toContain(
      "  scripts/helper.ts:1  classify  CC 4 (if 3), at or under; not measured: pytest gives no coverage\n",
    );
    const all = readCodeReport(
      rig.main,
      rig.store,
      WT,
      { threshold: 20, maxFileBytes: 524_288 },
      { paths: null, changed: false, shell: null },
    );
    // `hot` in src/a.ts, which no test file loads, is untested.
    expect(all.coverage).toMatchObject({
      uncovered: 1,
      notJudged: 0,
      notMeasured: { files: 1, runners: ["pytest"] },
    });
    expect(formatCodeReport(all)).toContain("  1 file not measured: pytest gives no coverage\n");
  });
});

describe("a source a Vitest and a pytest test file both load (review 0.1.354 B1)", () => {
  const read = (rig: ReturnType<typeof coverageRig>, paths: string[] | null) =>
    readCodeReport(
      rig.main,
      rig.store,
      WT,
      { threshold: 20, maxFileBytes: 524_288 },
      { paths, changed: false, shell: null },
    );

  it("keeps the pass its Vitest record proves, in text, JSON and the totals", async () => {
    const rig = coverageRig();
    rig.configure(["pytest"]);
    rig.closures.setEnvironment({ runner: "vitest", files: [] });
    rig.closures.setEnvironment({ runner: "pytest", files: [] }, "py");
    await rig.edit({ "src/a.ts": "hot 12 h1\n" });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: [] });
    rig.step();
    expect(rig.states("crap")).toEqual(["hot fail 156"]);
    const blob = rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";
    rig.loader("test/a.py.test.ts", { closure: ["src/a.ts"], project: "py" });
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      key: "key-2",
      record: [sourceOf("src/a.ts", blob, 1, [1])],
    });
    rig.step();
    expect(rig.states("crap")).toEqual(["hot pass 12"]);

    const one = read(rig, ["src/a.ts"]);
    const [hot] = one.functions.map((f) => f.coverage);
    expect(hot).toMatchObject({ crap: { outcome: "pass", value: 12 }, uncovered: "pass" });
    expect(hot).not.toHaveProperty("notMeasured");
    expect(formatCodeReport(one)).not.toContain("not measured");
    const all = read(rig, null);
    expect(all.coverage).not.toHaveProperty("notMeasured");
    expect(formatCodeReport(all)).not.toContain("not measured");
  });
});
