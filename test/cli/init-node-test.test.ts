import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { parseTestScript, seedNodeTest } from "../../src/cli/node-test-seed.js";
import { loadPolicy } from "../../src/core/daemon/policy.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { fakeRepo } from "../status/helpers.js";

/* Spec 003 D1: `squeal init` seeds `nodeTest` from `package.json` scripts (row 003-23). */

const UNIT = "node --import ../../scripts/test-git-env.mjs --import tsx --test test/unit/*.test.ts";
const E2E = "node --import ../../scripts/test-git-env.mjs --import tsx --test test/e2e/*.test.ts";
const ARGV = ["--import", "../../scripts/test-git-env.mjs", "--import", "tsx"];

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** A repository shaped like cezarion: the node:test scripts in a workspace package two deep. */
function cezarion(): string {
  const root = fakeRepo().main;
  writeJson(join(root, "package.json"), {
    private: true,
    workspaces: ["packages/*", "!packages/ignored"],
    scripts: { test: "vitest run" },
  });
  writeJson(join(root, "packages/cezarion/package.json"), {
    name: "cezarion",
    scripts: { test: "vitest run", "test:unit": UNIT, "test:package": E2E, build: "tsc" },
  });
  writeJson(join(root, "packages/ignored/package.json"), {
    scripts: { "test:unit": "node --test a.test.js" },
  });
  return root;
}

function init(cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env: {},
  };
  return { code: main(["init"], io), stdout: () => stdout, stderr: () => stderr };
}

function config(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, "squeal.config.json"), "utf8"));
}

describe("squeal init seeds nodeTest", () => {
  it("writes one entry per cezarion-shaped script, with cwd, argv and include", () => {
    const root = cezarion();
    const result = init(root);
    expect({ code: result.code, stderr: result.stderr() }).toEqual({ code: 0, stderr: "" });
    expect(config(root)).toEqual({
      ...DEFAULT_POLICY,
      nodeTest: [
        {
          name: "test:unit",
          cwd: "packages/cezarion",
          argv: ARGV,
          include: ["test/unit/*.test.ts"],
        },
        {
          name: "test:package",
          cwd: "packages/cezarion",
          argv: ARGV,
          include: ["test/e2e/*.test.ts"],
        },
      ],
    });
    expect(result.stdout()).toContain('seeded nodeTest project "test:unit" from packages/cezarion');
    const loaded = loadPolicy(root);
    expect(loaded.problems).toEqual([]);
    expect(loaded.policy.nodeTest.map((project) => project.name)).toEqual([
      "test:unit",
      "test:package",
    ]);
  });

  it("refuses a piped or chained script with a note and a template, and seeds the rest", () => {
    const root = fakeRepo().main;
    writeJson(join(root, "package.json"), {
      scripts: {
        "test:unit": "node --test test/*.test.js",
        "test:piped": "node --test test/*.test.js | tap-spec",
        "test:chained": "tsc && node --test dist/*.test.js",
      },
    });
    const result = init(root);
    expect(result.code).toBe(0);
    expect(config(root).nodeTest).toEqual([
      { name: "test:unit", argv: [], include: ["test/*.test.js"] },
    ]);
    const out = result.stdout();
    expect(out).toContain('script "test:piped" in package.json is not');
    expect(out).toContain('script "test:chained" in package.json is not');
    expect(out).toContain('"name": "test:piped"');
  });

  it("never overwrites an existing config", () => {
    const root = cezarion();
    writeFileSync(join(root, "squeal.config.json"), "{}\n");
    const result = init(root);
    expect(result.code).toBe(0);
    expect(readFileSync(join(root, "squeal.config.json"), "utf8")).toBe("{}\n");
    expect(result.stdout()).not.toContain("nodeTest");
  });

  it("writes the default policy when there is no package.json", () => {
    const root = fakeRepo().main;
    expect(init(root).code).toBe(0);
    expect(config(root)).toEqual(DEFAULT_POLICY);
  });
});

describe("seedNodeTest", () => {
  it("names a script repeated across packages by its package directory", () => {
    const root = fakeRepo().main;
    writeJson(join(root, "package.json"), {
      workspaces: { packages: ["libs/**"] },
      scripts: { test: "node --test 'test/**/*.test.js'" },
    });
    writeJson(join(root, "libs/a/package.json"), { scripts: { test: "node --test t/*.js" } });
    writeJson(join(root, "libs/group/b/package.json"), { scripts: { test: "node --test t/*.js" } });
    writeJson(join(root, "libs/a/node_modules/x/package.json"), {
      scripts: { test: "node --test t/*.js" },
    });
    expect(seedNodeTest(root).projects).toEqual([
      { name: "test", argv: [], include: ["test/**/*.test.js"] },
      { name: "libs/a:test", cwd: "libs/a", argv: [], include: ["t/*.js"] },
      { name: "libs/group/b:test", cwd: "libs/group/b", argv: [], include: ["t/*.js"] },
    ]);
  });

  it("notes a package.json that does not parse and keeps going", () => {
    const root = fakeRepo().main;
    writeFileSync(join(root, "package.json"), "{");
    expect(seedNodeTest(root)).toEqual({
      projects: [],
      notes: ["package.json is not a JSON object; no nodeTest project seeded from it"],
      templates: [],
    });
  });
});

describe("parseTestScript", () => {
  it("ignores a script that does not mention --test", () => {
    expect(parseTestScript("vitest run")).toBeNull();
    expect(parseTestScript("node --test-reporter=spec x.js")).toBeNull();
  });

  it.each([
    ["node --test a.test.js b.test.js", [], ["a.test.js", "b.test.js"]],
    ['node --import tsx --test "test/**/*.test.ts"', ["--import", "tsx"], ["test/**/*.test.ts"]],
    [
      "node --enable-source-maps -r ./setup.cjs --test t/*.js",
      ["--enable-source-maps", "-r", "./setup.cjs"],
      ["t/*.js"],
    ],
    [
      "node --import=tsx --conditions development --test t/*.ts",
      ["--import=tsx", "--conditions", "development"],
      ["t/*.ts"],
    ],
    ["node --title 'my tests' --test t/*.js", ["--title", "my tests"], ["t/*.js"]],
  ])("reads %s", (text, argv, include) => {
    expect(parseTestScript(text)).toEqual({ argv, include });
  });

  it.each([
    ["node --test t/*.js | tap-spec", "a pipe"],
    ["tsc && node --test t/*.js", "a chain"],
    ["node --test t/*.js; echo done", "a chain"],
    ["node --test t/*.js > out.txt", "a redirection"],
    ["node --test t/*.js 2>&1", "a redirection"],
    ["NODE_ENV=test node --test t/*.js", "an environment assignment"],
    ["node --test $GLOB", "a shell expansion"],
    ['node --test "t/$X.js"', "a shell expansion"],
    ["node --test", "no test-file glob"],
    ["node --test --test-reporter spec t/*.js", "a flag after --test"],
    ["tsx --test t/*.ts", "a command other than node"],
    ["node runner.js --test t/*.js", "a script or argument before --test"],
    ["node --test 't/*.js", "an unclosed quote"],
  ])("refuses %s as %s", (text, why) => {
    expect(parseTestScript(text)).toBe(why);
  });
});
