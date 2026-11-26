import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../../../src/core/types/common.js";
import { createJestGraph, type JestGraph } from "../../../../src/runners/jest/graph/index.js";
import { compileModuleNameMapper } from "../../../../src/runners/jest/graph/mapper.js";
import { snapshotPath } from "../../../../src/runners/jest/graph/snapshots.js";

/*
 * Spec 028 D3.3: Jest's static closure and `affected()` over the shared JS/TS graph, before any
 * run observed a test file: `moduleNameMapper`, tsconfig `paths` and `baseUrl`, a workspace
 * package reached through a `node_modules` link, setup files in every closure, and snapshots.
 */

const P = "packages/pkg-a";

const FILES: Readonly<Record<string, string>> = {
  "tsconfig.base.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@shared/*": ["libs/shared/src/*"] } } }\n`,
  "libs/shared/src/util.ts": `export const util = 1;\n`,
  "packages/pkg-b/package.json": `{ "name": "pkg-b", "main": "index.js" }\n`,
  "packages/pkg-b/index.js": `module.exports = require("./b-dep");\n`,
  "packages/pkg-b/b-dep.js": `module.exports = 2;\n`,
  [`${P}/package.json`]: `{ "name": "pkg-a" }\n`,
  [`${P}/tsconfig.json`]: `{ "extends": "../../tsconfig.base.json" }\n`,
  [`${P}/jest-setup.js`]: `require("./setup-helper");\n`,
  [`${P}/setup-helper.js`]: `module.exports = 0;\n`,
  [`${P}/after-env.ts`]: `import "./after-helper";\n`,
  [`${P}/after-helper.ts`]: `export {};\n`,
  [`${P}/src/mapped/style.js`]: `module.exports = {};\n`,
  [`${P}/src/alias/thing.js`]: `module.exports = 3;\n`,
  [`${P}/src/fallback/second.js`]: `module.exports = 4;\n`,
  [`${P}/src/uses-b.js`]: `module.exports = require("pkg-b");\n`,
  [`${P}/src/uses-shared.ts`]: `export { util } from "@shared/util";\n`,
  [`${P}/src/comp.jsx`]: `module.exports = 5;\n`,
  [`${P}/test/b.test.js`]: `require("../src/uses-b");\n`,
  [`${P}/test/shared.test.ts`]: `import "../src/uses-shared";\n`,
  [`${P}/test/map.test.js`]: `require("./x.css");
require("~/thing");
require("@fallback/second");
require("../src/comp");
require("@missing/gone");
`,
  [`${P}/test/plain.test.js`]: `module.exports = 0;\n`,
};

const TESTS = [
  `${P}/test/b.test.js`,
  `${P}/test/map.test.js`,
  `${P}/test/plain.test.js`,
  `${P}/test/shared.test.ts`,
];

const MAPPER = {
  "\\.css$": "<rootDir>/src/mapped/style.js",
  "^~/(.*)$": "<rootDir>/src/alias/$1",
  "^@fallback/(.*)$": ["<rootDir>/src/nowhere/$1", "<rootDir>/src/fallback/$1"],
  "^@missing/(.*)$": "<rootDir>/src/absent/$1",
};

let root: AbsolutePath;
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-graph-"))) as AbsolutePath;
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, P, "node_modules"));
  symlinkSync("../../pkg-b", join(root, P, "node_modules/pkg-b"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const graphOf = (snapshotResolver?: string) =>
  createJestGraph({
    root,
    rootDir: join(root, P) as AbsolutePath,
    testFiles: TESTS,
    moduleNameMapper: MAPPER,
    setupFiles: ["<rootDir>/jest-setup.js"],
    setupFilesAfterEnv: [join(root, P, "after-env.ts")],
    snapshotResolver,
  });

describe("createJestGraph", () => {
  let graph: JestGraph;
  beforeAll(async () => {
    graph = await graphOf();
  });

  const setup = [
    `${P}/jest-setup.js`,
    `${P}/setup-helper.js`,
    `${P}/after-env.ts`,
    `${P}/after-helper.ts`,
  ];

  it("maps specifiers through moduleNameMapper, its capture groups and fallbacks, and .jsx", () => {
    const { paths } = graph.closure(`${P}/test/map.test.js`);
    expect(paths).toEqual(
      expect.arrayContaining([
        `${P}/src/mapped/style.js`,
        `${P}/src/alias/thing.js`,
        `${P}/src/fallback/second.js`,
        `${P}/src/comp.jsx`,
      ]),
    );
    // A mapped target that does not exist is an absent candidate, so creating it re-keys the file.
    expect(paths.some((p) => p.startsWith(`${P}/src/absent/gone`))).toBe(true);
    expect(paths.some((p) => p.endsWith("x.css"))).toBe(false);
  });

  it("puts every setup file's closure and the default snapshot path in each closure", () => {
    for (const file of TESTS) {
      const closure = graph.closure(file);
      expect(closure.paths).toEqual(expect.arrayContaining(setup));
      const snapshot = join(dirname(file), "__snapshots__", `${file.split("/").pop()}.snap`);
      expect(closure.snapshot).toBe(snapshot);
      expect(closure.paths).toContain(snapshot);
    }
  });

  it("follows a workspace package link to its real files", () => {
    expect(graph.closure(`${P}/test/b.test.js`).paths).toEqual(
      expect.arrayContaining(["packages/pkg-b/index.js", "packages/pkg-b/b-dep.js"]),
    );
  });

  it("resolves tsconfig paths and baseUrl through the project's extends chain", () => {
    expect(graph.closure(`${P}/test/shared.test.ts`).paths).toEqual(
      expect.arrayContaining(["libs/shared/src/util.ts", "tsconfig.base.json"]),
    );
  });

  it("sends a cross-package edit to the test files reaching it", () => {
    expect(graph.affected(["packages/pkg-b/b-dep.js"])).toEqual({
      direct: [],
      transitive: [`${P}/test/b.test.js`],
    });
    expect(graph.affected(["libs/shared/src/util.ts"]).transitive).toEqual([
      `${P}/test/shared.test.ts`,
    ]);
  });

  it("sends a setup file's edit to every test file", () => {
    expect(graph.affected([`${P}/setup-helper.js`]).transitive).toEqual(TESTS);
    expect(graph.affected([`${P}/after-helper.ts`]).transitive).toEqual(TESTS);
  });

  it("sends a changed snapshot to its test file, directly", () => {
    expect(graph.affected([`${P}/test/__snapshots__/plain.test.js.snap`])).toEqual({
      direct: [`${P}/test/plain.test.js`],
      transitive: [],
    });
  });

  it("re-reads an edited module and a new test file", () => {
    const file = `${P}/test/plain.test.js`;
    writeFileSync(join(root, file), `require("~/thing");\n`);
    graph.invalidate([{ path: file, kind: "change" }]);
    expect(graph.closure(file).paths).toContain(`${P}/src/alias/thing.js`);
    const added = `${P}/test/added.test.js`;
    writeFileSync(join(root, added), `require("../src/comp");\n`);
    graph.invalidate([{ path: added, kind: "add" }]);
    graph.setTestFiles([...TESTS, added]);
    expect(graph.closure(added).paths).toContain(`${P}/src/comp.jsx`);
    expect(graph.affected([`${P}/test/__snapshots__/added.test.js.snap`]).direct).toEqual([added]);
    expect(() => graph.closure(`${P}/src/comp.jsx`)).toThrow(/not a test file/);
  });
});

describe("a custom snapshotResolver", () => {
  it("leaves the snapshot path to the run's observation", async () => {
    const graph = await graphOf("<rootDir>/snapshot-resolver.js");
    const closure = graph.closure(`${P}/test/map.test.js`);
    expect(closure.snapshot).toBeNull();
    expect(closure.paths.some((p) => p.endsWith(".snap"))).toBe(false);
    expect(graph.affected([`${P}/test/__snapshots__/map.test.js.snap`]).direct).toEqual([]);
    expect(snapshotPath("a.test.js", "x")).toBeNull();
    expect(snapshotPath("a.test.js", null)).toBe(join("__snapshots__", "a.test.js.snap"));
  });
});

describe("compileModuleNameMapper", () => {
  const rootDir = "/w/p" as AbsolutePath;

  it("maps the first matching pattern only, expanding <rootDir> and $N", () => {
    const mapper = compileModuleNameMapper(
      [
        ["^@a/(.*)/(.*)$", ["<rootDir>/x/$2/$1", "other/$1"]],
        ["^@a/(.*)$", "<rootDir>/never/$1"],
      ],
      rootDir,
    );
    expect(mapper.map("@a/b/c")).toEqual(["/w/p/x/c/b", "other/b"]);
    expect(mapper.map("plain")).toBeNull();
    expect(mapper.notes).toEqual([]);
  });

  it("skips a pattern that is no regular expression, with a note", () => {
    const mapper = compileModuleNameMapper({ "(": "<rootDir>/x", "^y$": "<rootDir>/y" }, rootDir);
    expect(mapper.map("y")).toEqual(["/w/p/y"]);
    expect(mapper.notes).toEqual([expect.stringContaining('pattern "("')]);
  });
});
