import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { type NotStarted, runCommand } from "../core/ci/command.js";
import type { HooksTime, InputEvidence } from "../core/ci/inputs.js";
import { type MapWorker, mapWorkerScript } from "../core/code/coverage/mapper.js";
import { coverageProvider } from "../core/code/coverage/runtime.js";
import { readPolicy } from "../core/daemon/policy.js";
import { squealVersion } from "../core/daemon/version.js";
import { findWorktreeRoot } from "../core/fs/git-layout.js";
import { WorktreePaths } from "../core/fs/worktree-paths.js";
import { readObjectFormat } from "../core/hash/git-index.js";
import type { AbsolutePath } from "../core/types/common.js";
import { type NodeTestRecording, startNodeTestRecording } from "../runners/node-test/ci-record.js";
import {
  NO_VITEST_RUN,
  type RecordingCoverage,
  startRecording,
  type VitestRecording,
  vitestResolves,
} from "../runners/vitest/ci-record.js";
import { ciExportCommand, EXPORT_USAGE } from "./ci-export.js";
import { type Body, nodeTestBody, vitestBody, writeParts } from "./ci-parts.js";
import { ciPublishCommand, PUBLISH_USAGE } from "./ci-publish.js";
import type { CliIo } from "./main.js";

const RECORD_USAGE = "usage: squeal ci record [--out <dir>] -- <command> [args...]\n";
const USAGE = `${RECORD_USAGE}${EXPORT_USAGE}${PUBLISH_USAGE}`;

/** The directory `--out` defaults to, in the working directory. */
export const DEFAULT_PARTS_DIR = "squeal-parts";

export interface CiDeps {
  /** Where the private directory goes; default the OS temp directory. */
  readonly tempDir?: AbsolutePath;
  /** The records' worker; default `coverage-map.mjs` beside the bundled CLI (`mapWorkerScript`). */
  readonly mapWorker?: MapWorker;
}

/**
 * `squeal ci <subcommand>`, spec 018's CI side. `record` (D8): runs the
 * project's test command unchanged and exits with its code; for a Vitest
 * command, also writes one part per Vitest process into `--out` (default
 * `squeal-parts/`). Exit 2 on a usage error; otherwise the command's code,
 * whatever Squeal could record, since nothing in CI gates on Squeal (D16).
 * Spec 020 D13: the parts also hold each test file's coverage record, from
 * Squeal's provider, which `record` adds unless the run has coverage of its own.
 * `export` (D9): the parts as one export, keyed in this checkout
 * (`ciExportCommand`). `publish` (D13): the export as a results ref on
 * `origin`, older refs pruned (`ciPublishCommand`).
 */
export async function ciCommand(
  args: readonly string[],
  io: CliIo,
  deps: CiDeps = {},
): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "export") return ciExportCommand(rest, io, deps.tempDir);
  if (sub === "publish") return ciPublishCommand(rest, io);
  if (sub !== "record") {
    io.stderr(`squeal ci: ${sub === undefined ? "no subcommand" : `unknown "${sub}"`}\n${USAGE}`);
    return 2;
  }
  const parsed = parseRecord(rest);
  if ("error" in parsed) {
    io.stderr(`squeal ci record: ${parsed.error}\n${RECORD_USAGE}`);
    return 2;
  }
  return record(parsed, io, deps);
}

interface RecordArgs {
  readonly out: string | null;
  readonly command: readonly [string, ...string[]];
}

function parseRecord(args: readonly string[]): RecordArgs | { readonly error: string } {
  let out: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") {
      const [program, ...rest] = args.slice(i + 1);
      if (program === undefined) return { error: "no command after --" };
      return { out, command: [program, ...rest] };
    }
    if (arg === "--out" || arg.startsWith("--out=")) {
      const value = arg === "--out" ? args[++i] : arg.slice("--out=".length);
      if (value === undefined || value === "") return { error: "--out names no directory" };
      out = value;
    } else return { error: `unknown argument "${arg}"` };
  }
  return { error: "no command: put it after --" };
}

async function record(args: RecordArgs, io: CliIo, deps: CiDeps): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const env = { ...(io.env ?? process.env) };
  const say = (text: string) => io.stderr(`squeal ci record: ${text}\n`);
  const unchanged = async (why: string) => {
    say(`${why}; the command runs unchanged, nothing recorded`);
    return exitOf(await runCommand(args.command, cwd, env), say);
  };
  // Spec 018 D20.2 (row 018-33): an error of Squeal's own before the command runs it unchanged.
  let started: Started | string;
  try {
    started = await startFor(cwd, env, deps);
  } catch (error) {
    started = `Squeal could not start recording (${errorText(error)})`;
  }
  if (typeof started === "string") return unchanged(started);
  const { root } = started;
  try {
    const exit = exitOf(await runCommand(args.command, cwd, started.env), say);
    const commandEnd = performance.now();
    try {
      const { bodies, notes, evidence, hooks } = finishAll(started);
      for (const note of notes) say(note);
      if (bodies.length > 0) {
        const out = resolve(cwd, args.out ?? DEFAULT_PARTS_DIR);
        say(await writeParts(bodies, out, root, env, io, evidence, { hooks, commandEnd }));
      }
    } catch (error) {
      say(`no part written: ${error instanceof Error ? (error.stack ?? error.message) : error}`);
    }
    return exit;
  } finally {
    for (const recording of [started.vitest, started.nodeTest]) {
      try {
        recording?.close();
      } catch (error) {
        say(`could not remove its temporary files: ${errorText(error)}`);
      }
    }
  }
}

interface Started {
  readonly root: AbsolutePath;
  /** The env the command runs with. */
  readonly env: NodeJS.ProcessEnv;
  /** Vitest's recording, which takes the evidence for both when there. */
  readonly vitest: VitestRecording | null;
  /** Row 018-47: node:test's, when `squeal.config.json` has a `nodeTest` entry. */
  readonly nodeTest: NodeTestRecording | null;
}

/**
 * The recordings for a command in `cwd` (D8, D22): Vitest's when Vitest
 * resolves, node:test's when the project has a `nodeTest` entry, both when
 * both; or why the command runs unchanged.
 */
async function startFor(
  cwd: string,
  env: NodeJS.ProcessEnv,
  deps: CiDeps,
): Promise<Started | string> {
  const root = findWorktreeRoot(cwd);
  if (root === null) return `${cwd} is not inside a git worktree`;
  const policy = readPolicy(root);
  const vitest = vitestResolves(root);
  if (!vitest && policy.nodeTest.length === 0) {
    return `Vitest does not resolve from ${root} and squeal.config.json has no nodeTest entry`;
  }
  const paths = new WorktreePaths(root);
  const objectFormat = await readObjectFormat(root);
  const tempDir = deps.tempDir === undefined ? {} : { tempDir: deps.tempDir };
  let nodeTest: NodeTestRecording | null = null;
  if (policy.nodeTest.length > 0) {
    const entries = policy.nodeTest;
    const allowlist = policy.env.allowlist;
    const started = startNodeTestRecording({
      paths,
      env,
      entries,
      allowlist,
      objectFormat,
      ...tempDir,
    });
    if (typeof started === "string") return started;
    nodeTest = started;
  }
  if (!vitest && nodeTest !== null) {
    return { root, env: nodeTest.alone(), vitest: null, nodeTest };
  }
  const { hooks, settings } = nodeTest?.addition ?? {};
  const recording = startRecording({
    paths,
    env,
    observe: policy.observe.runtimeInputs,
    allowlist: policy.env.allowlist,
    squealVersion: squealVersion(),
    objectFormat,
    coverage: recordingCoverage(deps),
    ...(hooks === undefined || settings === undefined ? {} : { also: { hooks, settings } }),
    ...tempDir,
  });
  if (typeof recording === "string") {
    nodeTest?.close();
    return recording;
  }
  const commandEnv = { ...recording.env, ...nodeTest?.addition.env };
  return { root, env: commandEnv, vitest: recording, nodeTest };
}

/** Each recording's part bodies, its notes, and the command's evidence and hooks' time. */
function finishAll(started: Started): {
  bodies: Body[];
  notes: string[];
  evidence: InputEvidence;
  hooks: HooksTime;
} {
  const vitest = started.vitest?.finish();
  const nodeTest = started.nodeTest?.finish();
  const bodies = [
    ...(vitest?.runs ?? []).map(vitestBody),
    ...(nodeTest?.runs ?? []).map(nodeTestBody),
  ];
  const vitestNotes = vitest?.notes ?? [];
  // A command of node:test alone is no missing Vitest run.
  const quiet = (nodeTest?.runs.length ?? 0) > 0 && vitestNotes.join() === NO_VITEST_RUN;
  const notes = [...(quiet ? [] : vitestNotes), ...(nodeTest?.notes ?? [])];
  if (vitest === undefined && bodies.length === 0)
    notes.push("no node --test process left a part: nothing recorded");
  const read = vitest ?? nodeTest?.evidence ?? { evidence: {}, hooks: { ms: 0, threads: 0 } };
  return { bodies, notes, evidence: read.evidence, hooks: read.hooks };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Spec 020 D13: the provider and the records' worker beside this Squeal, or which is missing. */
function recordingCoverage(deps: CiDeps): RecordingCoverage {
  const provider = coverageProvider();
  if (provider === null) return { missing: "this Squeal has no coverage/provider.mjs" };
  const script = mapWorkerScript();
  const worker = deps.mapWorker ?? (script === null ? null : { script });
  return worker === null
    ? { missing: "this Squeal has no records' worker (cli/coverage-map.mjs)" }
    : { provider, worker };
}

function exitOf(result: number | NotStarted, say: (text: string) => void): number {
  if (typeof result === "number") return result;
  say(result.failed);
  return result.code;
}
