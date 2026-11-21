import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { RelativePath } from "../../../src/core/types/common.js";
import type { NodeTestProject } from "../../../src/core/types/policy.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import { createNodeTestGraph } from "../../../src/runners/node-test/graph/index.js";
import { MANIFEST, observedClosure } from "./graph-observed.js";

/**
 * Row 018-66, the guard: Squeal's static closure of a test file holds every
 * module a real `node --test` run of it loads. Each case is a small project
 * generated under the repository (so `--import tsx` finds tsx); the run loads
 * its modules through `observedClosure`'s `module.registerHooks` recorder.
 * A closure one path too wide only costs a re-run; one path short is a wrong
 * pass, so the check is containment, plus `affected` selecting the test when
 * a module the run loads changes. Reviews `0.1.585.md` (B1, B2) and
 * `0.1.585-r2.md` (B4) are cases here.
 */

const scratch = join(
  resolve(import.meta.dirname, "../../fixtures/node-test"),
  ".tmp",
  randomUUID(),
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const SLOW = { timeout: 60_000 } as const;
const TSX = ["--import", "tsx"] as const;

interface Case {
  /** Every file of the project; a root `package.json` (ESM) and an empty `tsconfig.json` are added when absent. */
  readonly files: Readonly<Record<string, string>>;
  /** The test file, relative to the project root. */
  readonly test: string;
  /** Modules the run must load, relative to the root: the case's own guard. */
  readonly loads: readonly string[];
  /** The process's directory, relative to the root. Default the root. */
  readonly cwd?: string;
  /** `TSX_TSCONFIG_PATH` for the run and the project's env in `squeal.config.json`. */
  readonly tsconfigPath?: string;
  readonly argv?: readonly string[];
}

let count = 0;
function tree(files: Readonly<Record<string, string>>): string {
  const root = join(scratch, `t${count++}`);
  const all = {
    "package.json": `${JSON.stringify({ name: "differential", private: true, type: "module" })}\n`,
    "tsconfig.json": "{}\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return realpathSync(root);
}

/** What the run loads, with `TSX_TSCONFIG_PATH` set for it alone. */
function observed(root: string, c: Case): string[] {
  const cwd = join(root, c.cwd ?? "");
  const before = process.env.TSX_TSCONFIG_PATH;
  if (c.tsconfigPath === undefined) delete process.env.TSX_TSCONFIG_PATH;
  else process.env.TSX_TSCONFIG_PATH = c.tsconfigPath;
  try {
    return observedClosure(root, cwd, c.argv ?? TSX, relative(cwd, join(root, c.test)));
  } finally {
    if (before === undefined) delete process.env.TSX_TSCONFIG_PATH;
    else process.env.TSX_TSCONFIG_PATH = before;
  }
}

/**
 * Squeal's closure and the test files a change to each loaded module
 * selects. A project with `TSX_TSCONFIG_PATH` goes through the adapter, as
 * `squeal.config.json` gives it; one whose test sits outside its `cwd`
 * through the graph, since a project's globs stay under its `cwd`.
 */
async function squeal(root: string, c: Case, loads: readonly string[]) {
  if (c.tsconfigPath !== undefined) {
    const project: NodeTestProject = {
      name: "p",
      node: process.execPath,
      argv: c.argv ?? TSX,
      env: { TSX_TSCONFIG_PATH: c.tsconfigPath },
      include: [relative(join(root, c.cwd ?? ""), join(root, c.test))],
      ...(c.cwd === undefined ? {} : { cwd: c.cwd }),
    };
    const adapter = await createNodeTestAdapter(project, { root, note: () => {} });
    try {
      const closure = await adapter.closure({ project: "p", path: c.test });
      const selected = [];
      for (const path of loads) {
        const affected = await adapter.affected([path]);
        selected.push([...affected.direct, ...affected.transitive].map((ref) => ref.path));
      }
      return { paths: closure.paths, incomplete: [] as readonly string[], selected };
    } finally {
      await adapter.close();
    }
  }
  const graph = await createNodeTestGraph({
    root,
    cwd: join(root, c.cwd ?? ""),
    argv: c.argv ?? TSX,
    testFiles: [c.test as RelativePath],
  });
  const closure = graph.closure(c.test as RelativePath);
  const selected = loads.map((path) => {
    const affected = graph.affected([path as RelativePath]);
    return [...affected.direct, ...affected.transitive];
  });
  return { paths: closure.paths, incomplete: closure.incomplete, selected };
}

async function differential(c: Case) {
  const root = tree(c.files);
  const loads = observed(root, c);
  expect(loads).toEqual(expect.arrayContaining([c.test, ...c.loads]));
  const ours = await squeal(root, c, loads);
  expect(ours.incomplete).toEqual([]);
  const modules = ours.paths.filter((p) => !MANIFEST.test(p));
  expect(modules).toEqual(expect.arrayContaining(loads));
  for (const [i, path] of loads.entries()) {
    expect(ours.selected[i], `a change to ${path}`).toContain(c.test);
  }
}

const lines = (...text: string[]) => `${text.join("\n")}\n`;
const ASSERT = 'import assert from "node:assert/strict";';
const TEST = 'import { test } from "node:test";';
const DEP = lines('console.log("LOADED_DEP");', "export const Value = 2;");
const json = (value: object) => `${JSON.stringify(value)}\n`;

/** A test whose assertion passes only when `dep` loaded, after `body`. */
const valueTest = (specifier: string, ...body: string[]) =>
  lines(ASSERT, TEST, `import { Value } from "${specifier}";`, ...body);
const usesValue = 'test("v", () => assert.equal(result, 2));';

/** Reviews `0.1.585.md` B1 and B2, and the forms of import tsx compiles. */
const FORMS: Record<string, Case> = {
  "B1: an import of a value named `type`, renamed": {
    files: {
      "dep.ts": lines('console.log("LOADED_DEP");', "export const type = 2;"),
      "a.test.ts": lines(
        ASSERT,
        TEST,
        'import { type as Value } from "./dep.ts";',
        'test("v", () => assert.equal(Value, 2));',
      ),
    },
    test: "a.test.ts",
    loads: ["dep.ts"],
  },
  "B2: a division by a keyword-named property before the value's use": {
    files: {
      "dep.ts": DEP,
      "a.test.ts": valueTest(
        "./dep.ts",
        "const result = ({ return: 8 }).return / Value / 2;",
        usesValue,
      ),
    },
    test: "a.test.ts",
    loads: ["dep.ts"],
  },
  "B2: a division of an object literal before the value's use": {
    files: {
      "dep.ts": DEP,
      "a.test.ts": valueTest(
        "./dep.ts",
        "const result = { valueOf: () => 8 } / Value / 2;",
        usesValue,
      ),
    },
    test: "a.test.ts",
    loads: ["dep.ts"],
  },
  "a value re-export": {
    files: {
      "dep.ts": DEP,
      "re.ts": 'export { Value } from "./dep.ts";\n',
      "a.test.ts": valueTest("./re.ts", "const result = Value;", usesValue),
    },
    test: "a.test.ts",
    loads: ["re.ts", "dep.ts"],
  },
  "a star re-export": {
    files: {
      "dep.ts": DEP,
      "re.ts": 'export * from "./dep.ts";\n',
      "a.test.ts": valueTest("./re.ts", "const result = Value;", usesValue),
    },
    test: "a.test.ts",
    loads: ["re.ts", "dep.ts"],
  },
  "an enum initialised from an import": {
    files: {
      "dep.ts": DEP,
      "a.test.ts": valueTest("./dep.ts", "enum E { a = Value }", "const result = E.a;", usesValue),
    },
    test: "a.test.ts",
    loads: ["dep.ts"],
  },
  "a side-effect import": {
    files: {
      "dep.ts": lines("(globalThis as { v?: number }).v = 2;", "export {};"),
      "a.test.ts": lines(
        ASSERT,
        TEST,
        'import "./dep.ts";',
        'test("v", () => assert.equal((globalThis as { v?: number }).v, 2));',
      ),
    },
    test: "a.test.ts",
    loads: ["dep.ts"],
  },
  "`import type` beside a value import of the same module": {
    files: {
      "dep.ts": lines(DEP, "export type T = number;"),
      "a.test.ts": lines(
        ASSERT,
        TEST,
        'import type { T } from "./dep.ts";',
        'import { Value } from "./dep.ts";',
        "const result: T = Value;",
        usesValue,
      ),
    },
    test: "a.test.ts",
    loads: ["dep.ts"],
  },
  "an inline `type` beside a value in one import": {
    files: {
      "dep.ts": lines(DEP, "export type T = number;"),
      "a.test.ts": lines(
        ASSERT,
        TEST,
        'import { type T, Value } from "./dep.ts";',
        "const result: T = Value;",
        usesValue,
      ),
    },
    test: "a.test.ts",
    loads: ["dep.ts"],
  },
  "a `?query` and a `#hash` on a static and a dynamic import": {
    files: {
      "dep.ts": DEP,
      "other.mjs": "export const other = 1;\n",
      "a.test.ts": lines(
        ASSERT,
        TEST,
        'import { Value } from "./dep.ts?query=1";',
        'test("v", async () => {',
        '  const { other } = await import("./other.mjs#hash");',
        "  assert.equal(Value + other, 3);",
        "});",
      ),
    },
    test: "a.test.ts",
    loads: ["dep.ts", "other.mjs"],
  },
  ".tsx with a JSX element": {
    files: {
      "dep.ts": DEP,
      "a.test.tsx": valueTest(
        "./dep.ts",
        "const React = { createElement: (_t: unknown, p: { v: number }) => p.v };",
        "const result = <div v={Value} />;",
        usesValue,
      ),
    },
    test: "a.test.tsx",
    loads: ["dep.ts"],
  },
};

/** Review `0.1.585.md` B2's CommonJS case, under Node's own rules and under tsx. */
const REQUIRE_FILES = {
  "dep.cjs": lines('console.log("LOADED_DEP");', "module.exports = 2;"),
  "a.test.cjs": lines(
    'const { test } = require("node:test");',
    'const assert = require("node:assert/strict");',
    'const result = { valueOf: () => 8 } / require("./dep.cjs") / 2;',
    usesValue,
  ),
};
for (const [rules, argv] of [
  ["Node's rules", []],
  ["tsx", TSX],
] as const) {
  FORMS[`B2: a literal require after a division of an object literal, ${rules}`] = {
    files: REQUIRE_FILES,
    test: "a.test.cjs",
    loads: ["dep.cjs"],
    argv,
  };
}

/**
 * Review `0.1.585-r2.md` B4, generated: tsx 4 reads one tsconfig for the
 * process (`TSX_TSCONFIG_PATH` relative to the cwd, else the nearest from
 * the cwd up) and maps every importer outside `node_modules` with it. The
 * config sits in `run/`; the importer inside or outside that folder; the
 * alias a wildcard, an exact pattern, or a bare name under `baseUrl`.
 */
const ALIASES = {
  "a wildcard path": { options: { paths: { "~/*": ["./*"] } }, specifier: "~/dep" },
  "an exact path": { options: { paths: { "@dep": ["./dep.ts"] } }, specifier: "@dep" },
  "a baseUrl name": { options: { baseUrl: "." }, specifier: "dep" },
};
const IMPORTERS = { "outside its folder": "lib/use.ts", "inside its folder": "run/sub/use.ts" };
const SELECTED = {
  "from the cwd": { cwd: "run" },
  "by TSX_TSCONFIG_PATH": { tsconfigPath: "run/tsconfig.json" },
};

const B4: Record<string, Case> = {};
for (const [alias, { options, specifier }] of Object.entries(ALIASES)) {
  for (const [where, importer] of Object.entries(IMPORTERS)) {
    for (const [how, selection] of Object.entries(SELECTED)) {
      B4[`${alias}, an importer ${where}, the tsconfig ${how}`] = {
        files: {
          "run/tsconfig.json": json({ compilerOptions: options }),
          "run/dep.ts": DEP,
          [importer]: lines(`import { Value } from "${specifier}";`, "export { Value };"),
          "test/a.test.ts": valueTest(`../${importer}`, "const result = Value;", usesValue),
        },
        test: "test/a.test.ts",
        loads: [importer, "run/dep.ts"],
        ...selection,
      };
    }
  }
}

/** The importer's nearest tsconfig maps the alias elsewhere; tsx uses the one from the cwd. */
B4["the importer's nearest tsconfig is not the one tsx reads"] = {
  files: {
    "tsconfig.json": json({ compilerOptions: { paths: { "~/*": ["./src/*"] } } }),
    "lib/tsconfig.json": json({ compilerOptions: { paths: { "~/*": ["./other/*"] } } }),
    "lib/x.ts": lines('import { Value } from "~/dep";', "export { Value };"),
    "src/dep.ts": DEP,
    "lib/other/dep.ts": "export const Value = 3;\n",
    "a.test.ts": valueTest("./lib/x.ts", "const result = Value;", usesValue),
  },
  test: "a.test.ts",
  loads: ["lib/x.ts", "src/dep.ts"],
};

B4["an alias whose first target names no file, from outside the tsconfig's folder"] = {
  files: {
    "run/tsconfig.json": json({ compilerOptions: { paths: { "~/*": ["./absent/*", "./*"] } } }),
    "run/dep.ts": DEP,
    "lib/use.ts": lines('import { Value } from "~/dep";', "export { Value };"),
    "test/a.test.ts": valueTest("../lib/use.ts", "const result = Value;", usesValue),
  },
  test: "test/a.test.ts",
  loads: ["lib/use.ts", "run/dep.ts"],
  cwd: "run",
};

B4["a CommonJS require through an alias, from outside the tsconfig's folder"] = {
  files: {
    "run/tsconfig.json": json({ compilerOptions: { paths: { "~/*": ["./*"] } } }),
    "run/dep.cjs": lines('console.log("LOADED_DEP");', "module.exports = { Value: 2 };"),
    "lib/use.cts": lines('const { Value } = require("~/dep.cjs");', "module.exports = { Value };"),
    "test/a.test.ts": lines(
      ASSERT,
      TEST,
      'import use from "../lib/use.cts";',
      'test("v", () => assert.equal(use.Value, 2));',
    ),
  },
  test: "test/a.test.ts",
  loads: ["lib/use.cts", "run/dep.cjs"],
  tsconfigPath: "run/tsconfig.json",
};

describe("row 018-66: the closure holds every module a real run loads", () => {
  for (const [name, c] of Object.entries({ ...FORMS, ...B4 })) {
    it(name, SLOW, () => differential(c));
  }
});
