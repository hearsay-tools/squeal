import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AbsolutePath } from "../../../core/types/index.js";

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
