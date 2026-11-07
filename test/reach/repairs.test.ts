import { describe, expect, it } from "vitest";
import { formatReach } from "../../src/cli/reach-format.js";
import { buildReport, type ReportOptions } from "../../src/core/reach/report.js";
import type { ReachSnapshot } from "../../src/core/reach/types.js";
import { fakeGraph, NONE, record, snapshot, testFile, UNKNOWN } from "./fixture.js";

/*
 * Row 015-116 (`lessons.md` "Edit reach, round 1", defects 3 to 10 and 12):
 * one regression per defect, each from the proof's case in small. P2 is in
 * `pairs.test.ts`, P4's lexer in `read.test.ts`.
 */

const OPTIONS: ReportOptions = { paths: null, limit: null, command: "squeal", listed: 3 };
const report = (snap: ReachSnapshot, options: Partial<ReportOptions> = {}) =>
  buildReport(snap, { ...OPTIONS, ...options });

describe("P2: the not-recorded line names a cause that holds", () => {
  it("counts only Vitest pairs and never says a run records them", () => {
    const T = "test/a.test.ts";
    const none = { walk: () => undefined };
    const vitest = testFile(T, [T, "src/a.ts"]);
    const node = testFile("test/n.test.js", ["test/n.test.js", "src/a.ts"], { runner: "pytest" });
    const r = report(snapshot([vitest, node], { graph: none }));
    expect(r.notRecorded).toBe(1);
    expect(formatReach(r)).toContain(
      "1 pair read import, path not recorded yet: Squeal stored no complete walk of their test files' imports at the current inputs; the daemon stores one when it reads those imports again.\n",
    );
  });
});

describe("P3: the main route is chosen among the routes with avoidable seconds", () => {
  // Squeal's src/core/fs/index.ts: its helper seconds spread over gateways, one runtime-read route larger than each.
  const X = "src/fs.ts";
  const kits = ["test/kit1.ts", "test/kit2.ts", "test/kit3.ts"];
  const helped = kits.map((kit, i) =>
    testFile(`test/h${i}.test.ts`, [`test/h${i}.test.ts`, kit, X], {
      seconds: 10,
      coverage: record([kit], [X]),
    }),
  );
  const read = [0, 1].map((i) =>
    testFile(`test/r${i}.test.ts`, [`test/r${i}.test.ts`, X], {
      seconds: 10,
      runtimeRead: new Set([X]),
      coverage: record([]),
    }),
  );
  const graph = fakeGraph({
    ...Object.fromEntries(helped.map((t, i) => [t.ref.path, [kits[i] as string]])),
    ...Object.fromEntries(kits.map((kit) => [kit, [X]])),
    ...Object.fromEntries(read.map((t) => [t.ref.path, []])),
    [X]: [],
  });

  it("names a helper gateway and its suggestion, not the larger runtime-read route", () => {
    const [entry] = report(snapshot([...helped, ...read], { graph })).files;
    expect(entry).toMatchObject({
      files: [X],
      kind: "test helper",
      avoidableSeconds: 30,
      gateway: { kind: "test helper", gateway: "test/kit1.ts" },
      suggestion: {
        text: "split test/kit1.ts: 1 of the 1 test file that load src/fs.ts through it never call it",
      },
    });
    // Import paths hold 30 of its 50 s, so it is no by-design entry.
    expect(entry?.note).toBeUndefined();
  });

  it("notes by-design seconds only when they outweigh the import seconds", () => {
    const more = [2, 3, 4].map((i) =>
      testFile(`test/r${i}.test.ts`, [`test/r${i}.test.ts`, X], {
        seconds: 10,
        runtimeRead: new Set([X]),
        coverage: record([]),
      }),
    );
    const [entry] = report(snapshot([...helped, ...read, ...more], { graph })).files;
    expect(entry).toMatchObject({
      kind: "test helper",
      suggestion: { kind: "test helper" },
      note: "these tests start the program from source; Squeal re-runs them by design",
    });
  });
});

describe("P4: the types-only text depends on exporting no runtime value", () => {
  // Squeal's src/core/types/policy.ts has no function and exports DEFAULT_POLICY; state.ts holds types only.
  const T = "test/a.test.ts";
  const graph = fakeGraph({
    [T]: ["src/types/index.ts"],
    "src/types/index.ts": ["src/types/policy.ts", "src/types/state.ts"],
    "src/types/policy.ts": [],
    "src/types/state.ts": [],
  });
  const t = testFile(T, [T, "src/types/index.ts", "src/types/policy.ts", "src/types/state.ts"], {
    coverage: record([], ["src/types/index.ts", "src/types/policy.ts", "src/types/state.ts"]),
  });
  const r = report(
    snapshot([t], {
      graph,
      barrels: ["src/types/index.ts"],
      stars: { "src/types/index.ts": ["src/types/policy.ts", "src/types/state.ts"] },
      typesOnly: ["src/types/state.ts"],
      values: ["src/types/policy.ts"],
    }),
  );
  const text = (file: string) => r.files.find((e) => e.files.includes(file))?.suggestion?.text;

  it("gives the generic barrel text to a file that exports a value, and its own entry to a types-only one", () => {
    expect(text("src/types/policy.ts")).toBe(
      "import src/types/policy.ts from its own path in the files that use it, or split src/types/index.ts",
    );
    expect(text("src/types/state.ts")).toBe(
      "exports no runtime value: tests re-run because src/types/index.ts re-exports it with `export *`; `export type *` takes it out of their closure",
    );
  });

  it("never gives the types-only text to a file the barrel does not re-export with export *", () => {
    const plain = report(
      snapshot([t], {
        graph,
        barrels: ["src/types/index.ts"],
        typesOnly: ["src/types/state.ts"],
      }),
    );
    expect(plain.files.find((e) => e.files.includes("src/types/state.ts"))?.suggestion?.text).toBe(
      "import these files from their own paths in the files that use them, or split src/types/index.ts",
    );
  });
});

describe("P5: no split suggestion when no test file skips the file", () => {
  const T = "test/a.test.ts";
  const graph = fakeGraph({
    [T]: ["test/kit.ts"],
    "test/kit.ts": ["src/run.ts"],
    "src/run.ts": [],
  });
  const closure = [T, "test/kit.ts", "src/run.ts"];
  const entry = (coverage: ReturnType<typeof record>) =>
    report(snapshot([testFile(T, closure, { coverage })], { graph })).files.find((e) =>
      e.files.includes("src/run.ts"),
    );

  it("gives none when every test file that can tell calls it", () => {
    expect(entry(record(["src/run.ts", "test/kit.ts"]))).toMatchObject({
      gateway: { gateway: "test/kit.ts" },
      suggestion: null,
    });
  });

  it("still says what Squeal cannot tell, and counts the ones that skip it", () => {
    expect(entry(UNKNOWN)?.suggestion?.text).toBe(
      "split test/kit.ts: Squeal cannot tell which of the 1 test file that load src/run.ts through it call it",
    );
    expect(entry(record(["test/kit.ts"]))?.suggestion?.text).toBe(
      "split test/kit.ts: 1 of the 1 test file that load src/run.ts through it never call it",
    );
  });
});

describe("P6: a module that imports many siblings is a second gateway, even after a helper", () => {
  // Cezar: parity tests load core/runner-factory.ts through harness-parity.testkit.ts; it loads all the runners.
  const KIT = "src/core/harness-parity.testkit.ts";
  const FACTORY = "src/core/runner-factory.ts";
  const RUNNERS = ["src/core/claude-runner.ts", "src/core/omp-runner.ts", "src/core/pi-runner.ts"];
  const tests = ["src/core/a-parity.test.ts", "src/core/b-parity.test.ts"].map((path) =>
    testFile(path, [path, KIT, FACTORY, ...RUNNERS], {
      coverage: record([KIT, FACTORY, "src/core/claude-runner.ts"], RUNNERS),
    }),
  );
  const graph = fakeGraph({
    ...Object.fromEntries(tests.map((t) => [t.ref.path, [KIT]])),
    [KIT]: [FACTORY],
    [FACTORY]: RUNNERS,
    ...Object.fromEntries(RUNNERS.map((r) => [r, []])),
  });
  const r = report(snapshot(tests, { graph }));
  const entry = r.files.find((e) => e.files.includes("src/core/omp-runner.ts"));

  it("keeps the helper as the gateway and names the factory beside it", () => {
    // 015-121: claude-runner.ts, which both test files call, has no evidence and no second gateway.
    expect(entry).toMatchObject({
      files: ["src/core/omp-runner.ts", "src/core/pi-runner.ts"],
      gateway: { kind: "test helper", gateway: KIT },
      second: {
        gateway: FACTORY,
        suggestion: {
          kind: "transitive",
          text: "load these files only where they are used: src/core/runner-factory.ts imports 3 sibling modules, so each test file that loads it loads them all; 2 of the 2 test files that load these files through src/core/runner-factory.ts never call them; for example, a registry that each test fills",
        },
      },
      suggestion: { kind: "test helper" },
    });
    expect(formatReach(r)).toContain(
      "     second gateway: src/core/runner-factory.ts\n     suggestion: load these files only where they are used",
    );
  });

  it("names none when the gateway itself imports the file", () => {
    expect(r.files.find((e) => e.files.includes(FACTORY))?.second).toBeNull();
  });
});

describe("P7: the no-record proposal names its test files and the command for each", () => {
  it("lists the test files, and past ten names squeal retry by its usage", () => {
    const missing = Array.from({ length: 12 }, (_, i) =>
      testFile(`test/m${String(i).padStart(2, "0")}.test.ts`, ["src/a.ts"], {
        coverage: NONE,
        current: false,
      }),
    );
    const r = report(snapshot([...missing, testFile("test/x.test.ts", ["src/a.ts"])]));
    expect(r.proposals[0]).toMatchObject({ kind: "records", testFiles: 12, current: [] });
    expect(formatReach(r)).toContain(
      "12 test files have no result at the current inputs; `squeal retry <test file>...` runs each once: test/m00.test.ts, test/m01.test.ts, test/m02.test.ts, test/m03.test.ts, test/m04.test.ts, test/m05.test.ts, test/m06.test.ts, test/m07.test.ts, test/m08.test.ts, test/m09.test.ts and 2 more (--json lists every one).\n",
    );
  });

  it("leaves a test file with no recorded seconds to the seconds proposal", () => {
    const r = report(
      snapshot([
        testFile("test/x.test.ts", ["src/a.ts"]),
        testFile("test/y.test.ts", ["src/a.ts"], { coverage: NONE, seconds: null, current: false }),
      ]),
    );
    expect(r.proposals).toEqual([{ kind: "seconds", command: "squeal warmup", testFiles: 1 }]);
  });
});

describe("P8: with coverage unknown, the order counts the seconds of import pairs", () => {
  // Cezar with coverage off: setup and runtime-read files came first, the first helper entry at rank 30.
  const tests = [0, 1, 2].map((i) =>
    testFile(`test/t${i}.test.ts`, [`test/t${i}.test.ts`, "package.json", "src/a.ts"], {
      seconds: 10,
      runtimeRead: new Set(["package.json"]),
    }),
  );
  const imported = testFile("test/i.test.ts", ["test/i.test.ts", "src/b.ts"], { seconds: 5 });
  const snap = snapshot([...tests, imported], { coverageOn: false });
  const r = report(snap);

  it("ranks import seconds before seconds that only a runtime read gives", () => {
    expect(r.files.map((e) => [e.files, e.unknownSeconds, e.avoidableSeconds])).toEqual([
      [["src/a.ts"], 30, 0],
      [["src/b.ts"], 5, 0],
      [["package.json"], 0, 0],
    ]);
  });

  it("says what it ranks by", () => {
    const text = formatReach(r);
    expect(text).toContain(
      "Files, by seconds re-run on import paths per edit (called is unknown), then seconds re-run:\n",
    );
    expect(text).toContain(
      "     coverage: called: unknown; on import paths with called unknown 30 s\n",
    );
    expect(text).toContain(
      "Test files, by pair-seconds on import paths (seconds times the source files they load; called is unknown), then seconds re-run:\n",
    );
  });

  it("ranks a test file whose coverage is unknown by its import sources, not its runtime reads", () => {
    const reads = ["a.json", "b.json", "c.json"];
    const wide = testFile("test/w.test.ts", ["test/w.test.ts", "src/b.ts", ...reads], {
      seconds: 5,
      runtimeRead: new Set(reads),
    });
    const big = testFile("test/big.test.ts", ["test/big.test.ts", "src/a.ts", "src/b.ts"], {
      seconds: 4,
    });
    const order = report(snapshot([wide, big], { coverageOn: false })).testFiles;
    // 4 s times 2 import sources before 5 s times 1, though test/w.test.ts re-runs on 4 files.
    expect(order.map((t) => [t.path, t.avoidablePairSeconds])).toEqual([
      ["test/big.test.ts", 0],
      ["test/w.test.ts", 0],
    ]);
  });

  it("counts a pytest file's import seconds beside a Vitest file's avoidable ones while coverage is on", () => {
    const py = testFile("tests/test_a.py", ["tests/test_a.py", "app/a.py"], {
      runner: "pytest",
      seconds: 9,
    });
    const vi = testFile("test/v.test.ts", ["test/v.test.ts", "src/v.ts"], {
      seconds: 3,
      coverage: record([], ["src/v.ts"]),
    });
    const mixed = report(snapshot([vi, py]));
    expect(mixed.files.map((e) => [e.files[0], e.avoidableSeconds, e.unknownSeconds])).toEqual([
      ["app/a.py", 0, 9],
      ["src/v.ts", 3, 0],
    ]);
    expect(formatReach(mixed)).toContain(
      "Files, by avoidable seconds per edit, or seconds on import paths where called is unknown, then seconds re-run:\n",
    );
  });
});

describe("P9: with no listing, the report names squeal start before any warm-up cost", () => {
  it("proposes squeal start while no daemon listed the test files, and the warm-up once one did", () => {
    expect(report(snapshot([]), { listed: null }).proposals).toEqual([
      { kind: "start", command: "squeal start", runsMissing: false },
    ]);
    const runs = snapshot([], { onStart: "lookup-then-run-missing" });
    expect(formatReach(report(runs, { listed: null }))).toContain(
      "Proposal: squeal start lists them and looks up the results stored for their inputs, and runs the test files it finds none for (baseline.onStart is lookup-then-run-missing), up to one run of the whole suite.",
    );
    expect(report(snapshot([]), { listed: 3 }).proposals).toEqual([
      { kind: "warmup", command: "squeal warmup", testFiles: 3 },
    ]);
  });
});

describe("P10: --limit bounds the named view", () => {
  // Cezar: one route of the sequencer listed 1,568 test files.
  const graph = fakeGraph({
    "test/a.test.ts": ["src/x.ts"],
    "test/b.test.ts": ["src/x.ts"],
    "test/c.test.ts": ["src/x.ts"],
    "test/d.test.ts": ["test/kit.ts"],
    "test/e.test.ts": ["test/other-kit.ts"],
    "test/kit.ts": ["src/x.ts"],
    "test/other-kit.ts": ["src/x.ts"],
    "src/x.ts": [],
  });
  const direct = ["a", "b", "c"].map((n, i) =>
    testFile(`test/${n}.test.ts`, [`test/${n}.test.ts`, "src/x.ts"], { seconds: 3 - i }),
  );
  const kit = testFile("test/d.test.ts", ["test/d.test.ts", "test/kit.ts", "src/x.ts"]);
  const other = testFile("test/e.test.ts", ["test/e.test.ts", "test/other-kit.ts", "src/x.ts"]);
  const snap = snapshot([...direct, kit, other], { graph });

  it("lists --limit routes of a named file and --limit test files of a route, and counts the rest", () => {
    const [named] = report(snap, { paths: ["src/x.ts"], limit: 1 }).named ?? [];
    expect(named?.routes).toHaveLength(1);
    expect(named?.moreRoutes).toBe(4);
    expect(named?.routes[0]).toMatchObject({ tests: [{ path: "test/a.test.ts" }], moreTests: 0 });
    const text = formatReach(report(snap, { paths: ["src/x.ts"], limit: 1 }));
    expect(text).toContain("  … and 4 more routes; --limit lists more.\n");
  });

  it("bounds the test files of one route", () => {
    // Without stored edges the three read one unsplit import route.
    const one = report(snapshot(direct), { paths: ["src/x.ts"], limit: 2 });
    expect(one.named?.[0]?.routes[0]).toMatchObject({
      kind: "import",
      tests: [{ path: "test/a.test.ts" }, { path: "test/b.test.ts" }],
      moreTests: 1,
    });
    expect(formatReach(one)).toContain("    … and 1 more test file; --limit lists more.\n");
  });

  it("gives every route and test file without a limit", () => {
    const [named] = report(snap, { paths: ["src/x.ts"] }).named ?? [];
    expect(named?.moreRoutes).toBe(0);
    expect(named?.routes.flatMap((r) => r.tests)).toHaveLength(5);
  });
});

describe("P12: the test-file field is named as pair-seconds", () => {
  it("gives seconds times the source files the test file loads and never calls", () => {
    const t = testFile("test/a.test.ts", ["test/a.test.ts", "src/a.ts", "src/b.ts", "src/c.ts"], {
      seconds: 126,
      coverage: record(["src/a.ts"], ["src/b.ts"]),
    });
    const r = report(snapshot([t]));
    expect(r.testFiles[0]).toMatchObject({ avoidablePairSeconds: 252, called: 1, sources: 3 });
    expect(r.testFiles[0]).not.toHaveProperty("avoidableSeconds");
    expect(formatReach(r)).toContain(
      "Test files, by avoidable pair-seconds (seconds times the source files they load on import paths and never call), then seconds re-run:\n",
    );
  });
});

describe("a collapsed entry without a gateway is named by its main route's kind", () => {
  it("names the import route it ranks by, not the runtime-read kind with more seconds", () => {
    const loads = testFile("test/l.test.ts", ["test/l.test.ts", "src/a.ts", "src/b.ts"], {
      seconds: 1,
      coverage: record([], ["src/a.ts", "src/b.ts"]),
    });
    const reads = testFile("test/r.test.ts", ["test/r.test.ts", "src/a.ts", "src/b.ts"], {
      seconds: 5,
      runtimeRead: new Set(["src/a.ts", "src/b.ts"]),
      coverage: record([]),
    });
    const r = report(snapshot([loads, reads]));
    expect(r.files[0]).toMatchObject({
      files: ["src/a.ts", "src/b.ts"],
      kind: "import",
      kinds: { "runtime read": 5 / 6, import: 1 / 6 },
      note: "these tests start the program from source; Squeal re-runs them by design",
    });
    expect(formatReach(r)).toContain("  1. 2 files in src/ (import)\n");
  });
});
