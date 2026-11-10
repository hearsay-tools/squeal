import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type InputEvidence, readEvidence } from "../../core/ci/inputs.js";
import type {
  PartCoverage,
  PartEnd,
  PartFile,
  PartProject,
  PartRecords,
  PartShard,
} from "../../core/ci/parts.js";
import type { MapWorker } from "../../core/code/coverage/mapper.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import type { ObjectFormat } from "../../core/hash/blob.js";
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
 * (`vitest-ci.cjs`) in every process, both through `NODE_OPTIONS`. The hook
 * writes each Vitest process's run into a private temp directory, and in
 * every process the evidence of what it read as it read it (`evidence.cjs`,
 * D9 as amended 2026-11-09); `finish` turns each run into a part's body. No
 * daemon, no store, no key.
 */

/** The env variable carrying the hook's settings (`vitest-ci.cjs`). */
export const CI_RECORD_VARIABLE = "SQUEAL_CI_RECORD";

/** One Vitest process's run, as a part holds it below its header. */
export interface RecordedRun {
  readonly end: PartEnd;
  readonly runnerVersion: string;
  readonly shard: PartShard;
  readonly observing: boolean;
  readonly projects: readonly PartProject[];
  readonly testFiles: readonly PartFile[];
  /** Spec 020 D13: whether the provider was in the run; absent when the hook said nothing of it. */
  readonly coverage?: PartCoverage;
  /** The records `testFiles` name; absent when none was made. */
  readonly records?: PartRecords;
}

/**
 * Spec 020 D13: Squeal's coverage provider and the records' worker the hook
 * adds to the run, or why this Squeal has none.
 */
export type RecordingCoverage =
  | { readonly provider: AbsolutePath; readonly worker: MapWorker }
  | { readonly missing: string };

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
  /** The repository's object format: the evidence hashes files as git does. */
  readonly objectFormat: ObjectFormat;
  readonly coverage: RecordingCoverage;
}

export interface VitestRecording {
  /** The env the command runs with: the recorder and the hook in `NODE_OPTIONS`. */
  readonly env: NodeJS.ProcessEnv;
  /**
   * After the command exited: each Vitest process's run, a note for each
   * process that left none, and the command's read-time evidence
   * (`readEvidence`).
   */
  finish(): {
    readonly runs: RecordedRun[];
    readonly notes: string[];
    readonly evidence: InputEvidence;
  };
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
  const evidence = join(temp, "evidence");
  for (const dir of [raw, observed, evidence]) mkdirSync(dir);
  const { env: commandVariables, skip } = commandEnv(options, hook, recorder, temp, observed);
  const env = { ...options.env, ...commandVariables };
  const root = options.paths.root;
  env[CI_RECORD_VARIABLE] = JSON.stringify({
    raw,
    variables: [...options.allowlist],
    evidence: { out: evidence, root, skip, format: options.objectFormat },
    coverage: coverageSettings(options, join(temp, "coverage")),
  });
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
        evidence: readEvidence(evidence),
      };
    },
    close: () => rmSync(temp, { recursive: true, force: true }),
  };
}

/** `coverage.cjs`'s settings: the provider, the worker, where payloads go, the root records are relative to. */
function coverageSettings(options: RecordingOptions, dir: AbsolutePath) {
  const { coverage } = options;
  if ("missing" in coverage) return { off: "no-provider", note: coverage.missing };
  const { script, execArgv } = coverage.worker;
  const worker = execArgv === undefined ? { script } : { script, execArgv: [...execArgv] };
  const root = options.paths.root;
  return { provider: coverage.provider, worker, dir, root, format: options.objectFormat };
}

/**
 * `NODE_OPTIONS` with the recorder first, as the daemon's workers get it
 * (`observeEnv`), then the hook; without the recorder, another Squeal's is
 * left out (`unobservedEnv`). `skip`: what the recorder and the evidence
 * never record, the OS temp directory unless the worktree lies in it, as
 * `VitestObserver` skips it, and this run's own directory always.
 */
function commandEnv(
  options: RecordingOptions,
  hook: AbsolutePath,
  recorder: AbsolutePath | null,
  temp: AbsolutePath,
  observed: AbsolutePath,
): { env: Record<string, string>; skip: AbsolutePath[] } {
  const inherited = options.env.NODE_OPTIONS;
  const own = (inherited === undefined ? undefined : ownNodeOptions(inherited))?.trim() ?? "";
  const hookOption = recorderOption(hook, own);
  const withHook = own === "" ? hookOption : `${hookOption} ${own}`;
  const root = options.paths.root;
  const system = tmpdir();
  const skip = `${root}${sep}`.startsWith(`${system}${sep}`) ? [temp] : [system, temp];
  if (recorder === null) {
    return { env: { ...unobservedEnv(options.env), NODE_OPTIONS: withHook }, skip };
  }
  const env = observeEnv(recorder, { out: observed, root, skip }, withHook);
  return {
    env: {
      NODE_OPTIONS: env.NODE_OPTIONS ?? withHook,
      [OBSERVE_VARIABLE]: env[OBSERVE_VARIABLE] ?? "",
    },
    skip,
  };
}
