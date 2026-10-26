import { existsSync, globSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import { projectPath } from "./loaded.js";

/*
 * Spec 017 D5, amended 2026-10-26 twice: the TypeScript program a typed
 * config reads, before any lint and with no type check: each tsconfig's
 * root files from TypeScript's config parse, and every file their imports
 * resolve to by TypeScript's module resolution, whatever `include` and
 * ESLint's ignores say (review 0.1.348 B3). A tsconfig counts when one of
 * its files is linted with a typed config: `projectService` and `project:
 * true` read the nearest `tsconfig.json`; `project` as paths names its
 * tsconfigs.
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
  readonly ModuleKind: { readonly ESNext: number; readonly CommonJS: number };
  readonly ModuleResolutionKind: { readonly Classic: number; readonly Node10: number };
  getParsedCommandLineOfConfigFile(
    path: string,
    options: object,
    host: object,
  ): { fileNames: string[]; options: CompilerOptions } | undefined;
  getEmitModuleResolutionKind?(options: CompilerOptions): number;
  preProcessFile(
    text: string,
    readImportFiles: boolean,
    detectJavaScriptImports: boolean,
  ): {
    readonly importedFiles: readonly FileReference[];
    readonly referencedFiles: readonly FileReference[];
    readonly typeReferenceDirectives: readonly FileReference[];
  };
  createModuleResolutionCache(
    directory: string,
    canonical: (name: string) => string,
    options: CompilerOptions,
  ): object;
  resolveModuleName(
    name: string,
    containing: string,
    options: CompilerOptions,
    host: object,
    cache: object,
    redirected: undefined,
    mode: number | undefined,
  ): { readonly resolvedModule?: { readonly resolvedFileName: string } };
  resolveTypeReferenceDirective(
    name: string,
    containing: string,
    options: CompilerOptions,
    host: object,
  ): { readonly resolvedTypeReferenceDirective?: { readonly resolvedFileName?: string } };
  getAutomaticTypeDirectiveNames(options: CompilerOptions, host: object): string[];
}

interface CompilerOptions {
  readonly configFile?: { readonly extendedSourceFiles?: string[] };
}

interface FileReference {
  readonly fileName: string;
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

interface ParsedTsconfig {
  readonly files: AbsolutePath[];
  readonly extended: AbsolutePath[];
  readonly options: CompilerOptions;
}

/** One tsconfig's root files, the configs it extends and its options; `null` when it does not parse. */
export function parseTsconfig(ts: TypeScript, path: AbsolutePath): ParsedTsconfig | null {
  try {
    const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} };
    const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, host);
    if (parsed === undefined) return null;
    return {
      files: parsed.fileNames,
      extended: parsed.options.configFile?.extendedSourceFiles ?? [],
      options: parsed.options,
    };
  } catch {
    return null;
  }
}

/** A file's module specifiers and reference directives, kept while its stat stays. */
interface References {
  readonly stamp: string;
  readonly modules: readonly string[];
  readonly paths: readonly string[];
  readonly types: readonly string[];
}

const NODE_MODULES = `${sep}node_modules${sep}`;
const JAVASCRIPT = /\.[cm]?jsx?$/;
/** JSDoc's `@import … from "x"` and `import("x")` types, which TypeScript follows in JavaScript. */
const JSDOC_IMPORT =
  /@import\s[^"'@]*?\bfrom\s*["']([^"'\n]+)["']|\bimport\(\s*["']([^"'\n]+)["']\s*\)/g;

/**
 * Reads the program of the relevant tsconfigs at each refresh. Resolution
 * runs again each time, so a file added, moved or removed is seen; each
 * file's specifiers are kept by its stat (mtime, ctime, size, inode), so
 * an unchanged file is not read again.
 */
export class ProgramReader {
  private readonly references = new Map<AbsolutePath, References>();

  constructor(
    readonly ts: TypeScript,
    private readonly root: AbsolutePath,
  ) {}

  /** The program of `tsconfigs`, as project paths. */
  read(tsconfigs: readonly AbsolutePath[]): TsProgram {
    const configs = new Set<RelativePath>();
    const files = new Set<RelativePath>();
    for (const tsconfig of tsconfigs) {
      const parsed = parseTsconfig(this.ts, tsconfig);
      for (const path of [tsconfig, ...(parsed?.extended ?? [])]) {
        const rel = projectPath(path, this.root);
        if (rel !== null) configs.add(rel);
      }
      if (parsed === null) continue;
      for (const file of this.walk(tsconfig, parsed)) {
        const rel = projectPath(file, this.root);
        if (rel !== null) files.add(rel);
      }
    }
    return { tsconfigs: [...configs].sort(), files: [...files].sort() };
  }

  /**
   * The root files and every file their imports, reference directives and
   * automatic types resolve to, followed outside `node_modules`: a
   * package's own imports are the install's (D5's packages).
   */
  private walk(tsconfig: AbsolutePath, parsed: ParsedTsconfig): Set<AbsolutePath> {
    const { ts } = this;
    const { options } = parsed;
    const cache = ts.createModuleResolutionCache(dirname(tsconfig), (name) => name, options);
    const modes = this.modes(options);
    const seen = new Set<AbsolutePath>(parsed.files);
    const queue = [...parsed.files];
    const follow = (file: string | undefined) => {
      if (file === undefined || seen.has(file) || file.includes(NODE_MODULES)) return;
      seen.add(file);
      queue.push(file);
    };
    const type = (name: string, containing: string) =>
      ts.resolveTypeReferenceDirective(name, containing, options, ts.sys)
        .resolvedTypeReferenceDirective?.resolvedFileName;
    const inferred = join(dirname(tsconfig), "__inferred type names__.ts");
    for (const name of ts.getAutomaticTypeDirectiveNames(options, ts.sys)) {
      follow(type(name, inferred));
    }
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      const found = this.referencesOf(file);
      for (const name of found?.modules ?? []) {
        for (const mode of modes) {
          follow(
            ts.resolveModuleName(name, file, options, ts.sys, cache, undefined, mode).resolvedModule
              ?.resolvedFileName,
          );
        }
      }
      for (const name of found?.types ?? []) follow(type(name, file));
      for (const path of found?.paths ?? []) follow(referenced(resolve(dirname(file), path)));
    }
    return seen;
  }

  /**
   * Both import modes where the resolution kind reads them (Node16,
   * NodeNext, Bundler): the walk does not tell an `import` from a
   * `require`, so it takes the files either resolves to.
   */
  private modes(options: CompilerOptions): (number | undefined)[] {
    const { ModuleKind, ModuleResolutionKind } = this.ts;
    const kind = this.ts.getEmitModuleResolutionKind?.(options);
    return kind === ModuleResolutionKind.Classic || kind === ModuleResolutionKind.Node10
      ? [undefined]
      : [ModuleKind.ESNext, ModuleKind.CommonJS];
  }

  private referencesOf(file: AbsolutePath): References | null {
    let stamp: string;
    let text: string;
    try {
      const stat = statSync(file, { bigint: true });
      stamp = `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}:${stat.ino}`;
      const kept = this.references.get(file);
      if (kept?.stamp === stamp) return kept;
      text = readFileSync(file, "utf8");
    } catch {
      return null;
    }
    const javascript = JAVASCRIPT.test(file);
    const info = this.ts.preProcessFile(text, true, javascript);
    const modules = info.importedFiles.map((f) => f.fileName);
    if (javascript) {
      for (const match of text.matchAll(JSDOC_IMPORT)) modules.push(match[1] ?? match[2] ?? "");
    }
    const found: References = {
      stamp,
      modules: [...new Set(modules)],
      paths: info.referencedFiles.map((f) => f.fileName),
      types: info.typeReferenceDirectives.map((f) => f.fileName),
    };
    this.references.set(file, found);
    return found;
  }
}

/** A `/// <reference path>`'s file, as TypeScript completes a path with no extension. */
function referenced(path: AbsolutePath): AbsolutePath | undefined {
  return [path, `${path}.ts`, `${path}.tsx`, `${path}.d.ts`].find((p) => existsSync(p));
}
