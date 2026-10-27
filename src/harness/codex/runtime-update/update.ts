import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pruneVersions } from "../../shared/version-copies.js";
import { isNewer, runtimeRoot } from "../adapter/layout.js";
import { checkRoot, RuntimeError } from "../adapter/manifest.js";
import { publishRuntime, runtimeReadiness } from "../adapter/store.js";
import {
  DEFAULT_RELEASE_TIMEOUT_MS,
  prepareRuntimeUpdate,
  type ReleaseTransport,
  RuntimeReleaseError,
  resolveRuntimeRelease,
} from "../runtime-release/index.js";
import { acquireLock } from "./lock.js";
import { STAGED_PREFIX, stagingDir } from "./paths.js";
import { isDue, readUpdateState, recordCheck, type UpdateFailure } from "./state.js";

/*
 * Row 002-34 (spec 002 D8, `wave-5-contract.md`): one runtime update. Under
 * the updater lock: remove abandoned staging, resolve the release once, stop
 * when it is not newer than the runtime a new session selects (never a
 * downgrade), else stage it (row 002-30), publish and select it (row
 * 002-29), prune, and clean up. Pins never change: a running session keeps
 * its runtime, and new sessions take the published one. A failure keeps the
 * selection and is recorded in the update state only. The whole operation,
 * lock wait included, is bounded by `timeoutMs`.
 */

export interface RuntimeUpdateOptions {
  /** The fixed plugin's root, which holds the seed. */
  readonly pluginRoot: string;
  /** Codex's `PLUGIN_DATA` for the plugin. */
  readonly data: string;
  /** An exact release tag, `squeal--v<version>`; the latest release without it. */
  readonly tag?: string;
  /** An explicit update: it runs whatever the retry delay says. */
  readonly explicit?: boolean;
  /** Tests inject one; the default reaches only the official release. */
  readonly transport?: ReleaseTransport;
  /** The bound on the whole operation; 120 s by default. */
  readonly timeoutMs?: number;
  /** How long to wait for another updater's lock; 0 (busy at once) by default. */
  readonly lockWaitMs?: number;
  readonly signal?: AbortSignal;
  /** The clock of the update state. */
  readonly now?: () => number;
  /** The Node version hooks run; this process's by default. */
  readonly node?: string;
}

/** `version` is always the runtime a new session selects afterwards. */
export type RuntimeUpdateResult =
  | {
      readonly outcome: "updated";
      readonly version: string;
      readonly previous: string | null;
      readonly release: string;
    }
  | { readonly outcome: "current"; readonly version: string | null; readonly release: string }
  | { readonly outcome: "not-due"; readonly version: string | null; readonly nextCheckAt: string }
  | { readonly outcome: "busy"; readonly version: string | null; readonly owner: number }
  | {
      readonly outcome: "failed";
      readonly version: string | null;
      readonly release: string | null;
      readonly failure: UpdateFailure;
      readonly nextCheckAt: string;
    };

export async function updateRuntime(options: RuntimeUpdateOptions): Promise<RuntimeUpdateResult> {
  const { pluginRoot, data } = options;
  const now = options.now ?? Date.now;
  const node = options.node ?? process.versions.node;
  const timeoutMs = options.timeoutMs ?? DEFAULT_RELEASE_TIMEOUT_MS;
  const end = performance.now() + timeoutMs;
  const selected = () => selectedRuntime(pluginRoot, data, node);
  const notDue = () => {
    const state = readUpdateState(data);
    return !options.explicit && state !== null && !isDue(state, now())
      ? ({ outcome: "not-due", version: selected(), nextCheckAt: state.nextCheckAt } as const)
      : null;
  };
  const early = notDue();
  if (early !== null) return early;
  const attempt = await acquireLock(data, {
    waitMs: Math.min(options.lockWaitMs ?? 0, timeoutMs),
    now,
  });
  if ("busy" in attempt) return { outcome: "busy", version: selected(), owner: attempt.busy.pid };
  try {
    // Another updater may have checked while this one waited.
    const late = notDue();
    if (late !== null) return late;
    removeStaging(data);
    const before = selected();
    const seen: { release: string | null } = { release: null };
    const left = () => {
      const ms = Math.floor(end - performance.now());
      if (ms <= 0) throw new RuntimeReleaseError("timeout", `passed its ${timeoutMs} ms bound`);
      return ms;
    };
    let result: Exclude<RuntimeUpdateResult, { outcome: "failed" | "busy" | "not-due" }>;
    try {
      result = await check({ ...options, node, before, seen, left });
    } catch (error) {
      const failure = failureOf(error);
      const state = recordCheck(
        data,
        { outcome: "failed", release: seen.release, selected: before, failure },
        now(),
      );
      return {
        outcome: "failed",
        version: before,
        release: seen.release,
        failure,
        nextCheckAt: state.nextCheckAt,
      };
    }
    const { outcome, release, version } = result;
    recordCheck(data, { outcome, release, selected: version, failure: null }, now());
    return result;
  } finally {
    attempt.lock.release();
  }
}

interface Check extends RuntimeUpdateOptions {
  readonly node: string;
  readonly before: string | null;
  readonly seen: { release: string | null };
  readonly left: () => number;
}

async function check(o: Check) {
  const { data, node, before, transport, signal } = o;
  const release = await resolveRuntimeRelease({
    timeoutMs: o.left(),
    ...(o.tag === undefined ? {} : { tag: o.tag }),
    ...(transport === undefined ? {} : { transport }),
    ...(signal === undefined ? {} : { signal }),
  });
  o.seen.release = release.tag;
  const { version } = release.descriptor;
  const current = { outcome: "current", release: release.tag } as const;
  if (before !== null && !isNewer(version, before)) return { ...current, version: before };
  if (retained(data, version, node)) {
    publishRuntime({ sourceRoot: runtimeRoot(data, version), data, select: true, node });
  } else {
    const prepared = await prepareRuntimeUpdate({
      release,
      stagingDir: stagingDir(data),
      timeoutMs: o.left(),
      nodeVersion: node,
      ...(transport === undefined ? {} : { transport }),
      ...(signal === undefined ? {} : { signal }),
    });
    try {
      // An adapter release with a newer seed may have landed during the download.
      const now = selectedRuntime(o.pluginRoot, data, node);
      if (now !== null && !isNewer(version, now)) return { ...current, version: now };
      publishRuntime({ sourceRoot: prepared.root, data, select: true, node });
    } finally {
      prepared.cleanup();
    }
  }
  prune(data, version);
  return { outcome: "updated", version, previous: before, release: release.tag } as const;
}

/**
 * The runtime a new session selects now, as the adapter chooses it: the
 * current one, unless the seed is newer or the current one is not usable.
 */
export function selectedRuntime(pluginRoot: string, data: string, node?: string): string | null {
  const readiness = runtimeReadiness({ pluginRoot, data, ...(node === undefined ? {} : { node }) });
  const current = readiness.current.ready ? readiness.current.version : null;
  const seed = readiness.seed.ready ? readiness.seed.version : null;
  if (current !== null && (seed === null || !isNewer(seed, current))) return current;
  return seed ?? current;
}

function retained(data: string, version: string, node: string): boolean {
  try {
    checkRoot(runtimeRoot(data, version), version, node);
    return true;
  } catch {
    return false;
  }
}

/** Old copies go after a publication; a failure here leaves the update done. */
function prune(data: string, version: string): void {
  try {
    pruneVersions(data, version);
  } catch {
    // The next publication or session start prunes again.
  }
}

/** Staging trees a killed updater left: only the lock owner stages, so none is in use. */
function removeStaging(data: string): void {
  let names: string[];
  try {
    names = readdirSync(stagingDir(data));
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(STAGED_PREFIX))
      rmSync(join(stagingDir(data), name), { recursive: true, force: true });
  }
}

/** What the update state records of a failure, with whether retrying later can pass. */
export function failureOf(error: unknown): UpdateFailure {
  if (error instanceof RuntimeReleaseError) {
    return { code: error.code, transient: error.transient, message: error.message };
  }
  if (error instanceof RuntimeError) {
    return {
      code: error.kind,
      transient: error.kind === "unwritable-data",
      message: error.message,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "internal", transient: false, message };
}
