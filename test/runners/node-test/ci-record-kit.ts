import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach } from "vitest";
import { ciCommand } from "../../../src/cli/ci.js";
import { type Part, readPart } from "../../../src/core/ci/parts.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import { nodeTestCiRuntime } from "../../../src/runners/node-test/ci-record.js";

/*
 * Spec 018 D22 to D25 (row 018-47): a node:test project shaped like cezar's
 * commands, recorded by `squeal ci record`. ESM and CJS tests, a TypeScript
 * test through `--import tsx`, a test that spawns a Node child, a repeated
 * test name, a skip and a todo.
 */

const REPO = resolve(import.meta.dirname, "../../..");
const lines = (...text: string[]) => `${text.join("\n")}\n`;

export const FILES: Readonly<Record<string, string>> = {
  "lib/a.mjs": "export const a = 1;\n",
  "lib/b.cjs": "module.exports = { b: 2 };\n",
  "lib/c.ts": "export const c: number = 3;\n",
  "lib/d.mjs": "export const d = 4;\n",
  "lib/child.mjs": lines('import { d } from "./d.mjs";', "if (d !== 4) process.exit(1);"),
  "test/esm.test.mjs": lines(
    'import { describe, test } from "node:test";',
    'import { a } from "../lib/a.mjs";',
    'describe("suite", () => {',
    '  test("same", () => {});',
    '  test("same", () => {});',
    '  test.skip("skipped", () => {});',
    '  test.todo("later");',
    "});",
    'test("a is 1", () => { if (a !== 1) throw new Error("a"); });',
  ),
  "test/cjs.test.cjs": lines(
    'const { test } = require("node:test");',
    'const { b } = require("../lib/b.cjs");',
    'test("b is 2", () => { if (b !== 2) throw new Error("b"); });',
  ),
  "test/ts.test.ts": lines(
    'import { test } from "node:test";',
    'import { c } from "../lib/c.ts";',
    'test("c is 3", () => { if (c !== 3) throw new Error("c"); });',
  ),
  "test/spawn.test.mjs": lines(
    'import { execFileSync } from "node:child_process";',
    'import { test } from "node:test";',
    'test("spawns", () => { execFileSync(process.execPath, ["lib/child.mjs"]); });',
  ),
  "squeal.config.json": `${JSON.stringify({
    nodeTest: [{ name: "unit", argv: ["--import", "tsx"], include: ["test/*.test.*"] }],
  })}\n`,
};

export const TEST_FILES = [
  "test/cjs.test.cjs",
  "test/esm.test.mjs",
  "test/spawn.test.mjs",
  "test/ts.test.ts",
];

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A new directory, by its real path, removed after the test. */
export function temp(): AbsolutePath {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-ci-node-test-")));
  temps.push(dir);
  return dir;
}

/**
 * Which of the repository's packages the project gets: only `tsx`, so no
 * Vitest resolves and node:test records alone, or all of `node_modules`,
 * so Vitest's recording wraps the command too.
 */
export type Packages = "tsx" | "all";

/** A committed git worktree holding `files`, with the repository's packages linked in. */
export function project(
  files: Readonly<Record<string, string>> = FILES,
  packages: Packages = "tsx",
): AbsolutePath {
  const root = join(temp(), "root");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  if (packages === "all") symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
  else {
    mkdirSync(join(root, "node_modules"));
    symlinkSync(realpathSync(join(REPO, "node_modules/tsx")), join(root, "node_modules/tsx"));
  }
  writeFileSync(join(root, ".gitignore"), "node_modules\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "f"], {
    cwd: root,
  });
  return root;
}

/** The reporter pair of D23. */
export function reporterPair(): string[] {
  const reporter = nodeTestCiRuntime()?.reporter as string;
  return [`--test-reporter=${reporter}`, "--test-reporter-destination=stderr"];
}

/** `node <args>` as the project's command: the spec reporter to stdout first, as in D23. */
export function nodeTestCommand(node: string, args: readonly string[]): string[] {
  return [
    node,
    "--import",
    "tsx",
    "--test",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    ...args,
  ];
}

export interface Recorded {
  readonly code: number;
  readonly stderr: string;
  readonly parts: Part[];
}

/** `squeal ci record --out <dir> -- <command>` in `root`. */
export async function record(
  root: AbsolutePath,
  command: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Recorded> {
  const out = join(temp(), "parts");
  let stderr = "";
  const io = {
    stdout: () => {},
    stderr: (text: string) => {
      stderr += text;
    },
    cwd: root,
    env,
  };
  const code = await ciCommand(["record", "--out", out, "--", ...command], io);
  const names = (() => {
    try {
      return readdirSync(out).sort();
    } catch {
      return [];
    }
  })();
  const parts = names.map((name) => {
    const part = readPart(join(out, name));
    if (typeof part === "string") throw new Error(part);
    return part;
  });
  return { code, stderr, parts };
}
