import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach } from "vitest";
import { codeCommand } from "../../src/cli/code.js";
import { initRepo, writeFile } from "../hash/git-repo.js";

/*
 * Spec 020 (row 020-05): temporary git repositories for `squeal code
 * --base`, made under the gate fixtures' git-ignored `.tmp/`, so `vitest`
 * resolves from the repository's `node_modules`. Each run has `HOME` and
 * `TMPDIR` of its own, and no daemon.
 */

const SCRATCH = resolve(import.meta.dirname, "../fixtures/code/gate/.tmp");

/** Each run starts a real Vitest instance; a loaded host needs headroom. */
export const SLOW = { timeout: 120_000 } as const;

/** The base commit's files: one source, one test file that loads it. */
export const BASE: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "gate-cli", private: true, type: "module" })}\n`,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
  "src/math.ts": "export function double(x: number): number {\n  return x * 2;\n}\n",
  "test/math.test.ts": `import { expect, it } from "vitest";\nimport { double } from "../src/math";\n\nit("doubles", () => expect(double(2)).toBe(4));\n`,
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A git repository on `main` with `files` committed, removed after the test. */
export function repo(files: Readonly<Record<string, string>> = BASE): string {
  mkdirSync(SCRATCH, { recursive: true });
  const root = join(SCRATCH, `cli-${randomUUID()}`);
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  initRepo(root, files);
  return root;
}

/** Writes `files` into the working tree, uncommitted. */
export function edit(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) writeFile(root, path, content);
}

/**
 * `HOME` and `TMPDIR` of the test's own while it runs, restored and removed
 * after it; the result lists what is left in `TMPDIR`.
 */
export function ownHomeAndTmp(): () => readonly string[] {
  const saved = { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  const home = mkdtempSync(join(tmpdir(), "squeal-gate-home-"));
  const temp = mkdtempSync(join(tmpdir(), "squeal-gate-tmp-"));
  process.env.HOME = home;
  process.env.TMPDIR = temp;
  cleanups.push(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
  });
  return () => readdirSync(temp);
}

export interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** `squeal code <args>` in `cwd`, as the CLI dispatches it. */
export async function code(cwd: string, args: readonly string[]): Promise<Ran> {
  let stdout = "";
  let stderr = "";
  const result = await codeCommand(args, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env: {},
  });
  return { code: result, stdout, stderr };
}

/**
 * Squeal's own `--test` flag, built from parts: `test/version-sensitive.test.ts`
 * reads a quoted one as node's `--test` argument, and these tests run no
 * node:test project.
 */
export const TEST_FLAG = ["--", "test"].join("");
