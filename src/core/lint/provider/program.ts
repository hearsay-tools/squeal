import { globSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import { projectPath } from "./loaded.js";

/*
 * Spec 017 D5, amended 2026-10-26: the TypeScript program a typed config
 * reads, before any lint, from TypeScript's own config parse with no type
 * check. A tsconfig counts when one of its files is linted with a typed
 * config: `projectService` and `project: true` read the nearest
 * `tsconfig.json`; `project` as paths names its tsconfigs.
 */

/** The parts of a computed config the program reads. */
export interface TypedOptions {
  readonly project?: unknown;
  readonly projectService?: unknown;
  readonly programs?: unknown;
  readonly tsconfigRootDir?: unknown;
}

/** The parts of TypeScript's module used here. */
interface TypeScript {
  readonly sys: object;
  getParsedCommandLineOfConfigFile(
    path: string,
    options: object,
    host: object,
  ):
    | { fileNames: string[]; options: { configFile?: { extendedSourceFiles?: string[] } } }
    | undefined;
}

export interface TsProgram {
  /** Every tsconfig read, with the configs it extends, inside the project. */
  readonly tsconfigs: readonly RelativePath[];
  readonly files: readonly RelativePath[];
}

/** TypeScript as the config loaded it: the first `typescript` package among `packages`. */
export function loadedTypeScript(packages: readonly string[]): TypeScript | null {
  const root = packages.find((p) => basename(p) === "typescript");
  if (root === undefined) return null;
  return createRequire(join(root, "package.json"))(root) as TypeScript;
}

/** Every `tsconfig.json` under `root`, outside `node_modules` and dot folders. */
export function findTsconfigs(root: AbsolutePath): AbsolutePath[] {
  const found: AbsolutePath[] = [];
  const walk = (dir: AbsolutePath) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !entry.name.startsWith("."))
          walk(join(dir, entry.name));
      } else if (entry.name === "tsconfig.json") found.push(join(dir, entry.name));
    }
  };
  walk(root);
  return found.sort();
}

/** The tsconfigs a typed config's `project` names, from `tsconfigRootDir` or the root. */
export function namedTsconfigs(options: TypedOptions, root: AbsolutePath): AbsolutePath[] {
  const base = typeof options.tsconfigRootDir === "string" ? options.tsconfigRootDir : root;
  const named = Array.isArray(options.project) ? options.project : [options.project];
  return named
    .filter((p): p is string => typeof p === "string")
    .flatMap((p) => (/[*?[{]/.test(p) ? globSync(p, { cwd: base }) : [p]))
    .map((p) => (isAbsolute(p) ? p : resolve(base, p)))
    .sort();
}

/** One tsconfig's root files and the configs it extends; `null` when it does not parse. */
export function parseTsconfig(
  ts: TypeScript,
  path: AbsolutePath,
): { files: AbsolutePath[]; extended: AbsolutePath[] } | null {
  try {
    const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} };
    const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, host);
    if (parsed === undefined) return null;
    return {
      files: parsed.fileNames,
      extended: parsed.options.configFile?.extendedSourceFiles ?? [],
    };
  } catch {
    return null;
  }
}

/** The program of `tsconfigs`, as project paths. */
export function readProgram(
  ts: TypeScript,
  tsconfigs: readonly AbsolutePath[],
  root: AbsolutePath,
): TsProgram {
  const configs = new Set<RelativePath>();
  const files = new Set<RelativePath>();
  for (const tsconfig of tsconfigs) {
    const parsed = parseTsconfig(ts, tsconfig);
    for (const path of [tsconfig, ...(parsed?.extended ?? [])]) {
      const rel = projectPath(path, root);
      if (rel !== null) configs.add(rel);
    }
    for (const file of parsed?.files ?? []) {
      const rel = projectPath(file, root);
      if (rel !== null) files.add(rel);
    }
  }
  return { tsconfigs: [...configs].sort(), files: [...files].sort() };
}
