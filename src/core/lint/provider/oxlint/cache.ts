import { createHash } from "node:crypto";
import { runGit } from "../../../fs/git.js";
import type { ObjectFormat } from "../../../hash/blob.js";
import type { AbsolutePath, RelativePath } from "../../../types/common.js";
import type { Policy } from "../../../types/policy.js";
import type { LintHeld } from "../../pass/provider.js";
import { isLintStoreOpenFailure, openLintStore } from "../../store/open.js";

/*
 * Spec 026 D3: what one config read learned, kept so the next read of the
 * same bytes spawns no oxlint. The key is oxlint's version and the blobs of
 * every config file, root input and file a JSON config extends or loads;
 * what `--print-config` read through the preload is checked at its blobs on
 * each hit. Under the key: the printed facts, and whether oxlint lints each
 * path asked so far (`--debug files`). In memory and in a backing that a
 * short-lived daemon finds again (D2): `lint.sqlite`'s `meta` table, one
 * row per worktree root, so the lint store's schema does not move.
 */

/** Raise it when what an entry holds changes meaning: older entries stop matching. */
export const CACHE_VERSION = 1;

/** What `--print-config` said of the root config. */
export interface Printed {
  readonly typeAware: boolean;
  readonly importPlugin: boolean;
  readonly javascript: boolean;
}

export interface CacheEntry {
  readonly key: string;
  /** The root config as printed and what printing it read; `null` with no root config. */
  readonly config: {
    readonly printed: Printed;
    readonly held: readonly (readonly [RelativePath, LintHeld])[];
  } | null;
  /** Whether oxlint lints each path asked so far: `--debug files` answers. */
  readonly linted: Record<string, boolean>;
}

/** Text by key: `lint.sqlite`'s `meta`, or a map in tests. */
export interface CacheBacking {
  get(key: string): string | null;
  set(key: string, value: string): void;
  close?(): void;
}

/** The entry's backing key for one worktree root, in `lint.sqlite`, not the main store's registry. */
const entryKey = (root: AbsolutePath) => `oxlint.cache:${root}`;

/** Entries by root, shared by every provider in this process. */
const MEMORY = new Map<string, CacheEntry>();

export class OxlintCache {
  #backing: Promise<CacheBacking | null> | null = null;

  /**
   * `backing`: one, or how to find one for a root. `memory`: entries by
   * root, before the backing; the default cache shares one per process.
   */
  constructor(
    private readonly backing: CacheBacking | ((root: AbsolutePath) => Promise<CacheBacking | null>),
    private readonly memory = new Map<string, CacheEntry>(),
  ) {}

  async read(root: AbsolutePath): Promise<CacheEntry | null> {
    const kept = this.memory.get(root);
    if (kept !== undefined) return kept;
    const backing = await this.#open(root);
    const text = attempt(() => backing?.get(entryKey(root)) ?? null);
    const entry = text == null ? null : parse(text);
    if (entry !== null) this.memory.set(root, entry);
    return entry;
  }

  async write(root: AbsolutePath, entry: CacheEntry): Promise<void> {
    this.memory.set(root, entry);
    const backing = await this.#open(root);
    attempt(() => backing?.set(entryKey(root), JSON.stringify(entry)));
  }

  /** Closes a backing this cache found; a given one stays open. */
  async close(): Promise<void> {
    const backing = await this.#backing;
    this.#backing = null;
    if (typeof this.backing === "function") attempt(() => backing?.close?.());
  }

  #open(root: AbsolutePath): Promise<CacheBacking | null> {
    this.#backing ??=
      typeof this.backing === "function"
        ? this.backing(root).catch(() => null)
        : Promise.resolve(this.backing);
    return this.#backing;
  }
}

/** One config read's answers to whether oxlint lints a path (`--debug files`), kept as they grow. */
export class LintedMemo {
  constructor(
    private readonly cache: OxlintCache,
    private readonly root: AbsolutePath,
    private entry: CacheEntry,
  ) {}

  /** The kept answers for those of `paths` asked before. */
  known(paths: readonly RelativePath[]): Map<RelativePath, boolean> {
    const { linted } = this.entry;
    return new Map(
      paths.filter((p) => Object.hasOwn(linted, p)).map((p) => [p, linted[p] === true]),
    );
  }

  /** Keeps whether oxlint lints each of `paths`: it lints those in `linted`. */
  async remember(paths: readonly RelativePath[], linted: ReadonlySet<RelativePath>): Promise<void> {
    const kept = this.entry.linted;
    if (paths.every((p) => kept[p] === linted.has(p))) return;
    const answers = Object.fromEntries(paths.map((p) => [p, linted.has(p)]));
    this.entry = { ...this.entry, linted: { ...kept, ...answers } };
    await this.cache.write(this.root, this.entry);
  }
}

/** The provider's default: the root's `lint.sqlite`, behind this process's memory. */
export function defaultCache(): OxlintCache {
  return new OxlintCache(storeBacking, MEMORY);
}

/** The key of one config read: oxlint's version and binary, the object format and each file's blob. */
export function cacheKey(
  tool: { readonly version: string; readonly bin: string },
  format: ObjectFormat,
  blobs: ReadonlyMap<RelativePath, string | null>,
): string {
  const files = [...blobs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const text = JSON.stringify([CACHE_VERSION, tool.version, tool.bin, format, files]);
  return createHash("sha256").update(text).digest("hex");
}

/** A backing over a map: tests, and a provider with no store. */
export function memoryBacking(): CacheBacking & { size(): number } {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      if (value === "null") map.delete(key);
      else map.set(key, value);
    },
    size: () => map.size,
  };
}

/**
 * The `meta` table of the worktree's `lint.sqlite` (spec 017 D6), only when
 * the daemon made it: lint is on, or no provider runs. `null` outside git.
 */
export async function storeBacking(root: AbsolutePath): Promise<CacheBacking | null> {
  const out = await runGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    timeoutMs: 5_000,
  });
  const commonDir = out.trim() as AbsolutePath;
  const lintOn = { lint: { enabled: true } } as Pick<Policy, "lint">;
  const store = openLintStore(commonDir, lintOn, { create: false });
  if (isLintStoreOpenFailure(store)) return null;
  return {
    get: (key) => store.meta.get(key),
    set: (key, value) => store.meta.set(key, value),
    close: () => store.close(),
  };
}

/** `use()`, or `undefined` when the store throws (busy, closed): the cache is never a failure. */
function attempt<T>(use: () => T): T | undefined {
  try {
    return use();
  } catch {
    return undefined;
  }
}

function parse(text: string): CacheEntry | null {
  try {
    const value = JSON.parse(text) as CacheEntry | null;
    return value !== null && typeof value.key === "string" && typeof value.linted === "object"
      ? value
      : null;
  } catch {
    return null;
  }
}
