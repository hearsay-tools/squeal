import { describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../src/core/types/index.js";
import {
  type CommandContext,
  recognizeTestCommand,
  type TestCommand,
} from "../../src/harness/shared/test-command.js";
import { resolveTestFiles } from "../../src/harness/shared/test-command-files.js";

/* Spec 005 D8 step 1: each recognized form, and each fall-through. */

const UNIT: NodeTestProject = {
  name: "test:unit",
  argv: ["--import", "tsx"],
  env: {},
  include: ["test/unit/**/*.test.ts"],
};

const CONTEXT: CommandContext = {
  scripts: {
    test: "vitest run",
    "test:quiet": "vitest run src --silent",
    "test:watch": "vitest",
    "test:lint": "biome check . && vitest run",
    "test:project": "vitest run --project unit",
    "test:hooked": "vitest run",
    "pretest:hooked": "npm run build",
    "test:unit": "node --import tsx --test test/unit/**/*.test.ts",
  },
  nodeTest: [
    UNIT,
    { name: "nested", cwd: "packages/a", argv: [], env: {}, include: ["test/*.test.js"] },
    { name: "with-env", argv: [], env: { DEBUG: "1" }, include: ["env/*.test.js"] },
  ],
};

const vitest = (...filters: string[]): TestCommand => ({ runner: "vitest", filters });
const nodeTest = (files: string[] | null): TestCommand => ({
  runner: "node-test",
  project: "test:unit",
  files,
});

describe("recognizeTestCommand (spec 005 D8 step 1)", () => {
  it.each<[string, TestCommand]>([
    ["vitest run", vitest()],
    ["npx vitest run", vitest()],
    ["  vitest   run  ", vitest()],
    ["vitest run src/git-refs.test.ts", vitest("src/git-refs.test.ts")],
    ["vitest run git-refs store", vitest("git-refs", "store")],
    ["npx vitest run 'test/a b.test.ts'", vitest("test/a b.test.ts")],
    ['npx vitest run "test/cli"', vitest("test/cli")],
    ["vitest run --silent", vitest()],
    ["vitest run --silent=passed-only test/cli", vitest("test/cli")],
    ["vitest run --silent true test/cli", vitest("test/cli")],
    ["vitest run --silent --reporter dot test/cli", vitest("test/cli")],
    ["vitest run --reporter=verbose test/cli", vitest("test/cli")],
    ["vitest run test/cli --reporter json", vitest("test/cli")],
    ["npm test", vitest()],
    ["npm run test", vitest()],
    ["npm run test:quiet", vitest("src")],
    ["node --import tsx --test 'test/unit/**/*.test.ts'", nodeTest(null)],
    ["node --import tsx --test test/unit/a.test.ts", nodeTest(["test/unit/a.test.ts"])],
    [
      "node --import tsx --test test/unit/a.test.ts ./test/unit/b.test.ts",
      nodeTest(["test/unit/a.test.ts", "./test/unit/b.test.ts"]),
    ],
  ])("recognizes %s", (command, expected) => {
    expect(recognizeTestCommand(command, CONTEXT)).toEqual(expected);
  });

  it.each([
    // chains, pipes, redirects, subshells, comments, expansions, globs
    ["a chain", "npm run build && vitest run"],
    ["a sequence", "vitest run; echo done"],
    ["a newline", "vitest run\nrm -rf dist"],
    ["a background job", "vitest run &"],
    ["a pipe", "vitest run | tail -20"],
    ["a redirect", "vitest run > out.txt"],
    ["stderr merged", "vitest run 2>&1"],
    ["a subshell", "(vitest run)"],
    ["a command substitution", "vitest run $(git diff --name-only)"],
    ["a backtick", "vitest run `ls`"],
    ["a variable", "vitest run $FILE"],
    ["a double-quoted expansion", 'vitest run "$FILE"'],
    ["an unclosed quote", "vitest run 'test"],
    ["a comment", "vitest run # all"],
    ["a glob the shell expands", "vitest run test/*.test.ts"],
    ["a home directory", "vitest run ~/x.test.ts"],
    ["an escape", "vitest run test\\ a.test.ts"],
    // leading assignments and other working directories
    ["a leading assignment", "CI=1 vitest run"],
    ["env", "env CI=1 vitest run"],
    ["a cd", "cd packages/a && vitest run"],
    ["a --root", "vitest run --root packages/a"],
    ["a --dir", "vitest run --dir test"],
    // other runners and forms
    ["watch mode", "vitest"],
    ["vitest without run", "vitest test/cli"],
    ["vitest watch", "vitest watch"],
    ["vitest related", "vitest related src/a.ts"],
    ["vitest list", "vitest list"],
    ["npx with a flag", "npx --yes vitest run"],
    ["pnpm", "pnpm vitest run"],
    ["yarn", "yarn test"],
    ["jest", "npx jest"],
    ["tsc", "npx tsc --noEmit"],
    ["the squeal CLI", "squeal run --all --wait"],
    ["an empty command", ""],
    // flags that change what runs
    ["--project", "vitest run --project unit"],
    ["--config", "vitest run --config vitest.e2e.config.ts"],
    ["-c", "vitest run -c other.config.ts"],
    ["-t", "vitest run -t 'adds'"],
    ["--testNamePattern", "vitest run --testNamePattern=adds"],
    ["--changed", "vitest run --changed"],
    ["--related", "vitest run --related src/a.ts"],
    ["--coverage", "vitest run --coverage"],
    ["-u", "vitest run -u"],
    ["--update", "vitest run --update"],
    ["--watch", "vitest run --watch"],
    ["--outputFile", "vitest run --reporter json --outputFile out.json"],
    ["--bail", "vitest run --bail 1"],
    ["--shard", "vitest run --shard 1/2"],
    ["a line filter", "vitest run test/a.test.ts:12"],
    ["a bare --reporter", "vitest run --reporter"],
    ["a bare --silent taking a filter as its value", "vitest run --silent test/cli"],
    ["--reporter followed by a flag", "vitest run --reporter --silent"],
    ["an unknown --silent value", "vitest run --silent=maybe"],
    ["the -- separator", "vitest run -- test/a.test.ts"],
    // npm forms
    ["npm test with arguments", "npm test -- test/cli"],
    ["npm run with arguments", "npm run test -- --silent"],
    ["a workspace flag", "npm test --workspace packages/a"],
    ["a -w flag", "npm run test -w packages/a"],
    ["npm run -ws", "npm run -ws test"],
    ["a missing script", "npm run nope"],
    ["a watch script", "npm run test:watch"],
    ["a chained script", "npm run test:lint"],
    ["a script with --project", "npm run test:project"],
    ["a script with a pre script", "npm run test:hooked"],
    ["npm t", "npm t"],
    ["npm run-script", "npm run-script test"],
    ["npx npm test", "npx npm test"],
    ["a node:test script through npm", "npm run test:unit"],
    // node --test
    ["node --test of no project", "node --test test/other/*.test.ts"],
    ["node --test with other flags", "node --test 'test/unit/**/*.test.ts'"],
    ["a project's globs the shell would expand", "node --import tsx --test test/unit/**/*.test.ts"],
    ["node --test with an extra flag", "node --import tsx --test-only --test test/unit/a.test.ts"],
    ["a test flag after --test", "node --import tsx --test --test-name-pattern=a"],
    ["a glob narrowing", "node --import tsx --test 'test/unit/a*.test.ts'"],
    ["node --test alone", "node --import tsx --test"],
    ["a project with its own cwd", "node --test test/*.test.js"],
    ["a project with its own env", "node --test env/*.test.js"],
    ["another node", "/usr/bin/node --import tsx --test test/unit/a.test.ts"],
  ])("falls through for %s", (_, command) => {
    expect(recognizeTestCommand(command, CONTEXT)).toBeNull();
  });
});

describe("resolveTestFiles (spec 005 D8 step 2)", () => {
  const ROOT = "/repo";
  const ref = (project: string, path: string) => ({ project, path });
  const LISTING = [
    ref("", "test/a.test.ts"),
    ref("", "test/b.test.ts"),
    ref("test:unit", "test/unit/a.test.ts"),
    ref("test:unit", "test/unit/b.test.ts"),
  ];
  const NODE_TEST = new Set(["test:unit"]);
  const resolve = (command: TestCommand, listing = LISTING) =>
    resolveTestFiles(command, listing, ROOT, NODE_TEST)?.map((r) => r.path) ?? null;

  it("leaves node:test projects out of a Vitest command", () => {
    expect(resolve(vitest())).toEqual(["test/a.test.ts", "test/b.test.ts"]);
    expect(resolve(vitest("a.test"))).toEqual(["test/a.test.ts"]);
  });

  it("falls through for a filter that matches no listed file", () => {
    expect(resolve(vitest("a.test", "nomatch"))).toBeNull();
  });

  it("falls through with two Vitest projects, or none", () => {
    expect(resolve(vitest(), [...LISTING, ref("e2e", "e2e/x.test.ts")])).toBeNull();
    expect(resolve(vitest(), LISTING.slice(2))).toBeNull();
  });

  it("resolves a node:test project's command to its files, or the files it names", () => {
    expect(resolve(nodeTest(null))).toEqual(["test/unit/a.test.ts", "test/unit/b.test.ts"]);
    expect(resolve(nodeTest(["./test/unit/b.test.ts", "test/unit/b.test.ts"]))).toEqual([
      "test/unit/b.test.ts",
    ]);
  });

  it("falls through for a named file the project does not list", () => {
    expect(resolve(nodeTest(["test/unit/c.test.ts"]))).toBeNull();
    expect(resolve(nodeTest(["test/a.test.ts"]))).toBeNull();
    expect(resolve(nodeTest(["../outside.test.ts"]))).toBeNull();
    expect(resolve(nodeTest(null), LISTING.slice(0, 2))).toBeNull();
  });
});
