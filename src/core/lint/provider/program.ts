import {
  type Dirent,
  existsSync,
  globSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { blobHash, type ObjectFormat } from "../../hash/blob.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import { lookupRecord } from "../pass/state.js";
import { keyPath } from "./loaded.js";
import { stateOf, Watch } from "./watch.js";

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
  ):
    | {
        fileNames: string[];
        options: CompilerOptions;
        wildcardDirectories?: Readonly<Record<string, number>>;
      }
    | undefined;
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
  /** Each file whose imports the walk read, and each tsconfig it parsed, at the blob of the bytes it read (wave 1.7 W2). */
  readonly walked?: ReadonlyMap<AbsolutePath, string>;
  /** The paths whose state decides a lookup the walk made, at that state (Q3). */
  readonly lookups?: ReadonlyMap<AbsolutePath, string>;
  /**
   * A name a file kept resolved to another file than before (Q1), or a
   * tsconfig's root files changed: TypeScript's service keeps the old ones.
   */
  readonly moved?: boolean;
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
  /** The folders `include` globs read, each with TypeScript's `WatchDirectoryFlags`. */
  readonly wildcardDirectories?: Readonly<Record<string, number>>;
}

/**
 * One tsconfig's root files, the configs it extends and its options; `null`
 * when it does not parse. `readFile` reads its files as `ts.sys` does.
 */
export function parseTsconfig(
  ts: TypeScript,
  path: AbsolutePath,
  readFile: (path: string) => string | undefined = sysText,
): ParsedTsconfig | null {
  try {
    const host = { ...ts.sys, readFile, onUnRecoverableConfigFileDiagnostic: () => {} };
    const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, host);
    if (parsed === undefined) return null;
    return {
      files: parsed.fileNames,
      extended: parsed.options.configFile?.extendedSourceFiles ?? [],
      options: parsed.options,
      ...(parsed.wildcardDirectories ? { wildcardDirectories: parsed.wildcardDirectories } : {}),
    };
  } catch {
    return null;
  }
}

/** Whether two parses of one tsconfig hold the same root files. */
function sameRoots(a: ParsedTsconfig | null, b: ParsedTsconfig | null): boolean {
  const roots = (parsed: ParsedTsconfig | null) => [...(parsed?.files ?? [])].sort().join("\0");
  return roots(a) === roots(b);
}

/** A file's specifiers, kept by its stat, and the blob of the bytes they were read from. */
interface Specifiers {
  readonly stamp: string;
  readonly blob: string;
  readonly modules: readonly string[];
  readonly paths: readonly string[];
  readonly types: readonly string[];
}

/** Where a file's specifiers resolved under one tsconfig, at the file's `stamp`. */
interface Resolved {
  readonly stamp: string;
  readonly targets: readonly AbsolutePath[];
  /** Each name's target, `""` for none: a kept name that resolves elsewhere moves the program (Q1). */
  readonly names: ReadonlyMap<string, string>;
  /** Folders the resolutions looked in and manifests they read, outside `node_modules`. */
  readonly read: readonly string[];
  /** A resolution failed without saying where it looked: resolved again at each walk. */
  readonly unsure: boolean;
}

/** A tsconfig's parse, kept while it and the folders its `include` glob reads keep their state. */
interface Parsed {
  readonly parsed: ParsedTsconfig | null;
  readonly read: readonly string[];
  /** The files the parse read, at the blob of their bytes. */
  readonly blobs: ReadonlyMap<AbsolutePath, string>;
}

/** A resolution's lookup locations, which TypeScript returns beside the result. */
interface Lookups {
  readonly failedLookupLocations?: readonly string[];
  readonly affectingLocations?: readonly string[];
}

/** The file a name resolves to, and where TypeScript looked. */
type Resolution = readonly [target: string | undefined, lookups: Lookups];

/** One walk's resolution of a tsconfig's names, with one cache. */
interface Resolver {
  module(name: string, file: string, mode: number | undefined): Resolution;
  type(name: string, file: string): Resolution;
  readonly modes: readonly (number | undefined)[];
}

const NODE_MODULES = `${sep}node_modules${sep}`;
const JAVASCRIPT = /\.[cm]?jsx?$/;
/** JSDoc's `@import … from "x"` and `import("x")` types, which TypeScript follows in JavaScript. */
const JSDOC_IMPORT =
  /@import\s[^"'@]*?\bfrom\s*["']([^"'\n]+)["']|\bimport\(\s*["']([^"'\n]+)["']\s*\)/g;
/** `WatchDirectoryFlags.Recursive`. */
const RECURSIVE = 1;

/**
 * Reads the program of the relevant tsconfigs at each refresh, again only
 * where it may have moved: a file is read again when its stat (mtime and
 * ctime, size, inode) changes, and resolved again when it was read again
 * or a folder its resolutions looked in, or a manifest they read, changed
 * state (a folder's mtime moves when an entry is added, removed or
 * renamed). A tsconfig is parsed again when it, a config it extends or a
 * folder its `include` glob reads changed state. The result equals a walk
 * from nothing (`units.test.ts`).
 */
export class ProgramReader {
  private readonly specifiers = new Map<AbsolutePath, Specifiers>();
  /** By tsconfig, then file: two tsconfigs may resolve one file's names apart. */
  private readonly resolved = new Map<AbsolutePath, Map<AbsolutePath, Resolved>>();
  private readonly parsed = new Map<AbsolutePath, Parsed>();
  private readonly watch: Watch;
  private readonly paths = new Map<AbsolutePath, RelativePath | null>();
  /** TypeScript's system with the walk's own reads: TypeScript's service holds none of them (wave 1.7). */
  private readonly host: object;
  /** The blob of each file the walk's lookups last read, as a manifest. */
  private readonly manifests = new Map<string, string>();
  private moved = false;

  constructor(
    readonly ts: TypeScript,
    private readonly root: AbsolutePath,
    private readonly now: () => number = Date.now,
    private readonly format: ObjectFormat = "sha1",
  ) {
    this.watch = new Watch(now);
    this.host = { ...ts.sys, readFile: (path: string) => this.text(path, this.manifests) };
  }

  /** The program of `tsconfigs`, as key paths: `../` above the root (wave 1.7 Q2). */
  read(tsconfigs: readonly AbsolutePath[]): TsProgram {
    this.watch.restat();
    const configs = new Set<RelativePath>();
    const files = new Set<RelativePath>();
    const walked = new Map<AbsolutePath, string>();
    for (const tsconfig of tsconfigs) {
      const parsed = this.parse(tsconfig);
      for (const [path, blob] of this.parsed.get(tsconfig)?.blobs ?? []) walked.set(path, blob);
      for (const path of [tsconfig, ...(parsed?.extended ?? [])]) {
        const rel = this.keyPath(path);
        if (rel !== null) configs.add(rel);
      }
      if (parsed === null) continue;
      for (const file of this.walk(tsconfig, parsed)) {
        const blob = this.specifiers.get(file)?.blob;
        if (blob !== undefined) walked.set(file, blob);
        const rel = this.keyPath(file);
        if (rel !== null) files.add(rel);
      }
    }
    const moved = this.moved;
    this.moved = false;
    const lookups = new Map<AbsolutePath, string>();
    for (const [path, { state, entries }] of this.watch.watched()) {
      const blob = this.manifests.get(path);
      lookups.set(path, lookupRecord(state, entries ?? (blob === undefined ? "" : `#${blob}`)));
    }
    return { tsconfigs: [...configs].sort(), files: [...files].sort(), walked, lookups, moved };
  }

  /** A file's text as `ts.sys.readFile` gives it, its blob kept in `blobs`. */
  private text(path: string, blobs: Map<string, string>): string | undefined {
    const bytes = bytesOf(path);
    if (bytes === undefined) return undefined;
    blobs.set(path, blobHash(bytes, this.format));
    return textOf(bytes);
  }

  private keyPath(path: AbsolutePath): RelativePath | null {
    let rel = this.paths.get(path);
    if (rel === undefined) {
      rel = keyPath(path, [this.root]);
      this.paths.set(path, rel);
    }
    return rel;
  }

  private parse(tsconfig: AbsolutePath): ParsedTsconfig | null {
    const kept = this.parsed.get(tsconfig);
    if (kept !== undefined && this.watch.holds(tsconfig)) return kept.parsed;
    const blobs = new Map<AbsolutePath, string>();
    const parsed = parseTsconfig(this.ts, tsconfig, (path) => this.text(path, blobs));
    for (const [path, blob] of blobs) this.manifests.set(path, blob);
    // A root file added or removed: TypeScript's service never parses the tsconfig again.
    if (kept !== undefined && !sameRoots(kept.parsed, parsed)) this.moved = true;
    const read = [tsconfig, ...(parsed?.extended ?? []), ...globFolders(parsed)];
    this.watch.made(tsconfig, read, kept?.read);
    this.parsed.set(tsconfig, { parsed, read, blobs });
    return parsed;
  }

  /**
   * The root files and every file their imports, reference directives and
   * automatic types resolve to, followed outside `node_modules`: a
   * package's own imports are the install's (D5's packages).
   */
  private walk(tsconfig: AbsolutePath, parsed: ParsedTsconfig): Set<AbsolutePath> {
    const { ts } = this;
    const { options } = parsed;
    let cache: object | null = null;
    const resolver: Resolver = {
      module: (name, file, mode) => {
        cache ??= ts.createModuleResolutionCache(dirname(tsconfig), (n) => n, options);
        const result = ts.resolveModuleName(name, file, options, this.host, cache, undefined, mode);
        return [result.resolvedModule?.resolvedFileName, result as Lookups];
      },
      type: (name, file) => {
        const result = ts.resolveTypeReferenceDirective(name, file, options, this.host);
        return [result.resolvedTypeReferenceDirective?.resolvedFileName, result as Lookups];
      },
      modes: this.modes(options),
    };
    const seen = new Set<AbsolutePath>(parsed.files);
    const queue = [...parsed.files];
    const follow = (file: string | undefined) => {
      if (file === undefined || seen.has(file) || file.includes(NODE_MODULES)) return;
      seen.add(file);
      queue.push(file);
    };
    const inferred = join(dirname(tsconfig), "__inferred type names__.ts");
    for (const name of ts.getAutomaticTypeDirectiveNames(options, this.host)) {
      follow(resolver.type(name, inferred)[0]);
    }
    const resolved = this.resolved.get(tsconfig) ?? new Map<AbsolutePath, Resolved>();
    this.resolved.set(tsconfig, resolved);
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      for (const target of this.targetsOf(tsconfig, file, resolver, resolved)) follow(target);
    }
    return seen;
  }

  /** Where `file`'s specifiers resolve: kept, unless its bytes or what its lookups read changed. */
  private targetsOf(
    tsconfig: AbsolutePath,
    file: AbsolutePath,
    resolver: Resolver,
    kept: Map<AbsolutePath, Resolved>,
  ): readonly AbsolutePath[] {
    const specifiers = this.specifiersOf(file);
    if (specifiers === null) return [];
    const before = kept.get(file);
    const key = `${tsconfig}\0${file}`;
    if (before?.stamp === specifiers.stamp && !before.unsure && this.watch.holds(key)) {
      return before.targets;
    }
    const targets: AbsolutePath[] = [];
    const names = new Map<string, string>();
    const watched = new Set<string>();
    let unsure = false;
    const found = (name: string, [target, lookups]: Resolution) => {
      const failed = lookups.failedLookupLocations;
      if (target === undefined && failed === undefined) unsure = true;
      for (const path of [...(failed ?? []), ...(target ? [target] : [])]) {
        if (!path.includes(NODE_MODULES)) watched.add(dirname(path));
      }
      for (const path of lookups.affectingLocations ?? []) {
        if (!path.includes(NODE_MODULES)) watched.add(path);
      }
      names.set(name, target ?? "");
      if (target !== undefined) targets.push(target);
    };
    for (const name of specifiers.modules) {
      for (const mode of resolver.modes)
        found(`${mode} ${name}`, resolver.module(name, file, mode));
    }
    for (const name of specifiers.types) found(`types ${name}`, resolver.type(name, file));
    for (const path of specifiers.paths) {
      const target = referenced(resolve(dirname(file), path));
      watched.add(dirname(resolve(dirname(file), path)));
      names.set(`path ${path}`, target ?? "");
      if (target !== undefined) targets.push(target);
    }
    for (const [name, target] of before?.names ?? []) {
      if ((names.get(name) ?? target) !== target) this.moved = true;
    }
    this.watch.made(key, watched, before?.read);
    kept.set(file, { stamp: specifiers.stamp, targets, names, read: [...watched], unsure });
    return targets;
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

  /** `file`'s specifiers, read again when its stat changed; `null` when it cannot be read. */
  private specifiersOf(file: AbsolutePath): Specifiers | null {
    const stamp = stateOf(file, this.now);
    const kept = this.specifiers.get(file);
    if (kept?.stamp === stamp) return kept;
    const bytes = bytesOf(file);
    if (bytes === undefined) {
      this.specifiers.delete(file);
      return null;
    }
    const text = bytes.toString("utf8");
    const javascript = JAVASCRIPT.test(file);
    const info = this.ts.preProcessFile(text, true, javascript);
    const modules = info.importedFiles.map((f) => f.fileName);
    if (javascript) {
      for (const match of text.matchAll(JSDOC_IMPORT)) modules.push(match[1] ?? match[2] ?? "");
    }
    const specifiers: Specifiers = {
      stamp,
      blob: blobHash(bytes, this.format),
      modules: [...new Set(modules)],
      paths: info.referencedFiles.map((f) => f.fileName),
      types: info.typeReferenceDirectives.map((f) => f.fileName),
    };
    this.specifiers.set(file, specifiers);
    return specifiers;
  }
}

/**
 * The folders a tsconfig's `include` glob reads: each wildcard folder, and
 * below a recursive one every folder but `node_modules` and dot folders,
 * which TypeScript's `**` skips too. More folders than TypeScript reads
 * only parse it again more often.
 */
function globFolders(parsed: ParsedTsconfig | null): string[] {
  const out: string[] = [];
  /** Linked folders by their real path: a link may loop back. */
  const links = new Set<string>();
  const visit = (dir: string, recursive: boolean) => {
    out.push(dir);
    if (!recursive) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path, true);
      else if (entry.isSymbolicLink() && statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
        const real = realpathSync(path);
        if (links.has(real)) continue;
        links.add(real);
        visit(path, true);
      }
    }
  };
  for (const [dir, flags] of Object.entries(parsed?.wildcardDirectories ?? {})) {
    visit(dir, (flags & RECURSIVE) !== 0);
  }
  return out;
}

/** A `/// <reference path>`'s file, as TypeScript completes a path with no extension. */
function referenced(path: AbsolutePath): AbsolutePath | undefined {
  return [path, `${path}.ts`, `${path}.tsx`, `${path}.d.ts`].find((p) => existsSync(p));
}

/** A file's bytes; `undefined` when it cannot be read. */
function bytesOf(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

/** A file's text as `ts.sys.readFile` gives it, its byte order mark read and dropped. */
function textOf(bytes: Buffer): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const even = bytes.subarray(2, 2 + ((bytes.length - 2) & ~1));
    return Buffer.from(even).swap16().toString("utf16le");
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString("utf16le", 2);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.toString("utf8", 3);
  return bytes.toString("utf8");
}

/** `ts.sys.readFile` over the walk's own reads. */
function sysText(path: string): string | undefined {
  const bytes = bytesOf(path);
  return bytes === undefined ? undefined : textOf(bytes);
}
