import { normalize, resolve } from "node:path";
import type { AbsolutePath } from "../../../core/types/common.js";
import type { Resolution, Resolver } from "../../js-graph/resolver.js";

/**
 * Jest's `moduleNameMapper`: the raw config's object, or the resolved config's ordered pairs.
 * A pattern is a regular expression; a replacement may use `<rootDir>` and `$1`..`$9`.
 */
export type ModuleNameMapper =
  | readonly (readonly [string, string | readonly string[]])[]
  | Readonly<Record<string, string | readonly string[]>>;

/** A `moduleNameMapper` compiled as Jest compiles it (spec 028 D3.3). */
export interface CompiledMapper {
  /**
   * The specifiers the first pattern `specifier` matches maps it to, in order, or `null` when
   * no pattern matches. Jest takes the first that resolves, and fails the import when none does.
   */
  map(specifier: string): readonly string[] | null;
  /** One note per pattern that is no valid regular expression; Jest fails on it, the graph skips it. */
  readonly notes: readonly string[];
}

/** Jest's `replaceRootDirInPath`: a leading `<rootDir>` becomes `rootDir`; any other value stays. */
export function expandRootDir(value: string, rootDir: AbsolutePath): string {
  if (!value.startsWith("<rootDir>")) return value;
  return resolve(rootDir, normalize(`./${value.slice("<rootDir>".length)}`));
}

export function compileModuleNameMapper(
  mapper: ModuleNameMapper | undefined,
  rootDir: AbsolutePath,
): CompiledMapper {
  const pairs = mapper === undefined ? [] : Array.isArray(mapper) ? mapper : Object.entries(mapper);
  const rules: { readonly pattern: RegExp; readonly targets: readonly string[] }[] = [];
  const notes: string[] = [];
  for (const [source, replacement] of pairs as [string, string | readonly string[]][]) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(source);
    } catch (error) {
      notes.push(
        `jest: moduleNameMapper pattern ${JSON.stringify(source)} is no regular expression (${(error as Error).message}); the static graph skips it`,
      );
      continue;
    }
    const targets = (typeof replacement === "string" ? [replacement] : replacement)
      .filter((target): target is string => typeof target === "string")
      .map((target) => expandRootDir(target, rootDir));
    rules.push({ pattern, targets });
  }
  return {
    map(specifier) {
      for (const { pattern, targets } of rules) {
        const match = specifier.match(pattern);
        if (match === null) continue;
        return targets.map((target) =>
          target.replace(/\$([0-9]+)/g, (_, index: string) => match[Number(index)] ?? ""),
        );
      }
      return null;
    },
    notes,
  };
}

const UNRESOLVED = { path: null, builtin: false, pair: null } as const;

/**
 * `inner`, with Jest's `moduleNameMapper` applied first: a specifier a pattern matches resolves
 * to the first of its mapped specifiers that resolves, from the same importer, or to nothing
 * (Jest's "Could not locate module ... mapped as"), never to itself. `inner` holds Jest's
 * `moduleFileExtensions`, so a mapped target tries them in Jest's order. The reads and absent
 * candidates of every attempt stay in the result, so a mapped target created later re-resolves
 * the importer.
 */
export function mappedResolver(inner: Resolver, mapper: CompiledMapper): Resolver {
  return {
    resolve(specifier, importer, kind) {
      const mapped = mapper.map(specifier);
      if (mapped === null) return inner.resolve(specifier, importer, kind);
      return merge(mapped.map((target) => inner.resolve(target, importer, kind)));
    },
    moduleFormat: (file) => inner.moduleFormat(file),
    release: () => inner.release(),
    clear: () => inner.clear(),
  };
}

/**
 * The first attempt that resolved, carrying the reads of the attempts before it; or none, with
 * every attempt's reads and absent candidates.
 */
function merge(attempts: readonly Resolution[]): Resolution {
  const reads = new Set<AbsolutePath>();
  const candidates = new Set<AbsolutePath>();
  for (const attempt of attempts) {
    for (const read of attempt.reads) reads.add(read);
    if (attempt.path !== null || attempt.builtin) {
      return { ...attempt, reads: [...reads] };
    }
    for (const candidate of attempt.candidates) candidates.add(candidate);
  }
  return { ...UNRESOLVED, reads: [...reads], candidates: [...candidates] };
}
