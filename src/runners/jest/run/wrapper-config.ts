import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AbsolutePath } from "../../../core/types/common.js";

/** What the wrapper loads: the project's config, through the project's own `jest-config`. */
export interface WrapperConfigOptions {
  /** Squeal's folder for the project, outside the worktree. */
  readonly cacheDir: AbsolutePath;
  /** The project's config file: a `jest.config.*` or a `package.json` with a `jest` key. */
  readonly config: AbsolutePath;
  /** The project's `jest-config` package folder (`JestInstall.config`). */
  readonly jestConfig: AbsolutePath;
  /** `JestProject.project`: the inline project of `config`'s `projects` the wrapper returns; absent, `config` itself. */
  readonly project?: string;
  /**
   * The observing runtime (`observe-runtime.cjs`, spec 028 D3). Set as the
   * config's `runtime` only when the file exists, so the runner works before
   * the observer does.
   */
  readonly observeRuntimePath?: AbsolutePath | null;
}

/**
 * Review 0.1.646 B2: the one rule that names and selects an inline project
 * object of a root config's `projects` array, as JavaScript source. The
 * config reader (`READER` in `../environment.ts`) and the wrapper both
 * embed it, so setup, keying and runs agree on which object a selector
 * means. It needs `path` in scope. The functions:
 *
 * - `inlineProjects(list)`: the plain objects of `list`, in order; string
 *   entries (files, folders, globs) are not counted, so a folder a glob
 *   gains or loses never moves an inline project's index.
 * - `inlineSelectors(list)`: each inline object's selector, in order: its
 *   trimmed `displayName` (a string or `{ name }`) when that is non-empty,
 *   does not start with `#` and no other inline object has it, else
 *   `#<index>` among the inline objects.
 * - `selectInline(list, selector)`: the inline object a selector names,
 *   or an error that says why none is.
 * - `inlineOptions(selected, configDir)`: a copy without `projects`, with
 *   `rootDir` absolute: the root config's folder when absent, else resolved
 *   against that folder (`<rootDir>` as Jest replaces it). Jest itself
 *   resolves a relative inline `rootDir` against the process's cwd, which
 *   is that folder when Jest runs from it, as a seeded project does.
 */
export const INLINE_PROJECT_RULE = String.raw`
const inlineName = (entry) => {
  const d = entry.displayName;
  if (typeof d === "string") return d.trim();
  return d !== null && typeof d === "object" && typeof d.name === "string" ? d.name.trim() : "";
};
const inlineProjects = (list) => (Array.isArray(list) ? list : [])
  .filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry));
const inlineSelectors = (list) => {
  const names = inlineProjects(list).map(inlineName);
  return names.map((name, i) =>
    name !== "" && !name.startsWith("#") && names.indexOf(name) === names.lastIndexOf(name) ? name : "#" + i);
};
const selectInline = (list, selector) => {
  const inlines = inlineProjects(list);
  if (/^#\d+$/.test(selector)) {
    const at = inlines[Number(selector.slice(1))];
    if (at === undefined) {
      throw new Error("its Jest config has no inline project " + selector + ": it has " + inlines.length);
    }
    return at;
  }
  const hits = inlines.filter((entry) => inlineName(entry) === selector);
  if (hits.length !== 1) {
    throw new Error("its Jest config has " + (hits.length === 0 ? "no" : hits.length) +
      " inline projects with displayName " + JSON.stringify(selector) + ": name one by #<index>");
  }
  return hits[0];
};
const inlineOptions = (selected, configDir) => {
  const options = { ...selected };
  delete options.projects;
  const rootDir = options.rootDir;
  options.rootDir = typeof rootDir !== "string" || rootDir === "" ? configDir
    : rootDir.startsWith("<rootDir>") ? path.resolve(configDir, path.normalize("./" + rootDir.slice(9)))
    : path.resolve(configDir, rootDir);
  return options;
};
`;

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
 * moves `<rootDir>`. With `project`, the wrapper returns that inline
 * object of the config's `projects` ({@link INLINE_PROJECT_RULE}) as a
 * config of its own. Every option stays as the project set it; only
 * `runtime` is added. The name hashes what the text holds, so runs share a
 * wrapper, and it is written to a temp name and renamed, so a batch never
 * reads one half written.
 */
export function writeWrapperConfig(options: WrapperConfigOptions): AbsolutePath {
  const runtime =
    options.observeRuntimePath != null && existsSync(options.observeRuntimePath)
      ? options.observeRuntimePath
      : null;
  const text = wrapperText(options.config, options.jestConfig, runtime, options.project);
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
  project: string | undefined,
): string {
  const json = JSON.stringify;
  const read = `await readInitialOptions(${json(config)}, { skipMultipleConfigError: true })`;
  if (project === undefined) {
    return [
      `"use strict";`,
      `// Written by Squeal (spec 028 D4.1): the project's Jest config, read as Jest reads it.`,
      `const { readInitialOptions } = require(${json(jestConfig)});`,
      `module.exports = async () => {`,
      `  const { config } = ${read};`,
      runtime === null ? `  return config;` : `  return { ...config, runtime: ${json(runtime)} };`,
      `};`,
      ``,
    ].join("\n");
  }
  const selected = runtime === null ? `selected` : `{ ...selected, runtime: ${json(runtime)} }`;
  return [
    `"use strict";`,
    `// Written by Squeal (spec 028 D4.1): keep the root global scope and narrow projects to one inline child (review 0.1.646-r2 B2).`,
    `const { readInitialOptions } = require(${json(jestConfig)});`,
    `const path = require("path");`,
    INLINE_PROJECT_RULE.trim(),
    `module.exports = async () => {`,
    `  const { config: root } = ${read};`,
    `  const configDir = ${json(dirname(config))};`,
    `  const rootDir = typeof root.rootDir !== "string" || root.rootDir === "" ? configDir : path.resolve(configDir, root.rootDir);`,
    `  const selected = inlineOptions(selectInline(root.projects, ${json(project)}), configDir);`,
    `  return { ...root, rootDir, projects: [${selected}] };`,
    `};`,
    ``,
  ].join("\n");
}
