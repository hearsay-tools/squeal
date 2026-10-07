import { stripVTControlCharacters } from "node:util";
import type {
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
    affected: (changedPaths) => around(async () => (await adapter()).affected(changedPaths)),
    closure: (testFile: TestFileRef) => around(async () => (await adapter()).closure(testFile)),
    enumerate: (testFile: TestFileRef) => around(async () => (await adapter()).enumerate(testFile)),
    testFiles: () => around(async () => (await adapter()).testFiles()),
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
