import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enumerate, enumerateSource } from "../../../src/runners/node-test/enumerate.js";
import { createNodeTestGraph } from "../../../src/runners/node-test/graph/index.js";

/**
 * Spec 003 D6: static enumeration gives a file's checks before it has run, in
 * the names a run produces (D2). The expected names come from a live run of
 * the fixtures with the fixture reporter, derived by the D2 rule.
 */

const fixtures = resolve(import.meta.dirname, "../../fixtures/node-test");
const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-enumerate-"));
const SLOW = { timeout: 60_000 } as const;

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface TestEvent {
  readonly type: string;
  readonly data: {
    readonly name: string;
    readonly nesting: number;
    readonly file?: string;
    readonly line?: number;
    readonly column?: number;
    readonly details?: { readonly type?: string };
  };
}

interface Named {
  readonly file: string;
  readonly fullName: string;
  readonly line: number;
  readonly column: number;
}

/** Runs `files` with the fixture reporter, as spec 003 D5 runs a tier, and returns its events. */
function record(cwd: string, argv: readonly string[], files: readonly string[]) {
  const destination = join(scratch, `${randomUUID()}.ndjson`);
  const args = [
    "--enable-source-maps",
    ...argv,
    "--test",
    `--test-reporter=${join(fixtures, "reporter.mjs")}`,
    `--test-reporter-destination=${destination}`,
    ...files,
  ];
  return new Promise<TestEvent[]>((done, fail) => {
    const child = spawn(process.execPath, args, { cwd, stdio: "ignore" });
    child.on("error", fail);
    child.on("close", () => {
      const text = readFileSync(destination, "utf8").trim();
      done(text.split("\n").map((line) => JSON.parse(line) as TestEvent));
    });
  });
}

/**
 * D2's rule over one event stream: a full name joins the names of the started
 * tests above it by nesting with ` > `; suites are prefixes, never checks; the
 * second and later tests of one file sharing a full name carry their line.
 */
function runNames(events: readonly TestEvent[]): Named[] {
  const key = (e: TestEvent) => `${e.data.file}:${e.data.line}:${e.data.column}:${e.data.nesting}`;
  const started: Named[] = [];
  const byKey = new Map<string, Named>();
  const stack: string[] = [];
  for (const event of events) {
    if (event.type !== "test:start") continue;
    stack.length = event.data.nesting;
    stack.push(event.data.name);
    const named = {
      file: event.data.file ?? "",
      fullName: stack.join(" > "),
      line: event.data.line ?? 0,
      column: event.data.column ?? 0,
    };
    started.push(named);
    byKey.set(key(event), named);
  }
  const checks = new Set<Named>();
  for (const event of events) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const named = byKey.get(key(event));
    if (named && event.data.details?.type === "test") checks.add(named);
  }
  const used = new Set<string>();
  return started
    .filter((named) => checks.has(named))
    .map((named) => {
      const seen = `${named.file}\0${named.fullName}`;
      let fullName = named.fullName;
      if (used.has(seen)) {
        fullName = `${named.fullName} (line ${named.line})`;
        for (let n = 2; used.has(`${named.file}\0${fullName}`); n++) {
          fullName = `${named.fullName} (line ${named.line}, ${n})`;
        }
      }
      used.add(`${named.file}\0${fullName}`);
      return { ...named, fullName };
    });
}

async function enumerated(cwd: string, files: readonly string[]): Promise<Named[]> {
  const out: Named[] = [];
  for (const file of files) {
    const absolute = join(cwd, file);
    const checks = await enumerate(absolute, { project: "p", path: file });
    for (const { check, location, templated } of checks) {
      expect(templated).toBe(false);
      out.push({
        file: absolute,
        fullName: check.fullName,
        line: location?.line ?? 0,
        column: location?.column ?? 0,
      });
    }
  }
  return out;
}

const sorted = (names: readonly Named[]) =>
  [...names].sort((a, b) =>
    `${a.file}:${a.line}:${a.column}`.localeCompare(`${b.file}:${b.line}:${b.column}`),
  );

describe("enumerate against a run", () => {
  const edge = join(fixtures, "edge");
  const demo = join(fixtures, "reference/packages/demo");
  const edgeFiles = [
    "test/forms.test.ts",
    "test/pass.test.ts",
    "test/fail.test.ts",
    "test/duplicate.test.ts",
  ];
  const demoFiles = [
    "test/unit/math.test.ts",
    "test/unit/title.test.ts",
    "test/e2e/package.test.ts",
  ];
  let edgeRun: Named[] = [];
  let demoRun: Named[] = [];

  beforeAll(async () => {
    [edgeRun, demoRun] = await Promise.all([
      record(edge, ["--import", "tsx"], edgeFiles).then(runNames),
      record(demo, ["--import", "../../scripts/preload.mjs", "--import", "tsx"], demoFiles).then(
        runNames,
      ),
    ]);
  }, 60_000);

  it("lists the edge fixture's checks as the run names them", SLOW, async () => {
    expect(edgeRun.length).toBeGreaterThan(20);
    expect(sorted(await enumerated(edge, edgeFiles))).toEqual(sorted(edgeRun));
  });

  it("lists the reference fixture's checks as the run names them", SLOW, async () => {
    expect(demoRun.map((n) => n.fullName)).toContain("title > slugs through the workspace package");
    expect(sorted(await enumerated(demo, demoFiles))).toEqual(sorted(demoRun));
  });

  it("suffixes the duplicates of duplicate.test.ts with their original lines", async () => {
    const checks = await enumerate(join(edge, "test/duplicate.test.ts"), {
      project: "edge",
      path: "test/duplicate.test.ts",
    });
    expect(checks.map((c) => [c.check.fullName, c.location?.line])).toEqual([
      ["suite > same name", 5],
      ["suite > same name (line 6)", 6],
      ["same name", 8],
      ["same name (line 9)", 9],
    ]);
    expect(checks[0]).toEqual({
      check: {
        kind: "test",
        project: "edge",
        testPath: "test/duplicate.test.ts",
        fullName: "suite > same name",
      },
      templated: false,
      location: { path: "test/duplicate.test.ts", line: 5, column: 3 },
    });
  });

  it("enumerates nothing for a file that does not parse", async () => {
    expect(
      await enumerate(join(edge, "test/syntax.test.ts"), {
        project: "edge",
        path: "test/syntax.test.ts",
      }),
    ).toEqual([]);
  });
});

const ref = { project: "p", path: "a.test.ts" };
const names = (source: string) =>
  enumerateSource(source, ref).map((c) =>
    c.templated ? `~${c.check.fullName}` : c.check.fullName,
  );

describe("enumerateSource", () => {
  it("makes a loop-built name one templated entry", () => {
    const source = [
      `import { test } from "node:test";`,
      "for (const n of [1, 2, 3]) {",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture's own template literal.
      "  test(`adds ${n}`, () => {});",
      "}",
    ].join("\n");
    const checks = enumerateSource(source, ref);
    expect(checks).toEqual([
      {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the template's source text.
        check: { kind: "test", project: "p", testPath: "a.test.ts", fullName: "`adds ${n}`" },
        templated: true,
        location: { path: "a.test.ts", line: 3, column: 3 },
      },
    ]);
  });

  it("makes a non-literal suite one templated entry and does not guess its children", () => {
    const source = `import { describe, it } from "node:test";\nconst s = "x";\ndescribe(s, () => { it("a", () => {}); });`;
    expect(names(source)).toEqual(["~s"]);
  });

  it("enumerates nothing for a file with an enum", () => {
    const source = `import { test } from "node:test";\nenum Color { Red }\ntest("red", () => {});`;
    expect(enumerateSource(source, ref)).toEqual([]);
  });

  it("reads skip, todo, only, options, templates and subtests", () => {
    const source = [
      `import { describe, it, suite, test } from "node:test";`,
      `const n: number = 1;`,
      "test.skip(`skipped`, () => {});",
      `test.todo("todo");`,
      `test("with options", { skip: true }, () => {});`,
      `it.only("only", () => {});`,
      `describe.skip("outer", () => {`,
      `  suite("inner", () => { it("leaf", () => {}); });`,
      `});`,
      `test("parent", async (t) => {`,
      `  await t.test("child", async (c) => { await c.test("grandchild", () => {}); });`,
      `});`,
      `test("x", () => {});`,
      `test("x", () => {});`,
    ].join("\n");
    expect(names(source)).toEqual([
      "skipped",
      "todo",
      "with options",
      "only",
      "parent",
      "parent > child",
      "parent > child > grandchild",
      "x",
      "x (line 14)",
    ]);
  });

  it("follows node:test aliases, the default export and a namespace", () => {
    const source = [
      `import nodeTest, { describe as group, it as check } from "node:test";`,
      `import * as nt from "node:test";`,
      `group("g", () => { check("c", () => {}); });`,
      `nodeTest("default", () => {});`,
      `nt.test("namespaced", () => {});`,
      `nt.describe.skip("ns suite", () => { nt.it("leaf", () => {}); });`,
    ].join("\n");
    expect(names(source)).toEqual(["g > c", "default", "namespaced"]);
  });

  it("does not descend into a skipped suite or test, which a run never enters", () => {
    const source = [
      `import { describe, it, test } from "node:test";`,
      `describe("by option", { skip: true }, () => { it("a", () => {}); });`,
      `describe("by reason", { skip: "later" }, () => { it("a", () => {}); });`,
      `describe("computed", { skip: process.platform === "win32" }, () => { it("a", () => {}); });`,
      `describe.todo("todo", () => { it("a", () => {}); });`,
      `test.skip("parent", async (t) => { await t.test("child", () => {}); });`,
    ].join("\n");
    expect(names(source)).toEqual(["computed > a", "todo > a", "parent"]);
  });

  it("names a function-only call by the function, as a run does", () => {
    const source = [
      `import { test } from "node:test";`,
      `test(async function named(t) { await t.test("child", () => {}); });`,
      `test(() => {});`,
      `test({ skip: false }, function withOptions() {});`,
    ].join("\n");
    const checks = enumerateSource(source, ref);
    expect(checks.map((c) => c.check.fullName)).toEqual([
      "named",
      "named > child",
      "<anonymous>",
      "withOptions",
    ]);
    expect(checks.every((c) => !c.templated)).toBe(true);
  });

  it("adds an ordinal to duplicates on one line", () => {
    expect(
      names(
        `import { test } from "node:test";\ntest("a", () => {}); test("a", () => {}); test("a", () => {});`,
      ),
    ).toEqual(["a", "a (line 2)", "a (line 2, 2)"]);
  });

  it("keeps stripTypeScriptTypes' ExperimentalWarning off the process's stderr", SLOW, () => {
    const module = resolve(import.meta.dirname, "../../../src/runners/node-test/enumerate.ts");
    const script = [
      `const { enumerateSource } = await import(${JSON.stringify(module)});`,
      `enumerateSource('import { test } from "node:test"; test("a", () => {});', { project: "p", path: "a.ts" });`,
      `process.emitWarning("still mine", "ExperimentalWarning");`,
    ].join("\n");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/stripTypeScriptTypes/);
    expect(result.stderr).toMatch(/still mine/);
  });

  it("parses a CommonJS test file", () => {
    expect(names(`const { test } = require("node:test");\ntest("cjs", () => {});`)).toEqual([
      "cjs",
    ]);
  });
});

describe("enumeration cost", () => {
  // Review wave 2: a fixed 200 ms failed under the full suite's load. The bound is a ratio
  // to the cold graph build of the same 1,000-module fixture, measured between the rounds
  // in this process, so load slows both. At calm load enumeration took about 40 ms and the
  // build about 190 ms; best of three of each.
  it("enumerates 200 generated test files in under half a cold graph build", SLOW, async () => {
    const out = join(scratch, "big");
    execFileSync(process.execPath, [join(fixtures, "gen-big.mjs"), out]);
    const dir = join(out, "packages/core/test");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => join(dir, f));
    expect(files).toHaveLength(200);
    // `stripTypeScriptTypes` loads its WebAssembly once per process, about 90 ms; it is
    // loaded before timing, as a running daemon has it.
    enumerateSource(`test("warm", () => {});`, ref);
    let enumeration = Number.POSITIVE_INFINITY;
    let build = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 3; round++) {
      let start = performance.now();
      const all = await Promise.all(
        files.map((f) => enumerate(f, { project: "big", path: relative(out, f) })),
      );
      enumeration = Math.min(enumeration, performance.now() - start);
      expect(all.every((checks) => checks.length > 0)).toBe(true);
      start = performance.now();
      const graph = await createNodeTestGraph({
        root: out,
        cwd: join(out, "packages/core"),
        argv: ["--import", "../../scripts/preload.mjs", "--import", "tsx"],
        testFiles: files.map((f) => relative(out, f)),
      });
      graph.affected([]);
      build = Math.min(build, performance.now() - start);
    }
    expect(enumeration / build, `${enumeration} ms against ${build} ms`).toBeLessThan(0.5);
  });
});
