import { mergeBase } from "../core/code/gate/changed.js";
import { type CollectOptions, collectEvidence } from "../core/code/gate/collect.js";
import { loadBasePolicy } from "../core/code/gate/policy.js";
import type { GateAdapters } from "../core/code/gate/runners.js";
import { resolveScope } from "../core/code/gate/scope.js";
import type { ChangedSet, FailedTest, TestFileEvidence } from "../core/code/gate/types.js";
import { readPolicy } from "../core/daemon/policy.js";
import { compare } from "../core/fs/compare.js";
import type { HostLoad } from "../core/retry/load.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import { ADAPTERS } from "./code-gate.js";
import { storedDurations } from "./code-gate-durations.js";
import {
  conditionsOutsideKey,
  effectiveEnvironment,
  withEnvironment,
} from "./code-gate-files-env.js";
import { collectWithStores } from "./code-gate-stored.js";

/*
 * Spec 023 D4.4, D5.2 (row 023-04): 020's gate as a library, for a command
 * that runs test files at a commit in a checkout of its own. It runs the
 * named test files only: no diff, no declared `inputs`, no dirty path
 * widens the selection (`temp-checkout.md` 5.2). It answers each file's
 * outcome with its failed tests and their errors, with no CC or CRAP
 * verdict (5.3). It runs in the caller's process, so no relaunch child
 * outlives it (5.1). Review wave 1 B2: one environment per call, the
 * stores' keys and every run under it (`code-gate-files-env.ts`); by
 * default the process's, `HOME` as the caller has it, and `TMPDIR` may be
 * given per call.
 */

/** What `runGateFiles` runs, and where. */
export interface GateFilesOptions {
  /** The worktree's root: the checkout the files run in. */
  readonly root: AbsolutePath;
  /** The test files to run, relative to `root`; nothing else is selected. */
  readonly files: readonly RelativePath[];
  /** The one budget over the call, the runners' start included (D3.4). */
  readonly budgetSeconds: number;
  /**
   * The call's whole environment: the stores key with it, and the runners'
   * config, a node:test `prepare`, Vitest and node:test run under it; a
   * variable it leaves out is unset. Held in `process.env` for the call
   * and restored after it, so no other call runs meanwhile. Default
   * `process.env`, `HOME` with it (D4.4).
   */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Whether the call reads each file from the shared stores at its key
   * first and keeps each file it completes there (020 D11.7, D17.3).
   * Default `true`. D5.3: a call whose `env` sets a variable otherwise
   * than `process.env`, outside the key's `env.allowlist` (`TMPDIR`
   * aside), runs under a condition its key does not hold; it must give
   * `false`, or it rejects before it runs.
   */
  readonly store?: boolean;
  /**
   * `TMPDIR` for the call, over `env`'s: the gate's folders, Vitest's and
   * the tests' workers' go under it. Held in `process.env` as `env` is.
   * Absent, as `env` has it.
   */
  readonly tempDir?: AbsolutePath;
  /** The gate's notes, one line each; dropped when absent. */
  readonly note?: (text: string) => void;
  /** A node:test `prepare` command's output (020 D15.3); dropped when absent. */
  readonly output?: (text: string) => void;
  /**
   * Row 023-19 (review wave-13 B2): told the call's completion record each
   * time it grows: each run's files as the run ended, and the keeper's
   * decisions as made. A caller that can be stopped before the answer
   * keeps it, and reports from it what completed.
   */
  readonly progress?: (record: GateFilesProgress) => void;
  /** For tests: the runners' adapters, the host's load and the chunk size (`CollectOptions`). */
  readonly adapters?: GateAdapters;
  readonly hostLoad?: () => HostLoad;
  readonly chunkFiles?: number;
}

/**
 * How one named file ended: `passed` and `failed` ran whole or were read;
 * `not-finished` started and was stopped; `not-run` never started, for
 * want of `budget` or because its node:test `prepare` failed.
 */
export type GateFileOutcome = "passed" | "failed" | "not-finished" | "not-run";

/** One named file's outcome. */
export interface GateFileRun {
  readonly runner: TestFileEvidence["runner"];
  readonly path: RelativePath;
  readonly outcome: GateFileOutcome;
  /** `run`, this call ran it; `store` or `parts`, read at its key. */
  readonly from: "run" | "store" | "parts";
  /** Its failed tests with their errors, sorted by name; empty unless `failed`. */
  readonly failed: readonly FailedTest[];
  /** A test of it was skipped. */
  readonly skipped: boolean;
  /** With `not-run`: why. */
  readonly reason?: "budget" | "prepare";
}

/** `runGateFiles`' answer. */
export interface GateFilesResult {
  /** One per named file and runner, by runner, then path. */
  readonly runs: readonly GateFileRun[];
  /** The budget ended before every file ended. */
  readonly timedOut: boolean;
  readonly budgetSeconds: number;
  /**
   * Row 023-18 (D2): the completed files the stores did not keep, each with
   * the keeper's reason; absent when the call stores nothing (`store: false`).
   */
  readonly notKept?: readonly { readonly path: string; readonly reason: string }[];
  /**
   * Review wave-11 B1: each file the stores kept, by project and path, with
   * the key its results were written at: the one key a caller reads this
   * run's outcome back at. Absent when the call stores nothing.
   */
  readonly kept?: readonly {
    readonly project: string;
    readonly path: string;
    readonly key: string;
  }[];
}

/**
 * Row 023-19 (review wave-13 B2): what the call completed so far, per run
 * as it ended (a rerun's outcome replaces its first run's), and per project
 * and path what the keeper kept at which key, or why it did not.
 */
export interface GateFilesProgress {
  readonly runs: readonly GateFileRun[];
  readonly kept: readonly {
    readonly project: string;
    readonly path: string;
    readonly key: string;
  }[];
  readonly notKept: readonly { readonly path: string; readonly reason: string }[];
}

/**
 * Runs `options.files` in `options.root` under one budget, each file
 * known at its key read from the stores instead, and keeps each file it
 * completes in the stores before it returns. Rejects with
 * `CollectUsageError` when no runner lists a named file, and with an
 * `Error` on a setup error (a runner that cannot start, no coverage
 * provider), as the gate exits 2.
 */
export async function runGateFiles(options: GateFilesOptions): Promise<GateFilesResult> {
  const effective = effectiveEnvironment(options);
  if (effective !== null && options.store !== false) {
    const allowlist = readPolicy(options.root).env.allowlist;
    const outside = conditionsOutsideKey(effective, process.env, allowlist);
    if (outside.length > 0) {
      throw new Error(
        `runGateFiles: env sets ${outside.join(", ")} otherwise than this process, outside the key's env.allowlist; a run under it must not store (store: false)`,
      );
    }
  }
  // B2: from here `process.env` is the call's environment, which every step reads.
  return await withEnvironment(effective, () => gateFiles(options, process.env));
}

async function gateFiles(
  options: GateFilesOptions,
  env: NodeJS.ProcessEnv,
): Promise<GateFilesResult> {
  const { root, budgetSeconds } = options;
  const note = options.note ?? (() => {});
  const head = await mergeBase(root, "HEAD");
  // The checkout's own policy, read at its commit as the gate reads the base's (020 D6).
  const { policy, problems } = await loadBasePolicy(root, head);
  for (const problem of problems) note(problem);
  const scope = resolveScope(policy.scope, []);
  if ("error" in scope) throw new Error(scope.error);
  const durations = storedDurations(root);
  const collect = {
    tests: options.files,
    budgetSeconds,
    adapters: options.adapters ?? ADAPTERS,
    note,
    children: policy.children,
    // Files-only: no `inputs`, so no declared input selects a file (`temp-checkout.md` 5.2).
    ...(policy.prepares === undefined ? {} : { prepares: policy.prepares }),
    scope,
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(durations === null ? {} : { durations: durations.of }),
    ...(options.hostLoad === undefined ? {} : { hostLoad: options.hostLoad }),
    ...(options.chunkFiles === undefined ? {} : { chunkFiles: options.chunkFiles }),
    ...progressHooks(options.progress),
  };
  const changed = namedOnly(head);
  try {
    if (options.store === false) {
      const evidence = await collectEvidence(root, changed, collect);
      return { runs: evidence.testFiles.map(fileRun), timedOut: evidence.timedOut, budgetSeconds };
    }
    const collected = await collectWithStores(root, env, changed, collect);
    await collected.keep();
    const { evidence } = collected;
    const notKept = [...collected.notKept()].map(([path, reason]) => ({ path, reason }));
    const runs = evidence.testFiles.map(fileRun);
    const kept = collected
      .kept()
      .map(({ ref, key }) => ({ project: ref.project, path: ref.path, key }));
    return { runs, timedOut: evidence.timedOut, budgetSeconds, notKept, kept };
  } finally {
    durations?.close();
  }
}

/** A changed set with no changed path, so only the `--test` files select (020 D3.1). */
function namedOnly(head: string): ChangedSet {
  return {
    ref: "HEAD",
    baseCommit: head,
    headCommit: head,
    dirty: false,
    paths: [],
    functions: [],
    counted: [],
    inErrors: [],
    uncounted: [],
  };
}

/** One file's evidence as its outcome. */
export function fileRun(file: TestFileEvidence): GateFileRun {
  const base = {
    runner: file.runner,
    path: file.path,
    from: file.from ?? "run",
    skipped: file.skipped,
  } as const;
  if (file.completed) {
    const failed = [...(file.failures ?? file.failed.map((test) => ({ test, errors: [] })))];
    failed.sort((a, b) => compare(a.test, b.test));
    return { ...base, outcome: failed.length > 0 ? "failed" : "passed", failed };
  }
  if (file.notPrepared === true)
    return { ...base, outcome: "not-run", failed: [], reason: "prepare" };
  if (file.notStarted === true || file.overBudget === true) {
    return { ...base, outcome: "not-run", failed: [], reason: "budget" };
  }
  return { ...base, outcome: "not-finished", failed: [] };
}

/**
 * Row 023-19 (review wave-13 B2): `CollectOptions.ended` and `decided`
 * that build the call's completion record and tell it as it grows.
 */
function progressHooks(
  tell: GateFilesOptions["progress"],
): Pick<CollectOptions, "ended" | "decided"> {
  if (tell === undefined) return {};
  const runs = new Map<string, GateFileRun>();
  let kept: GateFilesProgress["kept"] = [];
  let notKept: GateFilesProgress["notKept"] = [];
  const told = () => tell({ runs: [...runs.values()], kept, notKept });
  return {
    ended: (files) => {
      for (const file of files) runs.set(`${file.runner}\0${file.path}`, fileRun(file));
      told();
    },
    decided: (so) => {
      kept = so.kept.map(({ ref, key }) => ({ project: ref.project, path: ref.path, key }));
      notKept = [...so.notKept].map(([path, reason]) => ({ path, reason }));
      told();
    },
  };
}
