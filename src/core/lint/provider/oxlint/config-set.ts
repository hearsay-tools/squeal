import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RelativePath } from "../../../types/common.js";
import type { LintHeld, LintOff } from "../../pass/provider.js";
import {
  chainOf,
  configAbove,
  configFacts,
  configIn,
  findConfigs,
  ROOT_INPUTS,
} from "./configs.js";
import { type RunContext, runOxlint } from "./run.js";

/*
 * Spec 017 D11: what one refresh reads of a root's oxlint configs. The root
 * config's `options.typeAware` and plugins come from `--print-config`, which
 * loads a TS config as oxlint does; its reads join the closure.
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
  /** One file's `LintFileInputs.config`: its config chain, as JSON. */
  inputsOf(path: RelativePath): string;
}

/** A failure the caller counts; it answers off once it is the third. */
export type Failed = (reason: string) => LintOff | null;

export async function readConfigs(
  ctx: RunContext,
  failed: Failed,
): Promise<ConfigSet | { readonly off: LintOff | null; readonly reason: string }> {
  const { root } = ctx;
  const configs = findConfigs(root);
  const rootConfig = configIn(root, "");
  const above = rootConfig === null ? configAbove(root) : null;
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
  let held: ReadonlyMap<RelativePath, LintHeld> = new Map();
  if (rootConfig !== null) {
    const run = await runOxlint({ ...ctx, observe: true }, ["--print-config", "--threads", "1"]);
    if (run.failure !== null) {
      const off = failed(run.failure);
      if (off !== null) return { off, reason: off.off };
    }
    const printed = printedConfig(run.process.stdout);
    if (printed?.typeAware === true) return { off: null, reason: TYPE_AWARE_OFF };
    importPlugin ||= printed?.importPlugin === true;
    javascript ||= printed?.javascript === true;
    held = run.held;
    for (const path of held.keys()) {
      if (!configs.includes(path) && existsSync(join(root, path))) closure.add(path);
    }
  }
  const present = ROOT_INPUTS.filter((name) => existsSync(join(root, name))) as RelativePath[];
  return {
    configFiles: [...configs, ...present].sort(),
    closure: [...closure].sort(),
    importPlugin,
    javascript,
    above,
    held,
    inputsOf: (path) => JSON.stringify({ chain: chainOf(root, path) }),
  };
}

/** The root config as `--print-config` resolved it; `null` when it printed no JSON. */
function printedConfig(
  stdout: string,
): { typeAware: boolean; importPlugin: boolean; javascript: boolean } | null {
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
