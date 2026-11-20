import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type Recorded, readRecorded } from "../../core/ci/inputs.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import type { ObjectFormat } from "../../core/hash/blob.js";
import type { AbsolutePath } from "../../core/types/common.js";
import type { NodeTestProject } from "../../core/types/policy.js";
import { recorderOption } from "../observe/runtime.js";
import { ownNodeOptions } from "../process/recorders.js";
import { type NodeTestRecordedRun, readNodeTestRuns } from "./ci-runs.js";
import { nodeTestRuntime } from "./runtime.js";

/*
 * Spec 018 D22 to D24 (row 018-47): `squeal ci record` around a node:test
 * command. No reporter goes into `NODE_OPTIONS` (the human, 2026-11-20): the
 * project names Squeal's reporter (`SQUEAL_NODE_TEST_REPORTER`) in its own
 * command, and it writes each `node --test` process's events into this
 * recording's private directory. `NODE_OPTIONS` gets the node:test CI hook
 * (`node-test-ci.cjs`), which takes the input evidence and points the
 * daemon's own module recorder (`runtime/recorder.cjs`, after it) at the test
 * file each process runs for. `finish` turns each `node --test` process into
 * a part's body (`ci-runs.ts`). No daemon, no store, no key.
 */

/** The variable holding the reporter's absolute path (D23.1). */
export const NODE_TEST_REPORTER_VARIABLE = "SQUEAL_NODE_TEST_REPORTER";

/** The CI hook and the reporter `ci record` gives a node:test command. */
export interface NodeTestCiRuntime {
  readonly hook: AbsolutePath;
  readonly reporter: AbsolutePath;
}

/**
 * Where they sit relative to `module`, the running code's own file: from a
 * bundled CLI at `<plugin>/dist/cli/`, the plugin's `dist/ci/`
 * (`src/harness/build.ts` `CI_RUNTIME`); from the sources, `ci-runtime/`
 * beside this file. `null` when neither holds both.
 */
const CANDIDATES = ["../ci/", "./ci-runtime/"] as const;

export function nodeTestCiRuntime(
  module: URL = new URL(import.meta.url),
): NodeTestCiRuntime | null {
  for (const candidate of CANDIDATES) {
    const hook = fileURLToPath(new URL(`${candidate}node-test-ci.cjs`, module));
    const reporter = fileURLToPath(new URL(`${candidate}node-test-reporter.mjs`, module));
    if (existsSync(hook) && existsSync(reporter)) return { hook, reporter };
  }
  return null;
}

/** The settings the hook and the reporter read in `SQUEAL_CI_RECORD`, under `nodeTest`. */
export interface NodeTestSettings {
  /** Where the recorder writes each test file process's edges, and the hook its file. */
  readonly graph: AbsolutePath;
  /** Where the reporter writes each `node --test` process's events. */
  readonly events: AbsolutePath;
  /**
   * The variables the `nodeTest` entries' `env` names (D25) and the policy's
   * `env.allowlist` (review of 0.1.579 B2): the reporter writes their values.
   */
  readonly variables: readonly string[];
}

/** What node:test adds to a command another recording also wraps (Vitest's, `startRecording`). */
export interface NodeTestAddition {
  /** The hook, then the module recorder, in this order after the other recording's own. */
  readonly hooks: readonly AbsolutePath[];
  readonly settings: { readonly nodeTest: NodeTestSettings };
  /** Variables the command's env gets (D23.1). */
  readonly env: Readonly<Record<string, string>>;
}

export interface NodeTestRecordingOptions {
  readonly paths: WorktreePaths;
  /** The env the command would run with. */
  readonly env: NodeJS.ProcessEnv;
  /** The project's `nodeTest` entries in this checkout's `squeal.config.json`. */
  readonly entries: readonly NodeTestProject[];
  /** The policy's `env.allowlist`: keyed for every runner (D1), so recorded too (B2). */
  readonly allowlist: readonly string[];
  /** The repository's object format: the evidence hashes files as git does. */
  readonly objectFormat: ObjectFormat;
  /** Where the private directory goes; default the OS temp directory. */
  readonly tempDir?: AbsolutePath;
}

export interface NodeTestRecording {
  readonly addition: NodeTestAddition;
  /**
   * The env of a command no other recording wraps: the hooks first in
   * `NODE_OPTIONS`, the settings with the evidence's own directory.
   */
  alone(): NodeJS.ProcessEnv;
  /**
   * After the command exited: each `node --test` process's part body and a
   * note per problem; with `alone`, what the hooks recorded (`Recorded`).
   */
  finish(): {
    readonly runs: NodeTestRecordedRun[];
    readonly notes: string[];
    readonly evidence?: Recorded;
  };
  /** Removes the private directory. */
  close(): void;
}

/** The recording for `options`, or why not when this Squeal lacks its files. */
export function startNodeTestRecording(
  options: NodeTestRecordingOptions,
): NodeTestRecording | string {
  const runtime = nodeTestCiRuntime();
  if (runtime === null) return "this Squeal has no node-test-ci.cjs (dist/ci/)";
  const { recorder } = nodeTestRuntime();
  const temp = mkdtempSync(join(options.tempDir ?? tmpdir(), "squeal-ci-node-test-"));
  const graph = join(temp, "graph");
  const events = join(temp, "events");
  for (const dir of [graph, events]) mkdirSync(dir);
  const named = options.entries.flatMap((entry) => Object.keys(entry.env));
  const variables = [...new Set([...named, ...options.allowlist])];
  const settings = { nodeTest: { graph, events, variables: variables.sort() } };
  const hooks = [runtime.hook, recorder];
  const addition = { hooks, settings, env: { [NODE_TEST_REPORTER_VARIABLE]: runtime.reporter } };
  let evidence: AbsolutePath | null = null;
  return {
    addition,
    alone: () => {
      evidence = join(temp, "evidence");
      mkdirSync(evidence);
      return aloneEnv(options, addition, temp, evidence);
    },
    finish: () => {
      const read = evidence === null ? undefined : readRecorded(evidence);
      const { runs, notes } = readNodeTestRuns({ graph, events }, { paths: options.paths });
      return { runs, notes, ...(read === undefined ? {} : { evidence: read }) };
    },
    close: () => rmSync(temp, { recursive: true, force: true }),
  };
}

/**
 * The hooks first in `NODE_OPTIONS`, ahead of the project's own, each as
 * `recorderOption` writes it (as Vitest's recording does); another Squeal's
 * recorder there is left out. `skip`: the OS temp directory unless the
 * worktree lies in it, and this recording's own directory always.
 */
function aloneEnv(
  options: NodeTestRecordingOptions,
  addition: NodeTestAddition,
  temp: AbsolutePath,
  evidence: AbsolutePath,
): NodeJS.ProcessEnv {
  const inherited = options.env.NODE_OPTIONS;
  const own = (inherited === undefined ? undefined : ownNodeOptions(inherited))?.trim() ?? "";
  const hooks = addition.hooks.map((hook) => recorderOption(hook, own)).join(" ");
  const root = options.paths.root;
  const system = tmpdir();
  const skip = `${root}${sep}`.startsWith(`${system}${sep}`) ? [temp] : [system, temp];
  const settings = {
    hooks: addition.hooks,
    evidence: { out: evidence, root, skip, format: options.objectFormat },
    ...addition.settings,
  };
  return {
    ...options.env,
    ...addition.env,
    NODE_OPTIONS: own === "" ? hooks : `${hooks} ${own}`,
    SQUEAL_CI_RECORD: JSON.stringify(settings),
  };
}
