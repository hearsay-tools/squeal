import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath } from "../../../core/types/common.js";

/** What the wrapper loads: the project's config, through the project's own `jest-config`. */
export interface WrapperConfigOptions {
  /** Squeal's folder for the project, outside the worktree. */
  readonly cacheDir: AbsolutePath;
  /** The project's config file: a `jest.config.*` or a `package.json` with a `jest` key. */
  readonly config: AbsolutePath;
  /** The project's `jest-config` package folder (`JestInstall.config`). */
  readonly jestConfig: AbsolutePath;
  /**
   * The observing runtime (`observe-runtime.cjs`, spec 028 D3). Set as the
   * config's `runtime` only when the file exists, so the runner works before
   * the observer does.
   */
  readonly observeRuntimePath?: AbsolutePath | null;
}

/**
 * Spec 028 D4.1: writes `<cacheDir>/wrap-<hash>.cjs`, the config the batch
 * passes to `--config`, and returns its path. The wrapper exports an async
 * config function, which Jest 29 and 30 both await. It reads the project's
 * config with the project's own `jest-config` `readInitialOptions`, the
 * reader `--config <file>` uses, so every format Jest reads works the same
 * way: `.js`, `.cjs`, `.mjs`, `.ts` (ts-node on Jest 29, as
 * `tsNodeHygiene` pins it), `.json`, a `package.json` `jest` key, and a
 * sync or async config function. That reader resolves `rootDir` against
 * the config's own folder, so the wrapper's place in `cacheDir` never
 * moves `<rootDir>`. Every option stays as the project set it; only
 * `runtime` is added. The name hashes what the text holds, so runs share a
 * wrapper, and it is written to a temp name and renamed, so a batch never
 * reads one half written.
 */
export function writeWrapperConfig(options: WrapperConfigOptions): AbsolutePath {
  const runtime =
    options.observeRuntimePath != null && existsSync(options.observeRuntimePath)
      ? options.observeRuntimePath
      : null;
  const text = wrapperText(options.config, options.jestConfig, runtime);
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  mkdirSync(options.cacheDir, { recursive: true });
  const path = join(options.cacheDir, `wrap-${hash}.cjs`) as AbsolutePath;
  if (!existsSync(path)) {
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, text);
    renameSync(temp, path);
  }
  return path;
}

function wrapperText(
  config: AbsolutePath,
  jestConfig: AbsolutePath,
  runtime: AbsolutePath | null,
): string {
  const json = JSON.stringify;
  return [
    `"use strict";`,
    `// Written by Squeal (spec 028 D4.1): the project's Jest config, read as Jest reads it.`,
    `const { readInitialOptions } = require(${json(jestConfig)});`,
    `module.exports = async () => {`,
    `  const { config } = await readInitialOptions(${json(config)}, { skipMultipleConfigError: true });`,
    runtime === null ? `  return config;` : `  return { ...config, runtime: ${json(runtime)} };`,
    `};`,
    ``,
  ].join("\n");
}
