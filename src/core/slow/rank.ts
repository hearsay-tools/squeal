import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { FileHash, RelativePath } from "../types/index.js";
import { localSpecifiers, matches, matchSide, offeredTokens } from "./rank-tokens.js";

/**
 * Spec 004 D2 as amended 2026-10-18 (task 004-72's design, row 004-82): the
 * evidence that orders slow files within their class. Tokens come from each
 * file a revision changed and its local imports; each is matched whole
 * against every slow file and its own `./` helpers. A token that more than
 * `COMMON_TOKEN_FILES` slow files match, or none, is dropped.
 */
export const COMMON_TOKEN_FILES = 20;

/**
 * A revision that changed more paths than this is a checkout or an install,
 * not an edit: it offers no evidence, and the order is the duration order.
 */
export const MAX_CHANGED_PATHS = 100;

/** A changed file or import larger than this is not read for tokens (a lockfile, a bundle). */
export const MAX_READ_BYTES = 1024 * 1024;

const EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".jsx",
  ".mjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

/** A slow file's or helper's side of the match, kept per path and keyed by its hash. */
export interface TokenRecord {
  readonly hash: FileHash;
  readonly words: readonly string[];
  readonly phrases: readonly string[];
  /** Its `./` imports, resolved to worktree-relative paths. */
  readonly helpers: readonly RelativePath[];
}

/** The worktree as the ranker reads it. */
export interface RankSource {
  /** The file's text, or `null` when it is absent, not a file or above `MAX_READ_BYTES`. */
  read(path: RelativePath): string | null;
  exists(path: RelativePath): boolean;
  /** The file's hash when one is already known (the key stat cache); `undefined` reads the file. */
  hashOf(path: RelativePath): FileHash | null | undefined;
}

/** Where token records outlive the daemon (the store's `meta`); absent, memory only. */
export interface TokenRecords {
  get(path: RelativePath): TokenRecord | null;
  set(path: RelativePath, record: TokenRecord): void;
}

export function fsRankSource(
  root: string,
  hashOf: RankSource["hashOf"] = () => undefined,
): RankSource {
  return {
    read(path) {
      try {
        const full = join(root, path);
        const stats = statSync(full);
        if (!stats.isFile() || stats.size > MAX_READ_BYTES) return null;
        return readFileSync(full, "utf8");
      } catch {
        return null;
      }
    },
    exists(path) {
      try {
        return statSync(join(root, path)).isFile();
      } catch {
        return false;
      }
    },
    hashOf,
  };
}

/** Matched tokens per slow file path; a file with no evidence is absent. */
export type Evidence = ReadonlyMap<RelativePath, readonly string[]>;

export class SlowRanker {
  readonly #memo = new Map<RelativePath, TokenRecord>();
  /** Each slow file's words and phrases with its helpers', by the hashes they were built from. */
  readonly #sides = new Map<
    RelativePath,
    { hashes: string; words: Set<string>; phrases: string[] }
  >();

  constructor(
    private readonly source: RankSource,
    private readonly records: TokenRecords | null = null,
  ) {}

  /** The kept tokens each of `slow` matches, from the files of `changed` and their local imports. */
  evidence(changed: Iterable<RelativePath>, slow: readonly RelativePath[]): Evidence {
    const paths = [...changed];
    if (paths.length === 0 || paths.length > MAX_CHANGED_PATHS || slow.length === 0)
      return new Map();
    const offered = this.#offered(paths);
    if (offered.size === 0) return new Map();
    const sides = slow.map((path) => [path, this.#side(path)] as const);
    const out = new Map<RelativePath, string[]>();
    for (const token of offered) {
      const hits = sides.filter(([, side]) => matches(token, side.words, side.phrases));
      if (hits.length === 0 || hits.length > COMMON_TOKEN_FILES) continue;
      for (const [path] of hits) out.set(path, [...(out.get(path) ?? []), token]);
    }
    return out;
  }

  /**
   * Tokens the changed files and their `./` and `../` imports offer, each
   * read once. A changed file read first as another's import still has its
   * own imports inspected (review wave-13 S1), whatever the order.
   */
  #offered(paths: readonly RelativePath[]): Set<string> {
    const tokens = new Set<string>();
    const texts = new Map<RelativePath, string | null>();
    const take = (path: RelativePath): string | null => {
      if (texts.has(path)) return texts.get(path) ?? null;
      const text = this.source.read(path);
      texts.set(path, text);
      if (text !== null) for (const token of offeredTokens(text)) tokens.add(token);
      return text;
    };
    for (const path of new Set(paths)) {
      const text = take(path);
      if (text === null) continue;
      for (const imported of this.#resolve(path, localSpecifiers(text, true))) take(imported);
    }
    return tokens;
  }

  #side(path: RelativePath): { words: Set<string>; phrases: string[] } {
    const own = this.record(path);
    if (own === null) return { words: new Set(), phrases: [] };
    const helpers = own.helpers.map((h) => this.record(h)).filter((r) => r !== null);
    const hashes = [own, ...helpers].map((r) => r.hash).join("\0");
    const cached = this.#sides.get(path);
    if (cached?.hashes === hashes) return cached;
    const side = {
      hashes,
      words: new Set([own, ...helpers].flatMap((r) => r.words)),
      phrases: [own, ...helpers].flatMap((r) => r.phrases),
    };
    this.#sides.set(path, side);
    return side;
  }

  /**
   * `path`'s token record at its current hash: from memory, the store, or
   * built from its text, which is read only when neither holds that hash.
   */
  record(path: RelativePath): TokenRecord | null {
    let hash = this.source.hashOf(path);
    let text: string | null = null;
    if (hash === null) return null;
    if (hash === undefined) {
      text = this.source.read(path);
      if (text === null) return null;
      hash = createHash("sha1").update(text).digest("hex");
    }
    const memo = this.#memo.get(path);
    if (memo?.hash === hash) return memo;
    const stored = this.records?.get(path) ?? null;
    if (stored?.hash === hash) {
      this.#memo.set(path, stored);
      return stored;
    }
    text ??= this.source.read(path);
    if (text === null) return null;
    const record: TokenRecord = {
      hash,
      ...matchSide(text),
      helpers: this.#resolve(path, localSpecifiers(text, false)),
    };
    this.#memo.set(path, record);
    this.records?.set(path, record);
    return record;
  }

  #resolve(from: RelativePath, specifiers: readonly string[]): RelativePath[] {
    const out: RelativePath[] = [];
    for (const specifier of specifiers) {
      const base = normalize(join(dirname(from), specifier));
      if (base.startsWith("..")) continue;
      const candidates = [...EXTENSIONS.map((e) => base + e), ...typescriptOf(base)];
      const found = candidates.find((p) => this.source.exists(p));
      if (found !== undefined && !out.includes(found)) out.push(found);
    }
    return out;
  }
}

/** A `./x.js` specifier names `x.ts` in TypeScript's ESM convention. */
function typescriptOf(base: string): string[] {
  const m = /^(.*)\.(m?)js$/.exec(base);
  return m === null ? [] : [`${m[1]}.${m[2]}ts`, `${m[1]}.tsx`];
}
