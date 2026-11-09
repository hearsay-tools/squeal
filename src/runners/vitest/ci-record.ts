import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { PartEnd, PartFile, PartProject } from "../../core/ci/parts.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import type { AbsolutePath } from "../../core/types/common.js";
import { takeRecorded } from "../observe/read.js";
import {
  OBSERVE_VARIABLE,
  observeEnv,
  observeRecorder,
  recorderOption,
  unobservedEnv,
} from "../observe/runtime.js";
import { ownNodeOptions } from "../process/recorders.js";
import { readRawRuns, recordedRun } from "./ci-runs.js";

/*
 * Spec 018 D8 (row 018-16): `squeal ci record` around the project's own
 * Vitest command. No instance of Squeal's: the command's own Vitest runs,
 * with the recorder (`recorder.cjs`) in its workers and a hook
 * (`vitest-ci.cjs`) in its CLI process, both through `NODE_OPTIONS`. The hook
 * writes each process's run into a private temp directory; `finish` turns
 * each into a part's body. No daemon, no store, no key.
 */

/** The env variable carrying the hook's settings (`vitest-ci.cjs`). */
export const CI_RECORD_VARIABLE = "SQUEAL_CI_RECORD";

/** One Vitest process's run, as a part holds it below its header. */
export interface RecordedRun {
  readonly end: PartEnd;
  readonly runnerVersion: string;
  readonly observing: boolean;
  readonly projects: readonly PartProject[];
  readonly testFiles: readonly PartFile[];
}

export interface RecordingOptions {
  readonly paths: WorktreePaths;
  /** The env the command would run with. */
  readonly env: NodeJS.ProcessEnv;
  /** Policy `observe.runtimeInputs`. */
  readonly observe: boolean;
  /** Policy `env.allowlist`. */
  readonly allowlist: readonly string[];
  readonly squealVersion: string;
  /** Where the private directory goes; default the OS temp directory. */
  readonly tempDir?: AbsolutePath;
}

export interface VitestRecording {
  /** The env the command runs with: the recorder and the hook in `NODE_OPTIONS`. */
  readonly env: NodeJS.ProcessEnv;
  /** After the command exited: each Vitest process's run, and a note for each that left none. */
  finish(): { readonly runs: RecordedRun[]; readonly notes: string[] };
  /** Removes the private directory. */
  close(): void;
}

/** Whether `vitest` resolves from `root`, as the daemon loads it (`loadVitest`). */
export function vitestResolves(root: AbsolutePath): boolean {
  try {
    createRequire(join(root, "package.json")).resolve("vitest/package.json");
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the hook sits relative to `module`, the running code's own file: from
 * a bundled CLI at `<plugin>/dist/cli/`, the plugin's `dist/ci/`
 * (`src/harness/build.ts` `CI_RUNTIME`); from the sources, `ci-runtime/`
 * beside this file. `null` when neither holds it.
 */
const HOOK_CANDIDATES = ["../ci/", "./ci/", "./ci-runtime/"] as const;

export function ciHook(module: URL = new URL(import.meta.url)): AbsolutePath | null {
  for (const candidate of HOOK_CANDIDATES) {
    const hook = fileURLToPath(new URL(`${candidate}vitest-ci.cjs`, module));
    if (existsSync(hook)) return hook;
  }
  return null;
}

/** The recording around one command; why not when this Squeal lacks its hook file. */
export function startRecording(options: RecordingOptions): VitestRecording | string {
  const hook = ciHook();
  if (hook === null) return "this Squeal has no vitest-ci.cjs (dist/ci/)";
  const recorder = options.observe ? observeRecorder() : null;
  const temp = mkdtempSync(join(options.tempDir ?? tmpdir(), "squeal-ci-"));
  const raw = join(temp, "raw");
  const observed = join(temp, "observe");
  mkdirSync(raw);
  mkdirSync(observed);
  const env = { ...options.env, ...commandEnv(options, hook, recorder, temp, observed) };
  env[CI_RECORD_VARIABLE] = JSON.stringify({ raw, variables: [...options.allowlist] });
  return {
    env,
    finish: () => {
      const recorded = recorder === null ? null : takeRecorded(observed);
      const { runs, notes } = readRawRuns(raw);
      const context = { ...options, observing: recorder !== null, recorded };
      const none = runs.length === 0 && notes.length === 0;
      return {
        runs: runs.map((run) => recordedRun(run, context)),
        notes: none ? ["no Vitest run in this command: nothing recorded"] : notes,
      };
    },
    close: () => rmSync(temp, { recursive: true, force: true }),
  };
}

/**
 * `NODE_OPTIONS` with the recorder first, as the daemon's workers get it
 * (`observeEnv`), then the hook; without the recorder, another Squeal's is
 * left out (`unobservedEnv`). The recorder skips the OS temp directory unless
 * the worktree lies in it, as `VitestObserver` does, and this run's own
 * directory always.
 */
function commandEnv(
  options: RecordingOptions,
  hook: AbsolutePath,
  recorder: AbsolutePath | null,
  temp: AbsolutePath,
  observed: AbsolutePath,
): Record<string, string> {
  const inherited = options.env.NODE_OPTIONS;
  const own = (inherited === undefined ? undefined : ownNodeOptions(inherited))?.trim() ?? "";
  const hookOption = recorderOption(hook, own);
  const withHook = own === "" ? hookOption : `${hookOption} ${own}`;
  if (recorder === null) return { ...unobservedEnv(options.env), NODE_OPTIONS: withHook };
  const root = options.paths.root;
  const system = tmpdir();
  const contains = `${root}${sep}`.startsWith(`${system}${sep}`);
  const settings = { out: observed, root, skip: contains ? [temp] : [system, temp] };
  const env = observeEnv(recorder, settings, withHook);
  return {
    NODE_OPTIONS: env.NODE_OPTIONS ?? withHook,
    [OBSERVE_VARIABLE]: env[OBSERVE_VARIABLE] ?? "",
  };
}
