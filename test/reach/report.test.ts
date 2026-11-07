import { describe, expect, it } from "vitest";
import { formatReach } from "../../src/cli/reach-format.js";
import { buildReport, type ReportOptions } from "../../src/core/reach/report.js";
import type { ReachSnapshot } from "../../src/core/reach/types.js";
import { fakeGraph, NONE, record, snapshot, testFile } from "./fixture.js";

/* Row 015-109 (spec 015 D11): the ranked parts, suggestions, grouping and proposals. */

const OPTIONS: ReportOptions = { paths: null, limit: null, command: "squeal", listed: 3 };
const report = (snap: ReachSnapshot, options: Partial<ReportOptions> = {}) =>
  buildReport(snap, { ...OPTIONS, ...options });

describe("suggestions by path kind", () => {
  const graph = fakeGraph(
    {
      "test/a.test.ts": ["src/index.ts", "test/kit.ts", "src/factory.ts"],
      "test/b.test.ts": ["test/kit.ts", "src/used.ts"],
      "src/index.ts": ["src/types/state.ts", "src/types/run.ts", "src/used.ts"],
      "test/kit.ts": ["src/engine.ts"],
      "src/factory.ts": ["src/claude-runner.ts", "src/pi-runner.ts"],
      "vitest.config.ts": ["src/reporter.ts"],
      "test/setup.ts": ["src/waits.ts"],
    },
    { "": ["vitest.config.ts", "src/reporter.ts", "test/setup.ts", "src/waits.ts"] },
  );
  const sources = [
    "src/index.ts",
    "src/types/state.ts",
    "src/types/run.ts",
    "src/used.ts",
    "test/kit.ts",
    "src/engine.ts",
    "src/factory.ts",
    "src/claude-runner.ts",
    "src/pi-runner.ts",
    "fixtures/x.json",
    "dist/cli.js",
  ];
  const a = testFile("test/a.test.ts", ["test/a.test.ts", ...sources], {
    seconds: 3,
    coverage: record(
      ["src/used.ts", "src/engine.ts"],
      ["src/index.ts", "test/kit.ts", "src/factory.ts", "src/claude-runner.ts", "src/pi-runner.ts"],
    ),
    childProcess: new Set(["dist/cli.js"]),
  });
  const b = testFile(
    "test/b.test.ts",
    ["test/b.test.ts", "test/kit.ts", "src/engine.ts", "src/used.ts"],
    {
      seconds: 1,
      coverage: record([], ["test/kit.ts", "src/engine.ts"]),
    },
  );
  const snap = snapshot([a, b], {
    graph,
    barrels: ["src/index.ts"],
    stars: { "src/index.ts": ["src/types/state.ts", "src/types/run.ts"] },
    functions: { "src/types/state.ts": 0, "src/types/run.ts": 0, "src/used.ts": 2 },
    declared: { "fixtures/x.json": { tests: "test/**", input: "fixtures/**" } },
  });
  const r = report(snap);
  const entry = (file: string) => r.files.find((e) => e.files.includes(file));

  it("collapses files that share a gateway and a reach", () => {
    expect(entry("src/types/state.ts")).toMatchObject({
      files: ["src/types/run.ts", "src/types/state.ts"],
      folder: "src/types",
      gateway: { kind: "barrel", gateway: "src/index.ts" },
    });
    expect(entry("src/used.ts")?.files).toEqual(["src/used.ts"]);
  });

  it("says a barrel's file with no functions leaves with export type *", () => {
    expect(entry("src/types/state.ts")?.suggestion?.text).toBe(
      "hold no functions: tests re-run because src/index.ts re-exports them with `export *`; `export type *` takes them out of their closure",
    );
    expect(entry("src/used.ts")?.suggestion?.text).toBe(
      "import src/used.ts from its own path in the files that use it, or split src/index.ts",
    );
  });

  it("counts the helper's test files that never call the file", () => {
    expect(entry("src/engine.ts")?.suggestion?.text).toBe(
      "split test/kit.ts: 1 of the 2 test files that load src/engine.ts through it never call it",
    );
  });

  it("names a module that imports many siblings", () => {
    expect(entry("src/pi-runner.ts")).toMatchObject({
      files: ["src/claude-runner.ts", "src/pi-runner.ts"],
      suggestion: {
        kind: "transitive",
        text: "load these files only where they are used: src/factory.ts imports 2 sibling modules, so each test file that loads src/factory.ts loads them all; for example, a registry that each test fills",
      },
    });
  });

  it("names the config import and the setup chain", () => {
    expect(entry("src/reporter.ts")?.suggestion?.text).toBe(
      "vitest.config.ts imports src/reporter.ts: name it by path, or load it only where it is used",
    );
    expect(entry("src/waits.ts")?.suggestion?.text).toBe(
      "keep the setup's imports leaf-only: test/setup.ts → src/waits.ts",
    );
    expect(entry("vitest.config.ts")).toMatchObject({
      files: ["test/setup.ts", "vitest.config.ts"],
      folder: ".",
      gateway: null,
      suggestion: { text: "these files are setup files: keep their imports leaf-only" },
    });
  });

  it("names the declared pattern, and calls child-process seconds by design, never avoidable", () => {
    expect(entry("fixtures/x.json")?.suggestion?.text).toBe(
      'the input "fixtures/**" in squeal.config.json gives fixtures/x.json to the test files "test/**" matches: 1 test file here',
    );
    expect(entry("dist/cli.js")).toMatchObject({
      suggestion: null,
      note: "these tests start the program from source; Squeal re-runs them by design",
      avoidableSeconds: 0,
      coverage: { "outside the test's process": 1 },
    });
  });

  it("splits a file's seconds by coverage and counts loaded-only import seconds avoidable", () => {
    expect(entry("src/engine.ts")).toMatchObject({
      testFiles: 2,
      seconds: 4,
      share: 1,
      avoidableSeconds: 1,
      coverage: { called: 0.75, "loaded only": 0.25 },
    });
    expect(entry("src/index.ts")).toMatchObject({
      avoidableSeconds: 3,
      coverage: { "loaded only": 1 },
    });
    expect(entry("src/used.ts")).toMatchObject({
      avoidableSeconds: 1,
      coverage: { called: 0.75, "not loaded": 0.25 },
    });
  });

  it("ranks by avoidable seconds, then reach seconds", () => {
    const ranked = r.files.map((e) => e.avoidableSeconds);
    expect(ranked).toEqual([...ranked].sort((x, y) => y - x));
    expect(r.files[0]).toMatchObject({ files: ["test/kit.ts"], avoidableSeconds: 4 });
  });

  it("lists test files with the import that brings in most uncalled files", () => {
    expect(r.testFiles[0]).toMatchObject({
      path: "test/a.test.ts",
      seconds: 3,
      sources: 9,
      called: 2,
      via: { path: "src/index.ts", uncalled: 3 },
      avoidableSeconds: 21,
    });
    expect(r.testFiles.find((t) => t.path === "test/b.test.ts")).toMatchObject({
      sources: 3,
      called: 0,
      via: { path: "test/kit.ts", uncalled: 2 },
    });
  });

  it("gives a named file in full, each route with its test files", () => {
    const named = report(snap, { paths: ["src/engine.ts", "src/none.ts"] }).named;
    expect(named?.[0]).toMatchObject({
      path: "src/engine.ts",
      routes: [
        {
          kind: "test helper",
          gateway: "test/kit.ts",
          chain: ["test/a.test.ts", "test/kit.ts", "src/engine.ts"],
          tests: [
            { path: "test/a.test.ts", seconds: 3, coverage: "called" },
            { path: "test/b.test.ts", seconds: 1, coverage: "loaded only" },
          ],
        },
      ],
    });
    expect(named?.[1]).toMatchObject({ path: "src/none.ts", testFiles: 0, routes: [] });
  });
});

describe("limits, edits and seconds", () => {
  const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const tests = [
    testFile("test/x.test.ts", ["test/x.test.ts", ...files], { seconds: 2 }),
    testFile("test/y.test.ts", ["test/y.test.ts", "src/a.ts"], { seconds: null }),
    testFile("e2e/z.test.ts", ["e2e/z.test.ts", "src/a.ts"], { seconds: 50, inSuite: false }),
  ];
  const edits = [
    { at: 10, paths: ["src/a.ts"] },
    { at: 20, paths: ["src/a.ts", "src/b.ts"] },
    { at: 30, paths: ["README.md"] },
  ];
  const r = report(snapshot(tests, { edits }), { limit: 1 });

  it("lists --limit entries per part and counts the rest", () => {
    expect(r.files).toHaveLength(1);
    expect(r.moreFiles).toBe(1);
    expect(r.testFiles).toHaveLength(1);
    expect(r.moreTestFiles).toBe(1);
  });

  it("leaves manual groups and files without seconds out of every share", () => {
    expect(r.suite).toEqual({
      testFiles: 2,
      seconds: 2,
      withoutSeconds: 1,
      withoutClosure: 0,
      leftOut: 1,
    });
    expect(r.files[0]).toMatchObject({ files: ["src/a.ts"], testFiles: 2, seconds: 2, share: 1 });
    expect(r.proposals).toContainEqual({ kind: "seconds", command: "squeal warmup", testFiles: 1 });
  });

  it("names the window and each file's edits with their re-run seconds", () => {
    expect(r.window).toEqual({ from: 10, to: 30, edits: 3 });
    expect(r.files[0]).toMatchObject({ edits: 2, editSeconds: 4 });
    expect(r.testFiles[0]).toMatchObject({ path: "test/x.test.ts", edits: 2 });
  });

  it("reads import unsplit without edges, and collapses files of one kind and reach", () => {
    expect(r).toMatchObject({ edges: false, notRecorded: 0 });
    expect(r.files[0]?.kinds).toEqual({ import: 1 });
    const all = report(snapshot(tests, { edits }));
    expect(all.files.map((e) => [e.files, e.folder, e.gateway])).toEqual([
      [["src/a.ts"], null, null],
      [["src/b.ts", "src/c.ts"], "src", null],
    ]);
    expect(formatReach(all)).toContain("  2. 2 files in src/ (import)\n");
  });
});

describe("proposals", () => {
  const t = testFile("test/x.test.ts", ["test/x.test.ts", "src/a.ts"], { seconds: 2 });

  it("is the whole answer while no test file has a recorded result", () => {
    const r = report(snapshot([{ ...t, seconds: null }]));
    expect(r).toMatchObject({ history: false, files: [], testFiles: [] });
    expect(r.proposals).toEqual([{ kind: "warmup", command: "squeal warmup", testFiles: 3 }]);
    expect(report(snapshot([])).proposals).toEqual([
      { kind: "warmup", command: "squeal warmup", testFiles: 3 },
    ]);
  });

  it("proposes coverage while it is off, and the complexity key when that is off too", () => {
    expect(report(snapshot([t], { coverageOn: false })).proposals).toEqual([
      { kind: "coverage", keys: ['"coverage": { "enabled": true }'], command: "squeal warmup" },
    ]);
    const both = report(snapshot([t], { coverageOn: false, complexityEnabled: false }));
    expect(both.proposals[0]).toMatchObject({
      keys: ['"coverage": { "enabled": true }', '"complexity": { "enabled": true }'],
    });
    expect(both.files[0]?.coverage).toEqual({ unknown: 1 });
  });

  it("gives the no-record share and the forced run that makes the records", () => {
    const u = testFile("test/u.test.ts", ["test/u.test.ts", "src/a.ts"], {
      seconds: 6,
      coverage: record(["src/a.ts"]),
    });
    const r = report(snapshot([{ ...t, coverage: NONE }, u]));
    expect(r.proposals).toEqual([
      { kind: "records", command: "squeal run --all --force", testFiles: 1, share: 0.25 },
    ]);
    expect(r.files[0]?.coverage).toEqual({ called: 0.75, "no record": 0.25 });
  });

  it("counts and names test files with no trusted closure, whose reach is not counted", () => {
    const r = report(snapshot([{ ...t, closure: null }]));
    expect(r).toMatchObject({ history: true, files: [], suite: { withoutClosure: 1 } });
    expect(formatReach(r)).toContain(
      "1 test file has no import closure Squeal trusts at its current inputs, so its reach is not counted; its next run stores one.",
    );
    const two = report(
      snapshot([
        { ...t, closure: null },
        { ...t, closure: null },
      ]),
    );
    expect(formatReach(two)).toContain(
      "2 test files have no import closure Squeal trusts at their current inputs, so their reach is not counted; their next runs store them.",
    );
  });

  it("reads unknown for pytest while coverage is on, and names the runner", () => {
    const p = testFile("tests/test_a.py", ["tests/test_a.py", "app/a.py"], { runner: "pytest" });
    const r = report(snapshot([p]));
    expect(r.unmeasured).toEqual(["pytest"]);
    expect(r.files[0]?.coverage).toEqual({ unknown: 1 });
    expect(r.proposals).toEqual([]);
  });
});
