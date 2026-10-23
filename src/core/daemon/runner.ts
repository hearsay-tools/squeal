import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { isRecord, runGit, splitNul } from "../fs/index.js";
import type {
  AbsolutePath,
  InvalidatedPath,
  InvalidateResult,
  RunnerAdapter,
  TestFileRef,
} from "../types/index.js";

export interface RecoveringRunnerOptions {
  readonly name: string;
  readonly adapterVersion: string;
  /** Builds the real adapter, e.g. `createVitestAdapter`, which rejects on a broken config. */
  readonly create: () => Promise<RunnerAdapter>;
  /** A creation attempt failed with a message not reported before. */
  readonly onFailure: (message: string) => void;
  /** A creation attempt worked after a failure. */
  readonly onRecovered?: () => void;
  /** `RunnerAdapter.tierWidth` when the adapter answers none, as node:test's `runner.tierSize` (task 001-366). */
  readonly tierWidth?: (testFile: TestFileRef, grant: number) => number;
  /** `RunnerAdapter.besideBacklog` of every file, before the adapter exists too (task 011-21). */
  readonly besideBacklog?: boolean;
  /** `RunnerAdapter.backlogSlot` of every file, before the adapter exists too (task 011-21 slice 2). */
  readonly backlogSlot?: number;
  /** `RunnerAdapter.focuses`, before the adapter exists too (spec 011 C14, row 011-145). */
  readonly focuses?: true;
  /** Wraps every call that reaches the adapter, creation included (the working directory, D10). */
  readonly around?: (<T>(call: () => Promise<T>) => Promise<T>) | undefined;
}

/** A runner whose creation may fail and be retried. */
export interface RecoveringRunner extends RunnerAdapter {
  /** First creation attempt. `false` when it failed; the runner is usable either way. */
  open(): Promise<boolean>;
  /** The next call tries to create the adapter again. For `run --all`. */
  retry(): void;
}

/**
 * Wraps a runner factory so a broken config is a state, never an exit.
 *
 * Review wave 2, inputs for 001-30: "`createVitestAdapter({ root })`. It
 * rejects on a broken config. Do not exit and do not leave the previous known
 * states `current`: until the adapter starts, mark the worktree's checks
 * `unknown` with the error as reason and retry on the next batch that touches
 * the config."
 *
 * Until the adapter exists every call rejects with the creation error, so the
 * scheduler treats each as a failed runner call (spec 001 D5: "A runner call
 * that fails is a state, never a skip"): every test file becomes `unknown`
 * with this reason and a note is persisted. Each batch (`invalidate`) retries
 * creation once: the config's dependencies are unknown while it does not
 * load, so any batch may be the one that fixes it. A successful retry
 * reports every project as recreated, which re-keys them all.
 */
export function createRecoveringRunner(options: RecoveringRunnerOptions): RecoveringRunner {
  let inner: RunnerAdapter | null = null;
  let error: Error | null = null;
  let reported: string | null = null;
  let retry = false;
  let creating: Promise<RunnerAdapter> | null = null;
  let closed = false;
  const around = options.around ?? ((call) => call());

  const attempt = (): Promise<RunnerAdapter> => {
    retry = false;
    creating ??= (async () => {
      try {
        const created = await options.create();
        if (closed) {
          await created.close();
          throw new Error(`${options.name} adapter: closed`);
        }
        inner = created;
        if (error !== null) options.onRecovered?.();
        error = null;
        reported = null;
        return created;
      } catch (cause) {
        error = new Error(`${options.name} could not start: ${messageOf(cause)}`, { cause });
        if (error.message !== reported && !closed) {
          reported = error.message;
          options.onFailure(error.message);
        }
        throw error;
      } finally {
        creating = null;
      }
    })();
    return creating;
  };

  const adapter = async (): Promise<RunnerAdapter> => {
    if (closed) throw new Error(`${options.name} adapter: closed`);
    if (inner !== null) return inner;
    if (creating !== null || retry || error === null) return attempt();
    throw error;
  };

  return {
    name: options.name,
    adapterVersion: options.adapterVersion,
    open: () =>
      around(async () => {
        try {
          await adapter();
          return true;
        } catch {
          return false;
        }
      }),
    retry() {
      retry = true;
    },
    invalidate: (paths: readonly InvalidatedPath[]) =>
      around(async (): Promise<InvalidateResult> => {
        if (inner !== null || closed) return (await adapter()).invalidate(paths);
        retry = true;
        const fresh = await adapter();
        const projects = new Set((await fresh.environment()).map((e) => e.project));
        return { recreatedProjects: [...projects].sort() };
      }),
    // Task 007-26: a recheck is no batch, so it never retries a failed creation.
    recheck: () =>
      around(async (): Promise<InvalidateResult> => {
        if (inner === null || closed) return { recreatedProjects: [] };
        return (await inner.recheck?.()) ?? { recreatedProjects: [] };
      }),
    affected: (changedPaths) => around(async () => (await adapter()).affected(changedPaths)),
    closure: (testFile: TestFileRef) => around(async () => (await adapter()).closure(testFile)),
    enumerate: (testFile: TestFileRef) => around(async () => (await adapter()).enumerate(testFile)),
    testFiles: () => around(async () => (await adapter()).testFiles()),
    omittedTestFiles: () => inner?.omittedTestFiles?.() ?? 0,
    slowWidth: (testFiles) => inner?.slowWidth?.(testFiles) ?? testFiles.length,
    tierWidth: (testFile, grant) =>
      inner?.tierWidth?.(testFile, grant) ?? options.tierWidth?.(testFile, grant) ?? grant,
    tierPart: (testFile) => inner?.tierPart?.(testFile) ?? "",
    besideBacklog: () => options.besideBacklog === true,
    backlogSlot: () => options.backlogSlot ?? null,
    ...(options.focuses === true ? { focuses: true as const } : {}),
    environment: () => around(async () => (await adapter()).environment()),
    run: (testFiles, runOptions) =>
      around(async () => (await adapter()).run(testFiles, runOptions)),
    close: () =>
      around(async () => {
        if (closed) return;
        closed = true;
        await creating?.catch(() => {});
        await inner?.close();
      }),
  };
}

/** Vite's config bundler colours its errors, and notes are plain text. */
function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return stripVTControlCharacters(text).trim();
}

/** `vitest.config.*`, `vitest.workspace.*`, `vitest.projects.*` or `vite.config.*`. */
const VITEST_CONFIG = /^(vitest\.(config|workspace|projects)|vite\.config)\.[cm]?[jt]s$/;

/**
 * Whether the worktree at `root` uses Vitest: a Vitest or Vite config file at
 * the root, or `vitest` among the root manifest's dependencies. Spec 003 D7:
 * the daemon holds a runner per "configured or detected runner", and the
 * runner failure "project without Vitest" applies only when none is. The
 * daemon builds the Vitest runner when this holds or when no other runner is
 * configured, so a project with neither still gets that failure as a note.
 * `squeal setup --plan` lists Vitest by this rule too (005 D3 step 2).
 */
export function vitestDetected(root: string): boolean {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return false;
  }
  if (names.some((name) => VITEST_CONFIG.test(name))) return true;
  return listsVitest(readManifest(join(root, "package.json")));
}

/** A tracked `package.json`, by its directory relative to the root (`""` for the root). */
export interface ManifestAt {
  readonly dir: string;
  readonly value: unknown;
}

/**
 * Spec 003 D7 as amended 2026-10-22 (row 005-79): the directories below the
 * root whose manifest lists `vitest`, sorted, when `vitestDetected` does not
 * hold. Squeal loads Vitest from the root only, so it runs none of their
 * tests. The daemon's note and the setup plan's line both come from here.
 */
export function vitestBelowRoot(root: string, manifests: readonly ManifestAt[]): string[] {
  if (vitestDetected(root)) return [];
  return manifests
    .filter((m) => m.dir !== "" && listsVitest(m.value))
    .map((m) => m.dir)
    .sort();
}

/** `vitestBelowRoot` over the tracked manifests outside `node_modules`, as the daemon reads them. */
export async function readVitestBelowRoot(root: AbsolutePath): Promise<string[]> {
  if (vitestDetected(root)) return [];
  const tracked = splitNul(await runGit(root, ["ls-files", "-z", "--", ":(glob)**/package.json"]));
  const manifests = tracked
    .filter((path) => !path.split("/").includes("node_modules"))
    .map((path) => ({
      dir: posix.dirname(path).replace(/^\.$/, ""),
      value: readManifest(join(root, path)),
    }));
  return vitestBelowRoot(root, manifests);
}

/** The note on `vitestBelowRoot`'s directories: what is not run, then `vitestBelowRootReason`. */
export function vitestBelowRootNote(dirs: readonly string[]): string {
  return `Vitest in ${dirs.join(", ")} is not run: ${vitestBelowRootReason(dirs)}`;
}

/** Why Squeal runs none of `vitestBelowRoot`'s directories, and the fix; the plan's `not run:` line ends with it. */
export function vitestBelowRootReason(dirs: readonly string[]): string {
  const list = dirs.join(", ");
  return `Squeal loads Vitest from the root only, and the root has no Vitest config and no vitest in package.json. To run ${dirs.length === 1 ? "it" : "them"}, add a root vitest.config.ts whose projects name ${list}, and vitest to the root package.json`;
}

/** `vitest` in a manifest's `dependencies` or `devDependencies`. */
function listsVitest(manifest: unknown): boolean {
  if (!isRecord(manifest)) return false;
  return ["dependencies", "devDependencies"].some((field) => {
    const deps = manifest[field];
    return isRecord(deps) && Object.hasOwn(deps, "vitest");
  });
}

/** The parsed JSON at `path`; `null` when it is missing or not JSON. */
function readManifest(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
