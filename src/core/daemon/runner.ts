import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { runGit, splitNul } from "../fs/git.js";
import { isRecord } from "../fs/json.js";
import type { AbsolutePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import type {
  InvalidatedPath,
  InvalidateResult,
  RunnerAdapter,
  RunnerEnvironment,
} from "../types/runner.js";
import { IdleClock, type Parked, reopened } from "./runner-idle.js";

export interface RecoveringRunnerOptions {
  readonly name: string;
  readonly adapterVersion: string;
  /** Builds the real adapter, e.g. `createVitestAdapter`, which rejects on a broken config. */
  readonly create: () => Promise<RunnerAdapter>;
  /** A creation attempt failed with a message not reported before. */
  readonly onFailure: (message: string) => void;
  /** A creation attempt worked after a failure. */
  readonly onRecovered?: () => void;
  /**
   * `RunnerAdapter.tierWidth`, before the adapter's own: node:test's and
   * pytest's `runner.tierSize` (task 001-366), which a runner host's proxy
   * would otherwise answer with the grant (row 021-12).
   */
  readonly tierWidth?: (testFile: TestFileRef, grant: number) => number;
  /** `RunnerAdapter.besideBacklog` of every file, before the adapter exists too (task 011-21). */
  readonly besideBacklog?: boolean;
  /** `RunnerAdapter.backlogSlot` of every file, before the adapter exists too (task 011-21 slice 2). */
  readonly backlogSlot?: number;
  /** `RunnerAdapter.focuses`, before the adapter exists too (spec 011 C14, row 011-145). */
  readonly focuses?: true;
  /** Wraps every call that reaches the adapter, creation included (the working directory, D10). */
  readonly around?: (<T>(call: () => Promise<T>) => Promise<T>) | undefined;
  /**
   * Spec 021 D7 (row 021-11): whether the adapter can answer no more, as a
   * runner host that exited or missed a deadline. Such an adapter is closed
   * and dropped; the next call creates a new one, and the next `invalidate`
   * reports every project recreated. Absent: an adapter lives until `close`.
   */
  readonly gone?: (adapter: RunnerAdapter) => boolean;
  /**
   * Spec 021 D20 (row 021-26): milliseconds after which an adapter with no
   * call in flight, and none started, is closed, read each time the clock
   * starts (`IdleClock`); `0` keeps it. A planned close is not `gone`: no
   * check becomes `unknown`, no note is written, the next call creates a new
   * adapter, and the first `invalidate` after reports only the projects that
   * adapter recreates for the batch, or whose environment it answers
   * differently (`driftedProjects`). Absent: never closed when idle.
   */
  readonly idleMs?: () => number;
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
  // Spec 021 D7: a gone adapter was dropped, and no `invalidate` has re-keyed since.
  let replaced = false;
  // Spec 021 D20.3: an idle adapter was closed, and no `invalidate` has reported since.
  let parked: Parked | null = null;
  // D20.3: the environment `inner` last answered, which the scheduler keyed.
  let answered: readonly RunnerEnvironment[] | null = null;
  const around = options.around ?? ((call) => call());

  /** Spec 021 D20.2: closes an idle adapter. No crash: nothing is replaced. */
  const park = () => {
    const current = live();
    if (current === null || closed) return;
    inner = null;
    parked = { last: current, environment: answered ?? parked?.environment ?? null };
    answered = null;
    current.close().catch(() => {});
  };
  const clock = new IdleClock(options.idleMs ?? (() => 0), park);
  // D20.1: the synchronous members answer from the adapter closed when idle until another exists.
  const values = (): RunnerAdapter | null => inner ?? parked?.last ?? null;

  /** `inner`, unless it is gone: then it is closed and dropped. */
  const live = (): RunnerAdapter | null => {
    if (inner !== null && options.gone?.(inner) === true) {
      const dead = inner;
      inner = null;
      replaced = true;
      dead.close().catch(() => {});
    }
    return inner;
  };

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
        answered = null;
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
    const current = live();
    if (current !== null) return current;
    if (creating !== null || retry || error === null) return attempt();
    throw error;
  };

  /** A call that reaches the adapter, in flight on the idle clock (D20.2). */
  const call = <T>(work: (adapter: RunnerAdapter) => Promise<T>): Promise<T> =>
    around(async () => {
      clock.begin(true);
      try {
        return await work(await adapter());
      } finally {
        clock.end();
      }
    });

  return {
    name: options.name,
    adapterVersion: options.adapterVersion,
    open: () =>
      around(async () => {
        clock.begin(true);
        try {
          await adapter();
          return true;
        } catch {
          return false;
        } finally {
          clock.end();
        }
      }),
    retry() {
      retry = true;
    },
    invalidate: (paths: readonly InvalidatedPath[]) =>
      around(async (): Promise<InvalidateResult> => {
        clock.begin(true);
        try {
          const current = live();
          // Spec 021 D20.3: the batch goes to the next adapter now, as every batch's `affected` would.
          if (!closed && !replaced && parked !== null && (current !== null || error === null)) {
            const fresh = current ?? (await adapter());
            const { result, environment } = await reopened(fresh, parked, paths);
            if (environment !== null && fresh === inner) answered = environment;
            parked = null;
            return result;
          }
          if (closed || (current !== null && !replaced)) {
            return await (await adapter()).invalidate(paths);
          }
          // A failed creation retries at each batch. A new adapter, made here or since a gone one
          // was dropped (spec 021 D7), is a new instance: every project is recreated.
          if (current === null) retry = true;
          replaced = false;
          parked = null;
          const fresh = await adapter();
          if (current !== null) await fresh.invalidate(paths);
          return { recreatedProjects: await projectsOf(fresh) };
        } finally {
          clock.end();
        }
      }),
    // Task 007-26: a recheck is no batch, so it never retries a failed creation, nor reopens a
    // closed adapter, and it does not hold an idle one up (spec 021 D20.2).
    recheck: () =>
      around(async (): Promise<InvalidateResult> => {
        const current = live();
        if (current === null || closed) return { recreatedProjects: [] };
        clock.begin(false);
        try {
          return (await current.recheck?.()) ?? { recreatedProjects: [] };
        } finally {
          clock.end();
        }
      }),
    affected: (changedPaths) => call((a) => a.affected(changedPaths)),
    closure: (testFile: TestFileRef) => call((a) => a.closure(testFile)),
    enumerate: (testFile: TestFileRef) => call((a) => a.enumerate(testFile)),
    testFiles: () => call((a) => a.testFiles()),
    omittedTestFiles: () => values()?.omittedTestFiles?.() ?? 0,
    slowWidth: (testFiles) => values()?.slowWidth?.(testFiles) ?? testFiles.length,
    tierWidth: (testFile, grant) =>
      options.tierWidth?.(testFile, grant) ?? values()?.tierWidth?.(testFile, grant) ?? grant,
    tierPart: (testFile) => values()?.tierPart?.(testFile) ?? "",
    besideBacklog: () => options.besideBacklog === true,
    backlogSlot: () => options.backlogSlot ?? null,
    ...(options.focuses === true ? { focuses: true as const } : {}),
    environment: () =>
      call(async (a) => {
        const answer = await a.environment();
        if (a === inner) answered = answer;
        return answer;
      }),
    run: (testFiles, runOptions) => call((a) => a.run(testFiles, runOptions)),
    close: () =>
      around(async () => {
        if (closed) return;
        closed = true;
        clock.stop();
        parked = null;
        await creating?.catch(() => {});
        await inner?.close();
      }),
  };
}

/** Every project of `adapter`, sorted: what a new instance reports recreated. */
async function projectsOf(adapter: RunnerAdapter): Promise<string[]> {
  return [...new Set((await adapter.environment()).map((e) => e.project))].sort();
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

/**
 * Spec 003 D7: whether the daemon builds the Vitest runner in `root` under
 * `policy`: no other runner is configured, or `vitestDetected` holds. The one
 * rule for the daemon, the gate, the header's listing runners and `retry`.
 */
export function runsVitest(root: string, policy: Pick<Policy, "nodeTest" | "pytest">): boolean {
  return policy.nodeTest.length + policy.pytest.length === 0 || vitestDetected(root);
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
