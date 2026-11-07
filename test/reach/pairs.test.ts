import { describe, expect, it } from "vitest";
import { isHelperPath, siblingsAmong } from "../../src/core/reach/names.js";
import { type Pair, PairContext, pairsOf } from "../../src/core/reach/pairs.js";
import type { CoverageView } from "../../src/core/reach/types.js";
import type { CheckRunner } from "../../src/core/types/check-groups.js";
import { fakeGraph, NONE, record, snapshot, testFile } from "./fixture.js";

/* Row 015-109 (spec 015 D11): each pair's path kind, chain, gateway and coverage state. */

const T = "test/a.test.ts";

function byPath(pairs: Pair[]): Record<string, Pair> {
  return Object.fromEntries(pairs.map((p) => [p.path, p]));
}

describe("path kinds", () => {
  const graph = fakeGraph(
    {
      [T]: ["src/direct.ts", "src/index.ts", "test/helpers.ts", "src/app.ts"],
      "src/index.ts": ["src/types.ts"],
      "test/helpers.ts": ["src/deep.ts"],
      "src/app.ts": ["src/registry.ts"],
      "src/registry.ts": ["src/leaf.ts"],
      "src/direct.ts": [],
      "src/types.ts": [],
      "src/deep.ts": [],
      "src/leaf.ts": [],
      "vitest.config.ts": ["test/setup.ts", "src/reporter.ts"],
      "test/setup.ts": ["src/env.ts"],
      "src/reporter.ts": [],
      "src/env.ts": [],
    },
    { "": ["vitest.config.ts", "test/setup.ts", "src/env.ts", "src/reporter.ts"] },
  );
  const closure = [
    T,
    "src/direct.ts",
    "src/index.ts",
    "src/types.ts",
    "test/helpers.ts",
    "src/deep.ts",
    "src/app.ts",
    "src/registry.ts",
    "src/leaf.ts",
    "fixtures/data.json",
    "dist/cli.js",
    "src/",
    "test/b.test.ts",
  ];
  const test = testFile(T, closure, {
    childProcess: new Set(["dist/cli.js"]),
    runtimeRead: new Set(["src/leaf.ts"]),
  });
  const other = testFile("test/b.test.ts", []);
  const snap = snapshot([test, other], {
    graph,
    barrels: ["src/index.ts"],
    declared: { "fixtures/data.json": { tests: "test/**", input: "fixtures/**" } },
  });
  const pairs = byPath(pairsOf(test, new PairContext(snap)));

  it("gives each source one kind, the strongest, and leaves out tests and listings", () => {
    expect(Object.fromEntries(Object.entries(pairs).map(([p, x]) => [p, x.kind]))).toEqual({
      "src/direct.ts": "direct",
      "src/index.ts": "direct",
      "src/types.ts": "barrel",
      "test/helpers.ts": "direct",
      "src/deep.ts": "test helper",
      "src/app.ts": "direct",
      "src/registry.ts": "transitive",
      "src/leaf.ts": "runtime read",
      "fixtures/data.json": "declared input",
      "dist/cli.js": "child process",
      "vitest.config.ts": "setup",
      "test/setup.ts": "setup",
      "src/env.ts": "setup",
      "src/reporter.ts": "setup",
    });
  });

  it("names the gateway and one shortest chain", () => {
    expect(pairs["src/types.ts"]).toMatchObject({
      gateway: "src/index.ts",
      chain: [T, "src/index.ts", "src/types.ts"],
    });
    expect(pairs["src/deep.ts"]?.gateway).toBe("test/helpers.ts");
    expect(pairs["src/registry.ts"]).toMatchObject({
      gateway: "src/app.ts",
      chain: [T, "src/app.ts", "src/registry.ts"],
    });
    expect(pairs["src/direct.ts"]?.gateway).toBe(T);
    expect(pairs["fixtures/data.json"]?.declared).toEqual({
      tests: "test/**",
      input: "fixtures/**",
    });
  });

  it("chains a setup pair from the file the runner loads first", () => {
    expect(pairs["src/env.ts"]).toMatchObject({
      chain: ["vitest.config.ts", "test/setup.ts", "src/env.ts"],
      gateway: "test/setup.ts",
    });
    expect(pairs["vitest.config.ts"]?.chain).toEqual(["vitest.config.ts"]);
  });

  it("without the stored edges, reads import unsplit and has no setup pairs", () => {
    const plain = byPath(
      pairsOf(test, new PairContext(snapshot([test, other], { barrels: ["src/index.ts"] }))),
    );
    expect(plain["src/types.ts"]).toMatchObject({ kind: "import", chain: [], gateway: null });
    expect(plain["src/env.ts"]).toBeUndefined();
    expect(plain["src/leaf.ts"]?.kind).toBe("runtime read");
  });

  it("marks an import pair the edges do not reach yet as not recorded", () => {
    const partial = fakeGraph({ [T]: ["src/a.ts"] });
    const t = testFile(T, [T, "src/a.ts", "src/b.ts"]);
    const p = byPath(pairsOf(t, new PairContext(snapshot([t], { graph: partial }))));
    expect(p["src/a.ts"]?.kind).toBe("direct");
    expect(p["src/b.ts"]).toMatchObject({ kind: "import", notRecorded: true });
  });

  it("reads a closure path that is no module as a runtime read, never an import", () => {
    const t = testFile(T, [T, "src/a.ts", "test/__snapshots__/a.test.ts.snap", "data.json"]);
    const kinds = (graph: ReturnType<typeof fakeGraph> | null) =>
      pairsOf(t, new PairContext(snapshot([t], { graph }))).map((p) => [p.path, p.kind]);
    expect(kinds(null)).toEqual([
      ["src/a.ts", "import"],
      ["test/__snapshots__/a.test.ts.snap", "runtime read"],
      ["data.json", "runtime read"],
    ]);
    expect(kinds(fakeGraph({ [T]: ["src/a.ts", "data.json"] }))).toEqual([
      ["src/a.ts", "direct"],
      ["test/__snapshots__/a.test.ts.snap", "runtime read"],
      ["data.json", "direct"],
    ]);
  });

  it("asks the graph once per file, however many test files walk it", () => {
    const asked: string[] = [];
    const inner = fakeGraph({ "test/a.test.ts": ["src/a.ts"], "test/b.test.ts": ["src/a.ts"] });
    const graph = {
      ...inner,
      targets: (p: string, project: string) => {
        asked.push(p);
        return inner.targets(p, project);
      },
    };
    const tests = ["test/a.test.ts", "test/b.test.ts"].map((t) => testFile(t, [t, "src/a.ts"]));
    const context = new PairContext(snapshot(tests, { graph }));
    for (const t of tests) pairsOf(t, context);
    expect(asked.sort()).toEqual(["src/a.ts", "test/a.test.ts", "test/b.test.ts"]);
  });

  it("walks dynamic imports too", () => {
    const g = fakeGraph({ [T]: [], "src/lazy.ts": [] }, {}, { [T]: ["src/lazy.ts"] });
    const t = testFile(T, [T, "src/lazy.ts"]);
    expect(pairsOf(t, new PairContext(snapshot([t], { graph: g })))[0]?.kind).toBe("direct");
  });
});

describe("coverage per pair", () => {
  const graph = fakeGraph({ [T]: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"] });
  const closure = [T, "src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "fixtures/x.json"];
  const declared = { "fixtures/x.json": { tests: null, input: "fixtures/**" } };
  const states = (coverage: CoverageView, runner: CheckRunner = "vitest") => {
    const t = testFile(T, closure, { coverage, runner });
    const snap = snapshot([t], { graph, declared });
    return Object.fromEntries(pairsOf(t, new PairContext(snap)).map((p) => [p.path, p.coverage]));
  };

  it("reads called, loaded only, not loaded, unread and outside the test's process", () => {
    expect(states(record(["src/a.ts"], ["src/b.ts"], ["src/c.ts"]))).toEqual({
      "src/a.ts": "called",
      "src/b.ts": "loaded only",
      "src/c.ts": "unread",
      "src/d.ts": "not loaded",
      "fixtures/x.json": "outside the test's process",
    });
  });

  it("reads no record without a record at the current key", () => {
    expect(new Set(Object.values(states(NONE)))).toEqual(new Set(["no record"]));
  });

  it("reads unknown with coverage off and for a runner without records", () => {
    expect(new Set(Object.values(states({ kind: "unknown" }, "pytest")))).toEqual(
      new Set(["unknown"]),
    );
  });
});

describe("name rules settled against squeal and cezar", () => {
  it("counts test folders and test kits as helpers", () => {
    for (const path of [
      "test/scheduler/helpers.ts",
      "packages/cezar/src/core/harness-parity.testkit.ts",
      "packages/web/e2e/environment.ts",
      "scripts/test-sandbox.mjs",
      "packages/cezar/src/__tests__/util.ts",
    ]) {
      expect(isHelperPath(path), path).toBe(true);
    }
    for (const path of ["src/core/state/index.ts", "packages/cezar/src/core/runner-factory.ts"]) {
      expect(isHelperPath(path), path).toBe(false);
    }
  });

  it("finds the runner factory's sibling runners", () => {
    const targets = [
      "core/agent-runner.ts",
      "core/claude-cli-runner.ts",
      "core/codex-app-server-runner.ts",
      "core/pi-runner.ts",
      "core/store.ts",
    ];
    expect(siblingsAmong("core/pi-runner.ts", targets)).toHaveLength(4);
    expect(siblingsAmong("core/store.ts", targets)).toEqual(["core/store.ts"]);
    expect(
      siblingsAmong("src/runners/vitest/adapter.ts", [
        "src/runners/vitest/adapter.ts",
        "src/runners/node-test/adapter.ts",
      ]),
    ).toHaveLength(2);
  });
});
