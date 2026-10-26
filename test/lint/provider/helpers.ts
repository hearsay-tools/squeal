import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { buildSync } from "esbuild";
import { afterAll, afterEach } from "vitest";
import { type EslintMessage, eslintFindings } from "../../../src/core/lint/eslint.js";
import { eslintProvider } from "../../../src/core/lint/provider/eslint-provider.js";
import type {
  EslintProviderOptions,
  LintFileResult,
  LintProvider,
} from "../../../src/core/lint/provider/index.js";

const REPO = join(import.meta.dirname, "../../..");
const TOOLCHAIN = join(REPO, "test/fixtures/lint/toolchain/node_modules");
export const FIXTURES = join(REPO, "test/fixtures/lint");

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const scripts = new Map<string, string>();
let scriptDir: string | null = null;
afterAll(() => {
  if (scriptDir !== null) rmSync(scriptDir, { recursive: true, force: true });
});

/**
 * The worker bundled as the build bundles it (`src/harness/build.ts`), once
 * per test file; `entry` bundles a test's own entry instead.
 */
export function workerScript(entry = "src/core/lint/provider/worker.ts"): string {
  const built = scripts.get(entry);
  if (built !== undefined) return built;
  scriptDir ??= mkdtempSync(join(tmpdir(), "squeal-lint-worker-"));
  const script = join(scriptDir, `lint-worker-${scripts.size}.mjs`);
  buildSync({
    entryPoints: [join(REPO, entry)],
    outfile: script,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "warning",
  });
  scripts.set(entry, script);
  return script;
}

export type Major = 9 | 10;

/**
 * A copy of `test/fixtures/lint/<name>` in a temp folder, removed after the
 * test, with its tools installed.
 */
export function project(name: string, major: Major = 10): string {
  const root = mkdtempSync(join(tmpdir(), `squeal-lint-${name}-`));
  cleanups.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));
  for (const path of sources(name)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(FIXTURES, name, path), join(root, path));
  }
  install(root, name, major);
  return root;
}

/** The fixture's files, its `packages` left out: they are installed. */
export function sources(name: string): string[] {
  const dir = join(FIXTURES, name);
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .filter((path) => !path.startsWith("packages/"))
    .sort();
}

/**
 * ESLint 9 or 10 and the toolchain linked into `root`'s `node_modules`,
 * and each of the fixture's `packages/<name>` copied there as an installed
 * package.
 */
export function install(root: string, name: string, major: Major = 10): void {
  const modules = join(root, "node_modules");
  mkdirSync(modules);
  symlinkSync(
    join(REPO, "node_modules", major === 9 ? "eslint9" : "eslint"),
    join(modules, "eslint"),
  );
  for (const tool of ["typescript-eslint", "typescript"]) {
    symlinkSync(join(TOOLCHAIN, tool), join(modules, tool));
  }
  const packages = join(FIXTURES, name, "packages");
  if (existsSync(packages)) {
    for (const pkg of readdirSync(packages))
      cpSync(join(packages, pkg), join(modules, pkg), { recursive: true });
  }
}

/** A provider on `root` with the bundled worker, closed after the test. */
export function provider(
  root: string,
  options: Omit<EslintProviderOptions, "root"> = {},
): LintProvider {
  const made = eslintProvider({ root, script: workerScript(), env: {}, ...options });
  cleanups.push(() => made.close());
  return made;
}

export function read(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

export function write(root: string, path: string, text: string): void {
  writeFileSync(join(root, path), text);
}

/** `files` as the provider takes them, at their bytes on disk. */
export function onDisk(root: string, paths: readonly string[]) {
  return paths.map((path) => ({ path, text: read(root, path) }));
}

/** A fresh `eslint -f json` run in `root`: each file's result as the provider gives it. */
export function cli(
  root: string,
  paths: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Map<string, LintFileResult> {
  const run = spawnSync(
    process.execPath,
    [join(root, "node_modules/eslint/bin/eslint.js"), "-f", "json", ...paths],
    { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } },
  );
  if (run.status !== 0 && run.status !== 1)
    throw new Error(`eslint exited ${run.status}: ${run.stderr}`);
  const out = new Map<string, LintFileResult>();
  for (const result of JSON.parse(run.stdout) as {
    filePath: string;
    messages: EslintMessage[];
  }[]) {
    const path = relative(root, result.filePath);
    out.set(path, { findings: eslintFindings(result.messages, read(root, path)) });
  }
  return out;
}
