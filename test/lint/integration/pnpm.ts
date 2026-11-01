import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { type EslintMessage, eslintFindings } from "../../../src/core/lint/eslint.js";
import type { LintFileResult } from "../../../src/core/lint/provider/index.js";

/*
 * Rows 017-19 and 017-20: ESLint 10 installed as pnpm installs it, and
 * `pnpm exec eslint` run through the shim pnpm wrote for this repository.
 */

const REPO = join(import.meta.dirname, "../../..");
const SHIM = join(REPO, "node_modules/.bin/eslint");

/** The folder of this repository's ESLint in pnpm's store, as its shim names it. */
function storeFolder(): string {
  const folder = /\.pnpm\/(eslint@[^/]+)\/node_modules\/eslint\//.exec(readFileSync(SHIM, "utf8"));
  if (folder?.[1] === undefined) throw new Error(`${SHIM} names no ESLint in pnpm's store`);
  return folder[1];
}

/**
 * ESLint at `root` as pnpm 12 lays it out: a link into `.pnpm`, the bin
 * shim, and pnpm's hoisted folder `.pnpm/node_modules`.
 */
export function pnpmInstall(root: string): void {
  const store = join(root, "node_modules/.pnpm", storeFolder(), "node_modules");
  mkdirSync(store, { recursive: true });
  symlinkSync(realpathSync(join(REPO, "node_modules/eslint")), join(store, "eslint"));
  symlinkSync(
    relative(join(root, "node_modules"), join(store, "eslint")),
    join(root, "node_modules/eslint"),
  );
  mkdirSync(join(root, "node_modules/.bin"));
  copyFileSync(SHIM, join(root, "node_modules/.bin/eslint"));
  mkdirSync(join(root, "node_modules/.pnpm/node_modules"));
}

/** A package only in pnpm's hoisted folder: no project declares it. */
export function hoisted(root: string, name: string, index: string): void {
  const dir = join(root, "node_modules/.pnpm/node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
  );
  writeFileSync(join(dir, "index.js"), index);
}

/** `pnpm exec eslint -f json` in `root`: each file's result as the provider gives it. */
export function pnpmExec(root: string, paths: readonly string[]): Map<string, LintFileResult> {
  const run = spawnSync("pnpm", ["exec", "eslint", "-f", "json", ...paths], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  if (run.status !== 0 && run.status !== 1)
    throw new Error(`pnpm exec eslint exited ${run.status}: ${run.stderr}${run.stdout}`);
  const out = new Map<string, LintFileResult>();
  for (const result of JSON.parse(run.stdout) as {
    filePath: string;
    messages: EslintMessage[];
  }[]) {
    const path = relative(root, result.filePath);
    out.set(path, {
      findings: eslintFindings(result.messages, readFileSync(join(root, path), "utf8")),
    });
  }
  return out;
}
