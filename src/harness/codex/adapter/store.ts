import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createExclusive,
  currentFile,
  isNewer,
  type PinRecord,
  pinFile,
  pinnedVersions,
  readCurrent,
  readPin,
  runtimeRoot,
  SCHEMA,
} from "./layout.js";
import { checkRoot, PLUGIN_MANIFEST, RuntimeError } from "./manifest.js";
import {
  errorText,
  publishRuntime,
  type RuntimeRef,
  selectCurrent,
  unwritable,
} from "./publish.js";

export { type PublishOptions, publishRuntime, type RuntimeRef } from "./publish.js";

/*
 * Spec 002 D8 and D9, `tasks/wave-4-contract.md` "Ownership and exported
 * operations": the runtime store in Codex's `PLUGIN_DATA`. Publication
 * (`publish.ts`) retains whole, validated trees; selection pins a session to
 * one version at its first contact and never switches it. The updater, its
 * lock and backoff belong to later wiring, which calls `publishRuntime`.
 */

/** The seed runtime inside the fixed plugin. */
export const SEED = "seed";

export interface SelectOptions {
  /** The fixed plugin's root, which holds the seed at `seed/`. */
  readonly pluginRoot: string;
  readonly data: string;
  /** The hook input's `session_id`; `null` selects for one hook without a pin. */
  readonly sessionId: string | null;
  /** Whether a first contact pins (default); an existing pin decides either way. */
  readonly pin?: boolean;
  readonly node?: string;
}

export interface SelectedRuntime extends RuntimeRef {
  /** Where the version came from: this session's pin, `current.json`, or the seed. */
  readonly source: "pin" | "current" | "seed";
}

/**
 * The runtime of one hook (spec 002 D9). A session's pin decides once it
 * exists, and a pinned root that is missing or incomplete is a
 * `missing-pinned-runtime`, never another version. A first contact selects
 * the current runtime, or the seed when no current one is usable or the seed
 * is newer (publishing the seed when it is not yet retained), then pins it;
 * of two first hooks of one session the first pin wins and both use it.
 */
export function selectRuntime(options: SelectOptions): SelectedRuntime {
  const node = options.node ?? process.versions.node;
  const { data, sessionId } = options;
  if (sessionId === null) return chooseNew(options.pluginRoot, data, node);
  const path = pinFile(data, sessionId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const pin = readPin(path);
    if (pin !== null) return usePin(data, sessionId, path, pin, node);
    const chosen = chooseNew(options.pluginRoot, data, node);
    if (options.pin === false) return chosen;
    const record: PinRecord = { schema: SCHEMA, sessionId, version: chosen.version };
    let created: boolean;
    try {
      created = createExclusive(path, `${JSON.stringify(record)}\n`);
    } catch (error) {
      throw unwritable(data, error);
    }
    if (created) return chosen;
    // Another first hook of this session pinned first: read its pin.
  }
  throw new RuntimeError(
    "invalid-pin",
    `${path} kept changing while this hook read it. Start a new Codex session.`,
  );
}

function usePin(
  data: string,
  sessionId: string,
  path: string,
  pin: PinRecord | "invalid",
  node: string,
): SelectedRuntime {
  if (pin === "invalid" || pin.sessionId !== sessionId) {
    throw new RuntimeError(
      "invalid-pin",
      `This Codex session's runtime record ${path} is unreadable. Squeal does not guess the runtime of a running session. Start a new Codex session.`,
    );
  }
  const root = runtimeRoot(data, pin.version);
  try {
    checkRoot(root, pin.version, node);
  } catch (error) {
    if (error instanceof RuntimeError && error.kind === "unsupported-node") throw error;
    throw new RuntimeError(
      "missing-pinned-runtime",
      `Squeal runtime ${pin.version}, which this Codex session started with, is missing or incomplete (${errorText(error)}). Squeal does not switch a running session to another runtime. Start a new Codex session to use the installed runtime.`,
    );
  }
  return { root, version: pin.version, source: "pin" };
}

/** The runtime a new session selects: `current.json`'s, or the seed. */
function chooseNew(pluginRoot: string, data: string, node: string): SelectedRuntime {
  const current = readCurrent(data);
  const now = usable(data, current, node);
  const seedRoot = join(pluginRoot, SEED);
  let seed: string;
  try {
    seed = checkRoot(seedRoot, null, node).version;
  } catch (error) {
    if ("root" in now) return { ...now, source: "current" };
    throw new RuntimeError(
      "no-runtime",
      `No usable Squeal runtime. Installed: ${now.problem}. The plugin's seed: ${errorText(error)}. Reinstall the Squeal plugin (codex plugin add squeal@hearsay) or run Squeal's install.sh.`,
    );
  }
  if ("root" in now && !isNewer(seed, now.version)) return { ...now, source: "current" };
  const select = current === null || current === "invalid" || isNewer(seed, current.version);
  const retained = runtimeRoot(data, seed);
  try {
    checkRoot(retained, seed, node);
  } catch {
    return { ...publishRuntime({ sourceRoot: seedRoot, data, select, node }), source: "seed" };
  }
  if (select) selectCurrent(data, seed);
  return { root: retained, version: seed, source: "seed" };
}

/** `current.json`'s runtime when its root is usable, else what is wrong. */
function usable(
  data: string,
  current: ReturnType<typeof readCurrent>,
  node: string,
): RuntimeRef | { problem: string } {
  if (current === null) return { problem: "none" };
  if (current === "invalid") return { problem: `${currentFile(data)} is unreadable` };
  const root = runtimeRoot(data, current.version);
  try {
    checkRoot(root, current.version, node);
    return { root, version: current.version };
  } catch (error) {
    return { problem: errorText(error) };
  }
}

/** SessionEnd, after dispatch: the session's pin goes, and its runtime may be pruned. */
export function releaseSession(data: string, sessionId: string): void {
  rmSync(pinFile(data, sessionId), { force: true });
}

export interface RuntimeState {
  readonly version: string | null;
  readonly ready: boolean;
  readonly problem: string | null;
}

/** Read-only readiness of the adapter's runtimes, for setup and status (spec 002 D7, D8). */
export interface RuntimeReadiness {
  readonly schema: 1;
  readonly adapter: { readonly root: string; readonly version: string | null };
  /** `current.json`'s runtime; version `null` when none was ever selected. */
  readonly current: RuntimeState;
  readonly seed: RuntimeState;
  /** Each pinned version and whether its root is still complete. */
  readonly pinned: readonly { readonly version: string; readonly ready: boolean }[];
  /** A new session can select a runtime: the current one or the seed. */
  readonly ready: boolean;
}

export function runtimeReadiness(options: {
  readonly pluginRoot: string;
  readonly data: string;
  readonly node?: string;
}): RuntimeReadiness {
  const { pluginRoot, data } = options;
  const node = options.node ?? process.versions.node;
  const state = (root: string, expected: string | null): RuntimeState => {
    try {
      return { version: checkRoot(root, expected, node).version, ready: true, problem: null };
    } catch (error) {
      return { version: expected, ready: false, problem: errorText(error) };
    }
  };
  const record = readCurrent(data);
  const current =
    record === null
      ? { version: null, ready: false, problem: "no runtime is selected" }
      : record === "invalid"
        ? { version: null, ready: false, problem: `${currentFile(data)} is unreadable` }
        : state(runtimeRoot(data, record.version), record.version);
  const seed = state(join(pluginRoot, SEED), null);
  const pinned = pinnedVersions(data).map((version) => ({
    version,
    ready: state(runtimeRoot(data, version), version).ready,
  }));
  return {
    schema: SCHEMA,
    adapter: { root: pluginRoot, version: adapterVersion(pluginRoot) },
    current,
    seed,
    pinned,
    ready: current.ready || seed.ready,
  };
}

function adapterVersion(pluginRoot: string): string | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(pluginRoot, PLUGIN_MANIFEST), "utf8"));
    return typeof value === "object" && value !== null && "version" in value
      ? typeof value.version === "string"
        ? value.version
        : null
      : null;
  } catch {
    return null;
  }
}
