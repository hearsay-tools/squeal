import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath, RelativePath } from "../../../types/common.js";
import type { LintHeld, LintOff } from "../../pass/provider.js";
import { type CacheEntry, cacheKey, memoryBacking, OxlintCache, type Printed } from "./cache.js";
import {
  chainOf,
  configAbove,
  configFacts,
  configIn,
  type FolderConfigs,
  findConfigs,
  ROOT_INPUTS,
} from "./configs.js";
import { blobsNow, type RunContext, runOxlint } from "./run.js";

/*
 * Spec 017 D11: what one refresh reads of a root's oxlint configs. The root
 * config's `options.typeAware` and plugins come from `--print-config`, which
 * loads a TS config as oxlint does; its reads join the closure. Spec 026
 * D3: a read of the same bytes takes the printed config from the cache.
 */

export const TYPE_AWARE_OFF = "oxlint with type-aware rules is not supported yet";

/**
 * Review 0.1.391 N3: with `VP_VERSION` set, oxlint's native side reads only
 * `vite.config.*`, which this provider neither finds nor observes.
 */
export const VITE_PLUS_OFF = "oxlint in Vite+ mode is not supported yet";

export interface ConfigSet {
  /** Every config, nested ones included, and the root's `.eslintignore` and suppressions file. */
  readonly configFiles: readonly RelativePath[];
  /** Files the configs extend or load, and local JS plugin entries: keyed by their blobs. */
  readonly closure: readonly RelativePath[];
  /** The import plugin is on in a config: every file takes D5's program segment. */
  readonly importPlugin: boolean;
  /** User code runs in oxlint's process: runs take the preload (D11). */
  readonly javascript: boolean;
  /** A config above the root that oxlint would use; files read `unknown` while it does. */
  readonly above: RelativePath | null;
  /** What `--print-config` loaded through the preload. */
  readonly held: ReadonlyMap<RelativePath, LintHeld>;
  /** What the cache keeps of this read (spec 026 D3); `null` when it must not be kept. */
  readonly entry: CacheEntry | null;
  /**
   * One file's `LintFileInputs.config`: its config chain, as JSON. One batch
   * passes one `folders` memo, so each folder is read once (issue #274 F3.3).
   */
  inputsOf(path: RelativePath, folders?: FolderConfigs): string;
  /**
   * Whether the file's nearest config is one this read did not find: one made
   * since, or one in a folder git ignored whole then, where a file was added
   * since (row 017-30).
   */
  missed(path: RelativePath): boolean;
}

/** A failure the caller counts; it answers off once it is the third. */
export type Failed = (reason: string) => LintOff | null;

export async function readConfigs(
  ctx: RunContext,
  failed: Failed,
  cache: OxlintCache = new OxlintCache(memoryBacking()),
): Promise<ConfigSet | { readonly off: LintOff | null; readonly reason: string }> {
  const { root } = ctx;
  const configs = await findConfigs(root, ctx.guardMs);
  const rootConfig = configIn(root, "");
  const above = rootConfig === null ? configAbove(root) : null;
  const facts = jsonFacts(root, configs);
  const { closure } = facts;
  const present = ROOT_INPUTS.filter((name) => existsSync(join(root, name))) as RelativePath[];
  const keyed = [...configs, ...present, ...closure, ...(above === null ? [] : [above])];
  const { key, kept, hit } = await lookUp(ctx, cache, keyed);
  const { importPlugin, javascript } = facts;
  const read =
    rootConfig === null
      ? { entry: hit ?? { key, config: null, linted: {} }, printed: null, held: new Map() }
      : await printConfig(ctx, failed, key, hit);
  if ("off" in read) return read;
  if (read.printed?.typeAware === true) return { off: null, reason: TYPE_AWARE_OFF };
  for (const path of read.held.keys()) {
    if (!configs.includes(path) && existsSync(join(root, path))) closure.add(path);
  }
  if (read.entry !== null && read.entry !== kept) await cache.write(root, read.entry);
  return {
    configFiles: [...configs, ...present].sort(),
    closure: [...closure].sort(),
    importPlugin: importPlugin || read.printed?.importPlugin === true,
    javascript: javascript || read.printed?.javascript === true,
    above,
    held: read.held,
    entry: read.entry,
    inputsOf: (path, folders) => JSON.stringify({ chain: chainOf(root, path, folders) }),
    // Never memoized: it reads the disk for a config made since (row 017-30).
    missed: (path) => {
      const nearest = chainOf(root, path).at(-1)?.[1] ?? null;
      return nearest !== null && !configs.includes(nearest);
    },
  };
}

/** What the JSON configs say: files they extend or load beyond the configs, and their plugins. */
function jsonFacts(root: AbsolutePath, configs: readonly RelativePath[]) {
  const closure = new Set<RelativePath>();
  let importPlugin = false;
  let javascript = false;
  for (const config of configs) {
    const facts = configFacts(root, config);
    importPlugin ||= facts.importPlugin;
    javascript ||= facts.javascript;
    for (const file of [...facts.files, ...facts.jsPlugins]) {
      if (!configs.includes(file)) closure.add(file);
    }
  }
  return { closure, importPlugin, javascript };
}

interface Print {
  readonly printed: Printed | null;
  readonly held: ReadonlyMap<RelativePath, LintHeld>;
  /** What the cache keeps of this read; `null` when it must not be kept. */
  readonly entry: CacheEntry | null;
}

/**
 * The root config as printed: the cache's `hit`, or one `--print-config`
 * run, kept under `key` when it printed JSON and read only what the preload
 * hashed (spec 026 D3).
 */
async function printConfig(
  ctx: RunContext,
  failed: Failed,
  key: string,
  hit: CacheEntry | null,
): Promise<Print | { readonly off: LintOff; readonly reason: string }> {
  if (hit?.config != null) {
    return { printed: hit.config.printed, held: new Map(hit.config.held), entry: hit };
  }
  const run = await runOxlint({ ...ctx, observe: true }, ["--print-config", "--threads", "1"]);
  if (run.failure !== null) {
    const off = failed(run.failure);
    if (off !== null) return { off, reason: off.off };
  }
  const printed = printedConfig(run.process.stdout);
  const keep = printed !== null && run.unknown === null && !unobserved(run.held);
  const entry = keep ? { key, config: { printed, held: [...run.held] }, linted: {} } : null;
  return { printed, held: run.held, entry };
}

/** The read's key, the cache's entry for the root, and that entry when it holds for this read. */
async function lookUp(ctx: RunContext, cache: OxlintCache, keyed: readonly RelativePath[]) {
  const key = cacheKey(ctx.install, ctx.format, blobsNow(ctx.root, keyed, ctx.format));
  const kept = await cache.read(ctx.root);
  const hit = kept?.key === key && heldNow(ctx, kept.config) ? kept : null;
  return { key, kept, hit };
}

/** Whether every file printing the config read holds one of the bytes it read then (D3). */
function heldNow(ctx: RunContext, config: CacheEntry["config"]): boolean {
  if (config === null) return true;
  const now = blobsNow(
    ctx.root,
    config.held.map(([path]) => path),
    ctx.format,
  );
  return config.held.every(([path, use]) => {
    const blob = now.get(path);
    return use.unobserved !== true && blob != null && use.others.includes(blob);
  });
}

function unobserved(held: ReadonlyMap<RelativePath, LintHeld>): boolean {
  return [...held.values()].some((use) => use.unobserved === true);
}

/** The root config as `--print-config` resolved it; `null` when it printed no JSON. */
function printedConfig(stdout: string): Printed | null {
  try {
    const config = JSON.parse(stdout) as {
      options?: { typeAware?: unknown };
      plugins?: unknown;
      jsPlugins?: unknown;
    };
    const plugins = Array.isArray(config.plugins) ? config.plugins : [];
    return {
      typeAware: config.options?.typeAware === true,
      importPlugin: plugins.includes("import"),
      javascript: Array.isArray(config.jsPlugins) && config.jsPlugins.length > 0,
    };
  } catch {
    return null;
  }
}
