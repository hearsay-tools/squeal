import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AbsolutePath } from "../../../core/types/common.js";

/**
 * What tsx takes from one importer's tsconfig `extends` chain (spec 003 D3,
 * `reviews/wave-1.md` S1): `paths` are relative to an effective `baseUrl`
 * when one is set anywhere in the chain, else to the directory of the file
 * that defines them; `baseUrl` is relative to the file that defines it.
 */
export interface TsconfigPaths {
  /** The config whose own `paths` win, so enhanced-resolve reads them from their defining directory. */
  readonly pathsFile: AbsolutePath | null;
  /** The effective `baseUrl`, absolute; bare specifiers resolve against it too. */
  readonly baseUrl: AbsolutePath | null;
  /** Every config of the chain, the importer's first: each is a resolution read. */
  readonly files: readonly AbsolutePath[];
}

/** Reads a file as text, or `null`; the resolver's cached file system. */
export type ReadText = (path: string) => string | null;

/**
 * The effective `paths` and `baseUrl` of `file`. An `extends` value is a
 * path (with or without `.json`) or a package (`node_modules/<x>`,
 * `<x>.json`, `<x>/tsconfig.json`); an array merges in order, the file's own
 * options last. A config that does not read or parse counts as empty.
 */
export function readTsconfigPaths(file: AbsolutePath, read: ReadText): TsconfigPaths {
  const files: AbsolutePath[] = [];
  type Effective = Pick<TsconfigPaths, "pathsFile" | "baseUrl">;
  const load = (config: AbsolutePath, seen: ReadonlySet<string>): Effective => {
    files.push(config);
    const json = parseJsonc(read(config));
    const raw = json?.extends;
    const bases = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
    let pathsFile: AbsolutePath | null = null;
    let baseUrl: AbsolutePath | null = null;
    for (const base of bases) {
      if (typeof base !== "string") continue;
      const target = locate(base, dirname(config), read);
      if (target === null || seen.has(target)) continue;
      const inherited = load(target, new Set([...seen, target]));
      pathsFile = inherited.pathsFile ?? pathsFile;
      baseUrl = inherited.baseUrl ?? baseUrl;
    }
    const options = json?.compilerOptions;
    if (isObject(options)) {
      if (isObject(options.paths)) pathsFile = config;
      if (typeof options.baseUrl === "string") baseUrl = resolve(dirname(config), options.baseUrl);
    }
    return { pathsFile, baseUrl };
  };
  return { ...load(file, new Set([file])), files };
}

/** One config chain's `paths` and `baseUrl`, compiled as tsx 4 compiles them. */
export interface PathAliases {
  readonly exact: ReadonlyMap<string, readonly string[]>;
  readonly patterns: readonly {
    readonly prefix: string;
    readonly suffix: string;
    readonly substitutions: readonly string[];
  }[];
  /** The effective `baseUrl`; only it maps a bare name no pattern matches. */
  readonly baseUrl: AbsolutePath | null;
}

/**
 * Row 018-66: tsx 4's `compilePaths`. Substitutions resolve against the
 * effective `baseUrl`, else the directory of the config whose `paths` win.
 * `null` when the chain sets neither.
 */
export function compileAliases(chain: TsconfigPaths, read: ReadText): PathAliases | null {
  if (chain.pathsFile === null && chain.baseUrl === null) return null;
  const base = chain.baseUrl ?? dirname(chain.pathsFile ?? "");
  const options = chain.pathsFile === null ? null : parseJsonc(read(chain.pathsFile));
  const raw = isObject(options?.compilerOptions) ? options.compilerOptions.paths : null;
  const exact = new Map<string, string[]>();
  const patterns: { prefix: string; suffix: string; substitutions: string[] }[] = [];
  for (const [pattern, targets] of Object.entries(isObject(raw) ? raw : {})) {
    if (!Array.isArray(targets)) continue;
    const substitutions = targets
      .filter((t): t is string => typeof t === "string")
      .map((t) => resolve(base, t));
    const star = pattern.indexOf("*");
    if (star === -1) exact.set(pattern, substitutions);
    else
      patterns.push({
        prefix: pattern.slice(0, star),
        suffix: pattern.slice(star + 1),
        substitutions,
      });
  }
  return { exact, patterns, baseUrl: chain.baseUrl };
}

/** tsx 4: a URL or a scheme names no alias, nor does `.`, `..` or a path under them. */
const URL_LIKE = /^(?:[a-z][\d+.a-z-]*:\/\/|data:|file:|node:)/i;
const DOTS = /^\.{1,2}(\/.*)?$/;

/**
 * Row 018-66: tsx 4's `resolvePathAlias`, the absolute paths tsx tries for
 * `specifier`, in order, before it resolves the specifier as written. An
 * exact pattern wins, then the wildcard with the longest prefix; with no
 * match, only a `baseUrl` maps the name.
 */
export function aliasCandidates(aliases: PathAliases, specifier: string): string[] {
  const path = isAbsolute(specifier) || isRelative(specifier) || DOTS.test(specifier);
  if (path || URL_LIKE.test(specifier)) return [];
  const exact = aliases.exact.get(specifier);
  if (exact !== undefined) return [...exact];
  let best: PathAliases["patterns"][number] | null = null;
  for (const pattern of aliases.patterns) {
    const matches = specifier.startsWith(pattern.prefix) && specifier.endsWith(pattern.suffix);
    if (matches && pattern.prefix.length > (best?.prefix.length ?? -1)) best = pattern;
  }
  if (best === null) return aliases.baseUrl === null ? [] : [join(aliases.baseUrl, specifier)];
  const star = specifier.slice(best.prefix.length, specifier.length - best.suffix.length);
  return best.substitutions.map((s) => s.replace("*", star));
}

/**
 * Row 018-73 (review 0.1.587 B1): the specifier tsx resolves, its `?query`
 * cut off before alias matching (`getSpecifierMetadataIndex`). An `import`
 * of a path or URL loses its `?query` and `#hash`; a bare `import` (`#hash`
 * is part of `#imports` and package names) and any `require`
 * (`preserveQuery`) only the `?query`. A `data:` URL stays whole.
 */
export function tsxSpecifier(specifier: string, kind: "import" | "require"): string {
  if (/^data:/i.test(specifier)) return specifier;
  const query = specifier.indexOf("?");
  const fragment = specifier.indexOf("#");
  const path = isAbsolute(specifier) || isRelative(specifier) || URL_LIKE.test(specifier);
  const cut =
    kind === "import" && path && fragment !== -1 && (query === -1 || fragment < query)
      ? fragment
      : query;
  return cut === -1 ? specifier : specifier.slice(0, cut);
}

/** tsx 4's `isRelativePath`: `./`, `../`, or any `..` start. */
const isRelative = (s: string) => s[0] === "." && (s[1] === "/" || s[1] === "." || s[2] === "/");

function locate(specifier: string, dir: string, read: ReadText): AbsolutePath | null {
  const exists = (path: string) => read(path) !== null;
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    const path = resolve(dir, specifier);
    return [path, `${path}.json`].find(exists) ?? null;
  }
  for (let at = dir; ; at = dirname(at)) {
    const base = join(at, "node_modules", specifier);
    const found = [base, `${base}.json`, join(base, "tsconfig.json")].find(exists);
    if (found !== undefined) return found;
    if (dirname(at) === at) return null;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** JSON with comments and trailing commas, as tsconfig files are written. */
export function parseJsonc(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i === -1) break;
      i++;
    } else {
      out += c;
    }
  }
  try {
    const parsed: unknown = JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
