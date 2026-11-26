import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type { JestProject } from "../../../src/core/types/policy-jest.js";
import { recognizeTestCommand } from "../../../src/harness/shared/test-command.js";
import { resolveTestFiles } from "../../../src/harness/shared/test-command-files.js";
import {
  type CommandContext,
  commandContext,
  type TestCommand,
} from "../../../src/runners/descriptions.js";
import type { JestHere } from "../../../src/runners/jest/describe.js";
import { installJest, JEST_MAJORS } from "../../helpers/jest-env.js";

/* Spec 028 D6.3 on 005 D8 step 1: each recognized plain Jest form, and each fall-through. */

const ROOT = "/repo" as AbsolutePath;
const DIR = "/repo/packages/web" as AbsolutePath;

const WEB: JestProject = {
  name: "web",
  config: "packages/web/jest.config.ts",
  include: [],
  exclude: [],
  args: [],
  env: {},
};

const here = (project: Partial<JestProject> = {}, scripts: Record<string, string> = {}) =>
  ({ project: { ...WEB, ...project }, dir: DIR, scripts }) as JestHere;

/** No other runner's project, from a directory below the root. */
const NONE = commandContext(DEFAULT_POLICY, ROOT, DIR);

const away = (jest: readonly JestHere[] = [here()]): CommandContext => ({
  ...NONE,
  jest,
  atRoot: false,
});

const jest = (...paths: string[]): TestCommand => ({
  runner: "jest",
  project: "web",
  dir: DIR,
  paths: paths.length === 0 ? null : paths,
});

describe("recognizeTestCommand, Jest (spec 028 D6.3)", () => {
  it.each<[string, TestCommand]>([
    ["jest", jest()],
    ["npx jest", jest()],
    ["pnpm exec jest", jest()],
    ["./node_modules/.bin/jest", jest()],
    ["node_modules/.bin/jest", jest()],
    [`${DIR}/node_modules/.bin/jest`, jest()],
    ["jest src/a.test.ts", jest("src/a.test.ts")],
    ["npx jest src/a.test.ts src/b.test.ts", jest("src/a.test.ts", "src/b.test.ts")],
    [
      "jest --verbose --silent --no-color --colors --ci --runInBand src/a.test.ts",
      jest("src/a.test.ts"),
    ],
    ["pnpm exec jest --ci", jest()],
  ])("recognizes %s", (command, expected) => {
    expect(recognizeTestCommand(command, away())).toEqual(expected);
  });

  it.each([
    "jest -t adds",
    "jest --testNamePattern adds",
    "jest --testNamePattern=adds",
    "jest -u",
    "jest --updateSnapshot",
    "jest --watch",
    "jest --watchAll",
    "jest --config jest.config.ts",
    "jest -c jest.config.ts",
    "jest -i",
    "jest --coverage",
    "jest --bail",
    "jest -- src/a.test.ts",
    "jest | tail",
    "jest src/a.test.ts | head -20",
    "jest && echo done",
    "jest > out.txt",
    "jest src/*.test.ts",
    "VAR=1 jest",
    "NODE_ENV=test npx jest",
    "cd packages/web && jest",
    "npx jest@29",
    "pnpm jest",
    "yarn jest",
    "other/node_modules/.bin/jest",
    "pnpm nx run webapp:test",
    "pnpm nx test webapp",
    "nx affected -t test",
    "nx test webapp",
    "npx nx test webapp",
    "npx nx run webapp:test",
    "vitest run",
  ])("falls through for %s", (command) => {
    expect(recognizeTestCommand(command, away())).toBeNull();
  });

  it("falls through from a directory no Jest project runs from, or more than one does", () => {
    expect(recognizeTestCommand("jest", away([]))).toBeNull();
    expect(recognizeTestCommand("jest", away([here(), here({ name: "other" })]))).toBeNull();
  });

  it("falls through for a project with its own env, which the command lacks", () => {
    expect(recognizeTestCommand("jest", away([here({ env: { TZ: "UTC" } })]))).toBeNull();
  });

  it("takes the project's own args first, as the config writes them", () => {
    const ctx = away([here({ args: ["--passWithNoTests"] })]);
    expect(recognizeTestCommand("jest --passWithNoTests src/a.test.ts", ctx)).toEqual(
      jest("src/a.test.ts"),
    );
    expect(recognizeTestCommand("jest src/a.test.ts", ctx)).toBeNull();
  });

  it("falls through on paths when the project narrows what Jest lists", () => {
    const ctx = away([here({ include: ["src/**"] })]);
    expect(recognizeTestCommand("jest", ctx)).toEqual(jest());
    expect(recognizeTestCommand("jest src/a.test.ts", ctx)).toBeNull();
    expect(
      recognizeTestCommand("jest src/a.test.ts", away([here({ exclude: ["e2e/**"] })])),
    ).toBeNull();
  });

  it("recognizes bare npm test and pnpm test only for a bare jest script", () => {
    const ctx = (scripts: Record<string, string>) => away([here({}, scripts)]);
    expect(recognizeTestCommand("npm test", ctx({ test: "jest" }))).toEqual(jest());
    expect(recognizeTestCommand("pnpm test", ctx({ test: "jest --ci --silent" }))).toEqual(jest());
    for (const scripts of [
      {},
      { test: "jest", pretest: "tsc" },
      { test: "jest", posttest: "echo done" },
      { test: "jest src/a.test.ts" },
      { test: "jest --coverage" },
      { test: "NODE_ENV=test jest" },
      { test: "jest && eslint ." },
      { test: "nx test webapp" },
      { test: "vitest run" },
    ]) {
      expect(recognizeTestCommand("npm test", ctx(scripts)), JSON.stringify(scripts)).toBeNull();
    }
    expect(recognizeTestCommand("npm test -- src/a.test.ts", ctx({ test: "jest" }))).toBeNull();
    expect(recognizeTestCommand("npm run test", ctx({ test: "jest" }))).toBeNull();
    expect(recognizeTestCommand("yarn test", ctx({ test: "jest" }))).toBeNull();
  });
});

describe("resolveTestFiles, Jest (spec 028 D6.3)", () => {
  const ref = (project: string, path: string): TestFileRef => ({ project, path });
  const A = ref("web", "packages/web/src/a.test.ts");
  const B = ref("web", "packages/web/src/b.test.ts");
  const NESTED = ref("web", "packages/web/src/deep/b.test.ts");
  const OTHER = ref("api", "packages/api/src/a.test.ts");
  const listing = [A, B, NESTED, OTHER];
  const resolve = (command: TestCommand) =>
    resolveTestFiles(command, listing, ROOT, new Set(["web", "api"]), 0);

  it("resolves files the command names, each the only listed file its pattern selects", () => {
    expect(resolve(jest("src/a.test.ts"))).toEqual([A]);
    expect(resolve(jest("./src/a.test.ts"))).toEqual([A]);
    expect(resolve(jest("src/deep/b.test.ts", "src/a.test.ts"))).toEqual([A, NESTED]);
    expect(resolve(jest(`${DIR}/src/a.test.ts`))).toEqual([A]);
  });

  it("does not resolve no path, a directory, or a path naming no listed file", () => {
    expect(resolve(jest())).toBeNull();
    expect(resolve(jest("src"))).toBeNull();
    expect(resolve(jest("."))).toBeNull();
    expect(resolve(jest("src/missing.test.ts"))).toBeNull();
    expect(resolve(jest("../api/src/a.test.ts"))).toBeNull();
    expect(resolve(jest("../../../outside.test.ts"))).toBeNull();
    expect(resolve(jest("src/a.test.ts", "src"))).toBeNull();
  });

  it("does not resolve a path whose pattern selects another listed file too", () => {
    // Jest reads each path as a pattern over absolute paths: `a.test.ts` selects `src/a.test.ts` too.
    const TOP = ref("web", "packages/web/a.test.ts");
    const files = (command: TestCommand) =>
      resolveTestFiles(command, [TOP, A, B], ROOT, new Set(["web"]), 0);
    expect(files(jest("a.test.ts"))).toBeNull();
    expect(files(jest("src/a.test.ts"))).toEqual([A]);
    expect(files(jest("a.test.ts", "src/a.test.ts"))).toEqual([TOP, A]);
    expect(files(jest("src/b.test.ts"))).toEqual([B]);
  });

  it("does not resolve a path that is no valid pattern", () => {
    const BAD = ref("web", "packages/web/src/a(.test.ts");
    expect(resolveTestFiles(jest("src/a(.test.ts"), [BAD], ROOT, new Set(["web"]), 0)).toBeNull();
  });
});

describe("JEST.context (spec 028 D6.3)", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-describe-"))) as AbsolutePath;
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let made = 0;

  /** A fresh directory below `root` holding `files`. */
  const tree = (files: Record<string, string>): AbsolutePath => {
    const dir = join(root, `tree-${made++}`) as AbsolutePath;
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  };
  /** The names of the projects a command run from `cwd` below `dir` matches. */
  const found = (dir: AbsolutePath, project: Partial<JestProject>, cwd = dir) =>
    commandContext({ ...DEFAULT_POLICY, jest: [{ ...WEB, ...project }] }, dir, cwd).jest?.map(
      (h) => h.project.name,
    );

  it("finds the one project run from the real directory, with its package.json scripts", () => {
    const dir = join(root, "packages/web");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "jest", n: 1 } }));
    writeFileSync(join(dir, "jest.config.ts"), "export default {};\n");
    const policy = {
      ...DEFAULT_POLICY,
      jest: [WEB, { ...WEB, name: "api", config: "packages/api/jest.config.ts" }],
    };
    const context = commandContext(policy, root, dir);
    expect(context.jest?.map((h) => [h.project.name, h.dir, h.scripts])).toEqual([
      ["web", dir, { test: "jest" }],
    ]);
    expect(recognizeTestCommand("npm test", context)).toEqual({
      runner: "jest",
      project: "web",
      dir,
      paths: null,
    });
    expect(commandContext(policy, root, root).jest).toEqual([]);
  });

  it("matches only the config Jest's own search finds there, alone (review 0.1.646 B1)", () => {
    const CJS = { "jest.config.cjs": "module.exports = {};\n" };
    const POLICY = { "policy.jest.cjs": "module.exports = {};\n" };
    const at = (config: string) => ({ config });
    expect(found(tree({ ...CJS }), at("jest.config.cjs"))).toEqual(["web"]);
    expect(found(tree({ ...CJS, ...POLICY }), at("policy.jest.cjs"))).toEqual([]);
    expect(found(tree({ ...POLICY }), at("policy.jest.cjs"))).toEqual([]);
    expect(found(tree({ ...CJS, "jest.config.js": "" }), at("jest.config.cjs"))).toEqual([]);
    expect(found(tree({ ...CJS, "jest.config.mts": "" }), at("jest.config.cjs"))).toEqual([]);
    const withKey = { "package.json": JSON.stringify({ jest: { testEnvironment: "node" } }) };
    expect(found(tree({ ...CJS, ...withKey }), at("jest.config.cjs"))).toEqual([]);
    expect(found(tree({ ...withKey }), at("package.json"))).toEqual(["web"]);
    const scripts = { "package.json": JSON.stringify({ scripts: { test: "jest" } }) };
    expect(found(tree({ ...CJS, ...scripts }), at("jest.config.cjs"))).toEqual(["web"]);
    expect(found(tree({ ...CJS, "package.json": "{ not json" }), at("jest.config.cjs"))).toEqual(
      [],
    );
    expect(found(tree({}), at("jest.config.cjs"))).toEqual([]);
  });

  it("falls through for a policy cwd apart from its config's directory", () => {
    const dir = tree({ "jest.config.cjs": "module.exports = {};\n", "sub/a.test.cjs": "" });
    const sub = { config: "jest.config.cjs", cwd: "sub" };
    expect(found(dir, sub, join(dir, "sub"))).toEqual([]);
    expect(found(dir, sub)).toEqual([]);
    expect(found(dir, { config: "jest.config.cjs", cwd: "." })).toEqual(["web"]);
  });
});

describe.each(JEST_MAJORS)(
  "plain Jest recognition on real Jest %i (review 0.1.646 B1)",
  (major) => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-plain-")));
    afterAll(() => rmSync(scratch, { recursive: true, force: true }));
    const config = (flag: string) =>
      `module.exports = { testEnvironment: "node", testMatch: ["<rootDir>/*.test.cjs"], globals: { FLAG: "${flag}" } };\n`;
    const TEST = `test("same test file", () => expect(FLAG).toBe("configured"));\n`;

    /** A directory with `a.test.cjs`, the installed Jest, and `configs`. */
    function project(name: string, configs: Record<string, string>): AbsolutePath {
      const dir = join(scratch, name);
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      for (const [path, text] of Object.entries({ "a.test.cjs": TEST, ...configs })) {
        writeFileSync(join(dir, path), text);
      }
      const jest = realpathSync(join(installJest(major), "node_modules/jest"));
      symlinkSync(jest, join(dir, "node_modules/jest"));
      return dir as AbsolutePath;
    }
    const jestExit = (dir: string, args: readonly string[]) =>
      spawnSync(process.execPath, [join(dir, "node_modules/jest/bin/jest.js"), ...args], {
        cwd: dir,
        encoding: "utf8",
        timeout: 120_000,
      }).status;
    const APP: JestProject = { ...WEB, name: "app" };
    const ARGS = ["--runInBand", "--ci", "a.test.cjs"];
    const COMMAND = `jest ${ARGS.join(" ")}`;
    const SLOW = { timeout: 240_000 };

    it("does not match a custom config whose run a plain command does not repeat", SLOW, () => {
      const dir = project("custom", {
        "policy.jest.cjs": config("configured"),
        "jest.config.cjs": config("direct"),
      });
      expect(jestExit(dir, ["--config", "policy.jest.cjs", ...ARGS])).toBe(0);
      expect(jestExit(dir, ARGS)).toBe(1);
      const policy = { ...DEFAULT_POLICY, jest: [{ ...APP, config: "policy.jest.cjs" }] };
      expect(recognizeTestCommand(COMMAND, commandContext(policy, dir, dir))).toBeNull();
    });

    it("matches the config plain Jest finds alone, with no cwd or its own directory", SLOW, () => {
      const dir = project("plain", { "jest.config.cjs": config("configured") });
      expect(jestExit(dir, ARGS)).toBe(0);
      const recognized = { runner: "jest", project: "app", dir, paths: ["a.test.cjs"] };
      for (const cwd of [undefined, "."]) {
        const app = { ...APP, config: "jest.config.cjs", ...(cwd === undefined ? {} : { cwd }) };
        const context = commandContext({ ...DEFAULT_POLICY, jest: [app] }, dir, dir);
        expect(recognizeTestCommand(COMMAND, context)).toEqual(recognized);
      }
      mkdirSync(join(dir, "sub"));
      const away = { ...APP, config: "jest.config.cjs", cwd: "sub" };
      const policy = { ...DEFAULT_POLICY, jest: [away] };
      expect(recognizeTestCommand(COMMAND, commandContext(policy, dir, dir))).toBeNull();
      expect(
        recognizeTestCommand(COMMAND, commandContext(policy, dir, join(dir, "sub"))),
      ).toBeNull();
    });
  },
);
