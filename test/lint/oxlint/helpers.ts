import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import {
  type OxlintProvider,
  type OxlintProviderOptions,
  oxlintProvider,
} from "../../../src/core/lint/provider/oxlint/index.js";
import type { AbsolutePath } from "../../../src/core/types/index.js";

/*
 * Spec 017 D11 tests: scratch projects under the system temp folder, with
 * this repository's oxlint (a devDependency) linked in. Fixture files are
 * written from strings, so Biome and tsc never check them as code.
 */

const REPO = join(import.meta.dirname, "../../..");
export const OXLINT_PACKAGE = join(REPO, "node_modules/oxlint");

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A temp folder removed after the test. */
export function scratch(prefix = "squeal-oxlint-test-"): AbsolutePath {
  const dir = mkdtempSync(join(tmpdir(), prefix)) as AbsolutePath;
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
  return dir;
}

/** Writes `files` under `root`, folders made as needed. */
export function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** A project at `root` (a new temp folder by default) with `files` and oxlint installed. */
export function project(files: Readonly<Record<string, string>>, root = scratch()): AbsolutePath {
  write(root, files);
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(OXLINT_PACKAGE, join(root, "node_modules/oxlint"));
  return root as AbsolutePath;
}

/** An opened provider for `root`, closed after the test. */
export function provider(
  root: AbsolutePath,
  options: Partial<OxlintProviderOptions> = {},
): OxlintProvider {
  const made = oxlintProvider({ root, env: { PATH: process.env.PATH }, ...options });
  cleanups.push(() => made.close());
  return made;
}

/** A JS plugin whose one rule `bad/r` runs `body` when it is created. */
export function badPlugin(body: string): Record<string, string> {
  return {
    "bad.mjs": `import { spawn } from "node:child_process";\nimport { writeFileSync } from "node:fs";\nexport default { meta: { name: "bad" }, rules: { r: { create(context) { ${body} return {}; } } } };\n`,
    ".oxlintrc.json": JSON.stringify({ jsPlugins: ["./bad.mjs"], rules: { "bad/r": "error" } }),
    "src/a.js": "export const a = 1;\n",
  };
}

/** Whether a process lives: signal 0 reaches it. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
