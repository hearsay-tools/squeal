import { describe, expect, it } from "vitest";
import { formatImpact } from "../../src/cli/reach-format.js";
import { buildReport, type ReportOptions } from "../../src/core/reach/report.js";
import { fakeGraph, snapshot, testFile } from "./fixture.js";

/*
 * Row 015-128 (spec 015 D11 as amended 2026-11-22): the window's re-run
 * seconds, each entry's share of them, and the top gateways across every
 * edited file: setup root, test helper, barrel, declared input, transitive
 * hub, observed path and broad test reader.
 */

const OPTIONS: ReportOptions = { paths: null, limit: null, command: "squeal", listed: 6 };

const modules = Array.from({ length: 10 }, (_, i) => `src/m${i}.ts`);
const graph = fakeGraph(
  {
    "test/t1.test.ts": ["test/kit.ts", "src/index.ts"],
    "test/t2.test.ts": ["test/kit.ts", "src/app.ts"],
    "test/t3.test.ts": ["test/kit.ts"],
    "test/kit.ts": ["src/a.ts", "src/b.ts"],
    "src/index.ts": ["src/types.ts"],
    "src/app.ts": ["src/registry.ts"],
    "test/setup.ts": ["src/env.ts"],
    ...Object.fromEntries(
      ["src/a.ts", "src/b.ts", "src/types.ts", "src/registry.ts", "src/env.ts"].map((p) => [p, []]),
    ),
    // The broad readers import nothing the walk records beyond themselves.
    "test/daemon/x.test.ts": [],
    "test/daemon/y.test.ts": [],
    "test/e2e/z.test.ts": [],
  },
  { "": { files: ["test/setup.ts", "src/env.ts"], roots: ["test/setup.ts"] } },
);
const t1 = testFile(
  "test/t1.test.ts",
  [
    "test/t1.test.ts",
    "test/kit.ts",
    "src/a.ts",
    "src/b.ts",
    "src/index.ts",
    "src/types.ts",
    "package.json",
  ],
  { seconds: 1, runtimeRead: new Set(["package.json"]) },
);
const t2 = testFile(
  "test/t2.test.ts",
  [
    "test/t2.test.ts",
    "test/kit.ts",
    "src/a.ts",
    "src/b.ts",
    "src/app.ts",
    "src/registry.ts",
    "package.json",
  ],
  { seconds: 2, runtimeRead: new Set(["package.json"]) },
);
const t3 = testFile(
  "test/t3.test.ts",
  ["test/t3.test.ts", "test/kit.ts", "src/a.ts", "src/b.ts", "fixtures/data.json"],
  { seconds: 4 },
);
const reader = (path: string, seconds: number) =>
  testFile(path, [path, ...modules], { seconds, runtimeRead: new Set(modules) });
const tests = [
  t1,
  t2,
  t3,
  reader("test/daemon/x.test.ts", 8),
  reader("test/daemon/y.test.ts", 8),
  reader("test/e2e/z.test.ts", 16),
];
const edits = [
  ["src/a.ts"],
  ["src/a.ts", "src/b.ts"],
  ["src/env.ts"],
  ["src/types.ts"],
  ["src/registry.ts"],
  ["fixtures/data.json"],
  ["package.json"],
  ["src/m0.ts"],
  ["src/m1.ts", "src/m2.ts"],
].map((paths, i) => ({ at: 10 + i, paths }));
const snap = snapshot(tests, {
  graph,
  barrels: ["src/index.ts"],
  declared: { "fixtures/data.json": { tests: "test/t3.test.ts", input: "fixtures/**" } },
  edits,
  coverageOn: false,
});
const r = buildReport(snap, OPTIONS);

describe("the window's re-run seconds", () => {
  it("sums each edit's test files once, however many of its files reach them", () => {
    // 7 + 7 (a and b, one union) + 39 (setup) + 1 + 2 + 4 + 3 + 32 + 32 (two modules, one union).
    expect(r.window?.rerunSeconds).toBe(127);
  });

  it("gives each entry its share of them", () => {
    const helper = r.byEdits.find((e) => e.files.includes("src/a.ts"));
    expect(helper).toMatchObject({ edits: 2, editSeconds: 14, editShare: 14 / 127 });
  });

  it("counts an edit of a test file as re-running that test file", () => {
    const own = buildReport(
      snapshot(tests, { graph, edits: [{ at: 1, paths: ["test/t3.test.ts"] }] }),
      OPTIONS,
    );
    expect(own.window?.rerunSeconds).toBe(4);
  });
});

describe("top gateways by the window's edits", () => {
  const rows = r.gateways.map((g) => [
    g.kind,
    g.mode ?? null,
    g.gateway,
    g.edits,
    g.editedFiles,
    g.testFiles,
    g.editSeconds,
  ]);

  it("groups by setup root, helper, barrel, declared pattern, hub, observed path and broad reader", () => {
    expect(rows).toEqual([
      ["setup", null, "test/setup.ts", 1, 1, 6, 39],
      ["runtime read", "broad test reader", "test/daemon/*", 2, 3, 2, 32],
      ["runtime read", "broad test reader", "test/e2e/z.test.ts", 2, 3, 1, 32],
      ["test helper", null, "test/kit.ts", 2, 2, 3, 14],
      ["declared input", null, "fixtures/**", 1, 1, 1, 4],
      ["runtime read", "observed path", "package.json", 1, 1, 2, 3],
      ["transitive", null, "src/app.ts", 1, 1, 1, 2],
      ["barrel", null, "src/index.ts", 1, 1, 1, 1],
    ]);
    expect(r.gateways[0]?.editShare).toBe(39 / 127);
    expect(r.gateways[1]?.sampleFiles).toEqual(["src/m0.ts", "src/m1.ts", "src/m2.ts"]);
  });

  it("gives each a suggestion, and the observed ones their recorded facts", () => {
    const of = (gateway: string) => r.gateways.find((g) => g.gateway === gateway);
    expect(of("test/kit.ts")?.suggestion?.text).toBe(
      "split test/kit.ts, so each test file loads only the parts it uses",
    );
    expect(of("package.json")).toMatchObject({
      suggestion: null,
      note: "2 test files read package.json at run time, outside their imports: 2 in their own process",
    });
    expect(of("test/daemon/*")?.note).toBe(
      "test/daemon/* (2, 10 modules) read source modules at run time, outside their imports, as tests that start or bundle the program from source do; 3 edited modules re-ran them",
    );
  });

  it("leads the text, with the share of the window's re-run seconds", () => {
    const text = formatImpact(r);
    expect(text).toContain(
      "Top gateways, by seconds re-run over the window's edits:\n" +
        "  1. setup test/setup.ts: 1 edit re-ran 39 s, 31% of the window's re-run seconds, through 6 test files\n" +
        "     suggestion: keep the imports of test/setup.ts leaf-only, or load src/env.ts only in the tests that use it\n" +
        "  2. runtime read (broad test reader) test/daemon/*: 2 edits of 3 files re-ran 32 s, 25% of the window's re-run seconds, through 2 test files\n" +
        "     for example src/m0.ts, src/m1.ts, src/m2.ts\n",
    );
    expect(text.indexOf("Top gateways")).toBeLessThan(
      text.indexOf("Files, by seconds re-run over"),
    );
  });

  it("applies --limit", () => {
    const limited = buildReport(snap, { ...OPTIONS, limit: 2 });
    expect(limited.gateways).toHaveLength(2);
    expect(limited.moreGateways).toBe(6);
  });

  it("is empty with no edits", () => {
    expect(buildReport(snapshot(tests, { graph }), OPTIONS)).toMatchObject({
      gateways: [],
      moreGateways: 0,
      window: null,
    });
  });
});

describe("runtime-read notes state recorded facts, never a blanket by design", () => {
  it("names broad readers by folder and module count, and the share of the window's re-run seconds", () => {
    const entry = r.files.find((e) => e.files.includes("src/m0.ts"));
    expect(entry).toMatchObject({ kind: "runtime read", editSeconds: 64, editShare: 64 / 127 });
    expect(entry?.note).toBe(
      "3 test files read these files among many source modules, as tests that start or bundle the program from source do: test/daemon/* (2, 10 modules), test/e2e/z.test.ts (10 modules), outside their imports; their edits re-ran 50% of the window's re-run seconds",
    );
    expect(JSON.stringify(r)).not.toContain("by design");
  });

  it("splits an observed path's readers by whether each test file reads broadly", () => {
    // Squeal: package.json, read through version.ts by in-process tests and by test/daemon/*.
    const both = tests.map((t) =>
      t.ref.path.startsWith("test/daemon/")
        ? {
            ...t,
            closure: [...(t.closure ?? []), "package.json"],
            runtimeRead: new Set([...t.runtimeRead, "package.json"]),
          }
        : t,
    );
    const split = buildReport(
      snapshot(both, { graph, edits: [{ at: 1, paths: ["package.json"] }] }),
      OPTIONS,
    );
    const entry = split.files.find((e) => e.files.includes("package.json"));
    expect(entry?.note).toBe(
      "4 test files re-run on it outside their imports: 2 test files read package.json at run time in their own process; 2 test files read package.json among many source modules, as tests that start or bundle the program from source do: test/daemon/* (2, 10 modules); its edits re-ran 100% of the window's re-run seconds",
    );
    expect(split.gateways[0]?.note).toBe(
      "4 test files read package.json at run time, outside their imports: 2 in their own process; 2 among many source modules, as tests that start or bundle the program from source do: test/daemon/* (2, 10 modules)",
    );
  });

  it("keeps every project instance of a shared test path in window.rerunSeconds and shares (review 0.1.602 B1)", () => {
    const path = "test/shared.test.ts";
    const pair = [
      testFile(path, [path, "src/a.ts"], { project: "node", seconds: 2 }),
      testFile(path, [path, "src/a.ts"], { project: "browser", seconds: 5 }),
    ];
    for (const order of [pair, [...pair].reverse()]) {
      const out = buildReport(
        snapshot(order, {
          edits: [
            { at: 1, paths: [path] },
            { at: 2, paths: ["src/a.ts"] },
          ],
        }),
        { ...OPTIONS, listed: 2 },
      );
      expect(out.suite.seconds).toBe(7);
      expect(out.window?.rerunSeconds).toBe(14);
      expect(out.byEdits[0]?.editShare).toBe(0.5);
    }
    // A multi-file edit touching both the shared test path and its source counts each project once.
    const both = buildReport(snapshot(pair, { edits: [{ at: 1, paths: [path, "src/a.ts"] }] }), {
      ...OPTIONS,
      listed: 2,
    });
    expect(both.window?.rerunSeconds).toBe(7);
  });

  it("does not collapse files with differing child-process and runtime-read observations (review 0.1.602 B2)", () => {
    const paths = ["src/a.ts", "src/b.ts"];
    const mixed = [
      testFile("test/x.test.ts", ["test/x.test.ts", ...paths], {
        seconds: 4,
        childProcess: new Set(paths),
      }),
      testFile("test/y.test.ts", ["test/y.test.ts", ...paths], {
        seconds: 2,
        runtimeRead: new Set(paths),
      }),
      testFile("test/z.test.ts", ["test/z.test.ts", ...paths], {
        seconds: 1,
        childProcess: new Set(["src/a.ts"]),
        runtimeRead: new Set(["src/b.ts"]),
      }),
    ];
    const snapMixed = snapshot(mixed, { edits: [{ at: 1, paths }] });
    const ranked = buildReport(snapMixed, { ...OPTIONS, listed: 3 });
    const named = buildReport(snapMixed, { ...OPTIONS, paths, listed: 3 });
    expect(ranked.files.map((e) => e.files)).toEqual([["src/a.ts"], ["src/b.ts"]]);
    for (const p of paths) {
      const fromRanked = ranked.files.find((e) => e.files[0] === p)?.note;
      const fromNamed = named.named?.find((e) => e.path === p)?.note;
      expect(fromRanked).toBe(fromNamed);
    }
    expect(ranked.files[0]?.note).toContain("1 test file reads src/a.ts at run time");
    expect(ranked.files[0]?.note).toContain("2 test files load src/a.ts in a process they start");
    expect(ranked.files[1]?.note).toContain("2 test files read src/b.ts at run time");
    expect(ranked.files[1]?.note).toContain("1 test file loads src/b.ts in a process it starts");
  });

  it("preserves project identity for broad readers in ranked, named and gateway notes (review 0.1.602 B2)", () => {
    const path = "test/daemon/shared.test.ts";
    const obs = [...modules, "package.json"];
    const pair = [
      testFile(path, [path, ...obs], { project: "node", seconds: 2, runtimeRead: new Set(obs) }),
      testFile(path, [path, ...obs], { project: "browser", seconds: 5, runtimeRead: new Set(obs) }),
    ];
    const snapPair = snapshot(pair, {
      edits: [
        { at: 1, paths: ["src/m0.ts"] },
        { at: 2, paths: ["package.json"] },
      ],
    });
    const out = buildReport(snapPair, {
      ...OPTIONS,
      paths: ["src/m0.ts", "package.json"],
      listed: 2,
    });
    const modEntry = out.files.find((e) => e.files.includes("src/m0.ts"));
    expect(modEntry?.testFiles).toBe(2);
    expect(modEntry?.note).toContain("2 test files read these files among many source modules");
    expect(modEntry?.note).toContain("test/daemon/shared.test.ts (2, 10 modules)");
    const namedMod = out.named?.find((e) => e.path === "src/m0.ts");
    expect(namedMod?.note).toContain("2 test files read src/m0.ts among many source modules");
    const pkgGw = out.gateways.find((g) => g.gateway === "package.json");
    expect(pkgGw?.testFiles).toBe(2);
    expect(pkgGw?.note).toBe(
      "2 test files read package.json at run time, outside their imports: 2 among many source modules, as tests that start or bundle the program from source do: test/daemon/shared.test.ts (2, 10 modules)",
    );
    const broadGw = out.gateways.find((g) => g.mode === "broad test reader");
    expect(broadGw).toMatchObject({ gateway: path, testFiles: 2 });
    expect(broadGw?.note).toContain("test/daemon/shared.test.ts (2, 10 modules)");
  });
});
