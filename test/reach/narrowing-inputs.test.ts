import { describe, expect, it } from "vitest";
import { formatReach } from "../../src/cli/reach-format.js";
import { buildReport } from "../../src/core/reach/report.js";
import type { ReachTestFile } from "../../src/core/reach/types.js";
import type { ImportGraph } from "../../src/core/store/import-graph.js";
import { fakeGraph, snapshot, testFile } from "./fixture.js";

/*
 * Review 0.1.493 B2 (row 022-04r, spec 022 D4): the estimate counts a pair
 * avoidable only when the stored edges prove every changed path an import
 * the list does not hold, and counts importers by those edges, not by the
 * route the report displays. Exact seconds and counts, text and JSON.
 */

const LAZY = "src/lazy.ts";

/** A test file with one list at 50 holding `held`, and one recorded second. */
function listed(path: string, closure: string[], held: string[] = [], rest = {}): ReachTestFile {
  const lists = [{ at: 50, paths: new Set([path, ...held]) }];
  return testFile(path, closure, { loaded: { lists, recordAt: null, failed: false }, ...rest });
}

function estimate(
  files: ReachTestFile[],
  edit: string,
  graph: ImportGraph | null,
  options: Parameters<typeof snapshot>[1] = {},
) {
  const report = buildReport(
    snapshot(files, { graph, edits: [{ at: 100, paths: [edit] }], ...options }),
    {
      paths: null,
      limit: null,
      command: "squeal",
      listed: files.length,
    },
  );
  // The JSON `--json` prints.
  const [json] = (JSON.parse(JSON.stringify(report)) as typeof report).narrowing;
  return { json, text: formatReach(report) };
}

describe("squeal reach: narrowing decides from graph facts (review 0.1.493 B2)", () => {
  it("never counts a resolution input the walk does not reach as avoidable", () => {
    // The review's first fixture: src/util.ts is a resolution candidate of the closure, no graph target.
    const a = listed(
      "a.test.ts",
      ["a.test.ts", "src/util/index.ts", "src/util.ts"],
      ["src/util/index.ts"],
    );
    const graph = fakeGraph({ "a.test.ts": ["src/util/index.ts"], "src/util/index.ts": [] });
    const { json, text } = estimate([a], "src/util.ts", graph);
    expect(json).toEqual({
      project: "",
      status: "estimate",
      lists: "lists: the newest recorded at or before each edit",
      rerunSeconds: 1,
      avoidableSeconds: 0,
      share: 0,
      files: [],
      moreFiles: 0,
      withoutList: [],
      unproved: [],
    });
    expect(text).toContain(
      "  default project: would save 0% of re-run seconds, 0 s of 1 s over the window's edits.\n",
    );
  });

  it("counts every graph importer, one of them also marked as a loaded module", () => {
    // The review's second fixture: B's in-process load reads as module evidence (`childProcess`).
    const a = listed("a.test.ts", ["a.test.ts", LAZY]);
    const b = listed("b.test.ts", ["b.test.ts", LAZY], [LAZY], { childProcess: new Set([LAZY]) });
    const graph = fakeGraph({ "a.test.ts": [LAZY], "b.test.ts": [LAZY], [LAZY]: [] });
    const { json, text } = estimate([a, b], LAZY, graph);
    expect(json).toMatchObject({
      rerunSeconds: 2,
      avoidableSeconds: 1,
      share: 0.5,
      files: [{ path: LAZY, avoidableSeconds: 1, importedBy: 2, loadedBy: 1 }],
      unproved: [],
    });
    expect(text).toContain(
      "  default project: would save 50% of re-run seconds, 1 s of 2 s over the window's edits.\n" +
        "    src/lazy.ts: avoidable 1 s; imported by 2 test files, loaded by 1\n",
    );
  });

  it("never counts an import also held by an input narrowing keeps", () => {
    const graph = fakeGraph(
      { "a.test.ts": [LAZY], [LAZY]: [] },
      { "": { files: ["vitest.config.ts", LAZY], roots: ["vitest.config.ts"] } },
    );
    const closure = ["a.test.ts", LAZY];
    const kept = {
      declared: estimate(
        [listed("a.test.ts", closure)],
        LAZY,
        fakeGraph({ "a.test.ts": [LAZY], [LAZY]: [] }),
        {
          declared: { [LAZY]: { tests: null, input: "src/*.ts" } },
        },
      ),
      read: estimate(
        [listed("a.test.ts", closure, [], { runtimeRead: new Set([LAZY]) })],
        LAZY,
        fakeGraph({ "a.test.ts": [LAZY], [LAZY]: [] }),
      ),
      module: estimate(
        [listed("a.test.ts", closure, [], { childProcess: new Set([LAZY]) })],
        LAZY,
        fakeGraph({ "a.test.ts": [LAZY], [LAZY]: [] }),
      ),
      environment: estimate([listed("a.test.ts", closure)], LAZY, graph),
    };
    for (const { json } of Object.values(kept)) {
      expect(json).toMatchObject({ rerunSeconds: 1, avoidableSeconds: 0, files: [], unproved: [] });
    }
  });

  it("leaves a pair out under a reason when no walk or an incomplete one cannot prove its input", () => {
    const a = listed("a.test.ts", ["a.test.ts", "src/gap.ts", LAZY]);
    const none = estimate([a], LAZY, null);
    // src/gap.ts has bytes and no entry in the walk: LAZY may be its import.
    const gap = estimate([a], LAZY, fakeGraph({ "a.test.ts": ["src/gap.ts"] }));
    expect(none.json).toMatchObject({
      rerunSeconds: 1,
      avoidableSeconds: 0,
      files: [],
      unproved: [{ reason: "no recorded walk", testFiles: 1, seconds: 1 }],
    });
    expect(gap.json).toMatchObject({
      avoidableSeconds: 0,
      unproved: [{ reason: "walk incomplete", testFiles: 1, seconds: 1 }],
    });
    expect(none.text).toContain(
      "    re-run, input not proved an import, not estimated: no import walk at its key: 1 test file, 1 s\n",
    );
    expect(gap.text).toContain(
      "    re-run, input not proved an import, not estimated: its import walk stops at an unrecorded module: 1 test file, 1 s\n",
    );
  });

  it("counts a lazy import the list does not hold, reached over a dynamic edge", () => {
    const a = listed("a.test.ts", ["a.test.ts", "src/router.ts", LAZY], ["src/router.ts"]);
    const graph = fakeGraph(
      { "a.test.ts": ["src/router.ts"], "src/router.ts": [], [LAZY]: [] },
      {},
      {
        "src/router.ts": [LAZY],
      },
    );
    expect(estimate([a], LAZY, graph).json).toMatchObject({
      avoidableSeconds: 1,
      files: [{ path: LAZY, avoidableSeconds: 1, importedBy: 1, loadedBy: 0 }],
    });
  });
});
