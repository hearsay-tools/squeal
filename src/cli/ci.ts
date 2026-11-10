import { resolve } from "node:path";
import { type NotStarted, runCommand } from "../core/ci/command.js";
import type { InputEvidence } from "../core/ci/inputs.js";
import { PART_FORMAT, type Part, type PartHeader, writePart } from "../core/ci/parts.js";
import { type MapWorker, mapWorkerScript } from "../core/code/coverage/mapper.js";
import { coverageProvider } from "../core/code/coverage/runtime.js";
import { readPolicy } from "../core/daemon/policy.js";
import { squealVersion } from "../core/daemon/version.js";
import { readHead } from "../core/daemon-loop/head.js";
import { findWorktreeRoot } from "../core/fs/git-layout.js";
import { WorktreePaths } from "../core/fs/worktree-paths.js";
import { readObjectFormat } from "../core/hash/git-index.js";
import { KEY_FORMAT_VERSION } from "../core/keys/key-format.js";
import type { AbsolutePath } from "../core/types/common.js";
import {
  type RecordedRun,
  type RecordingCoverage,
  startRecording,
  vitestResolves,
} from "../runners/vitest/ci-record.js";
import { ciExportCommand, EXPORT_USAGE } from "./ci-export.js";
import { ciPublishCommand, PUBLISH_USAGE } from "./ci-publish.js";
import { sourceOf } from "./export.js";
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
  const root = findWorktreeRoot(cwd);
  if (root === null) return unchanged(`${cwd} is not inside a git worktree`);
  if (!vitestResolves(root)) {
    return unchanged(`only Vitest is supported, and vitest does not resolve from ${root}`);
  }
  const policy = readPolicy(root);
  const recording = startRecording({
    paths: new WorktreePaths(root),
    env,
    observe: policy.observe.runtimeInputs,
    allowlist: policy.env.allowlist,
    squealVersion: squealVersion(),
    objectFormat: await readObjectFormat(root),
    coverage: recordingCoverage(deps),
    ...(deps.tempDir === undefined ? {} : { tempDir: deps.tempDir }),
  });
  if (typeof recording === "string") return unchanged(recording);
  try {
    const exit = exitOf(await runCommand(args.command, cwd, recording.env), say);
    try {
      const { runs, notes, evidence } = recording.finish();
      for (const note of notes) say(note);
      if (runs.length > 0) {
        const out = resolve(cwd, args.out ?? DEFAULT_PARTS_DIR);
        say(await writeParts(runs, out, root, env, io, evidence));
      }
    } catch (error) {
      say(`no part written: ${error instanceof Error ? (error.stack ?? error.message) : error}`);
    }
    return exit;
  } finally {
    recording.close();
  }
}

/** Spec 020 D13: the provider and the records' worker beside this Squeal, or which is missing. */
function recordingCoverage(deps: CiDeps): RecordingCoverage {
  const provider = coverageProvider();
  if (provider === null) return { missing: "this Squeal has no coverage/provider.mjs" };
  const script = mapWorkerScript();
  const worker = deps.mapWorker ?? (script === null ? null : { script });
  if (worker === null)
    return { missing: "this Squeal has no records' worker (cli/coverage-map.mjs)" };
  return { provider, worker };
}

function exitOf(result: number | NotStarted, say: (text: string) => void): number {
  if (typeof result === "number") return result;
  say(result.failed);
  return result.code;
}

async function writeParts(
  runs: readonly RecordedRun[],
  out: AbsolutePath,
  root: AbsolutePath,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  evidence: InputEvidence,
): Promise<string> {
  const head = await readHead(root);
  const base = {
    squealVersion: squealVersion(),
    keyFormat: KEY_FORMAT_VERSION,
    runner: "vitest" as const,
    commit: head.head,
    dirty: head.dirty,
    createdAt: (io.now ?? Date.now)(),
    source: sourceOf(env),
  };
  let files = 0;
  for (const { projects, testFiles, end, runnerVersion, shard, observing, ...run } of runs) {
    const { coverage, records } = run;
    const header: PartHeader = {
      ...base,
      runnerVersion,
      shard,
      end,
      observing,
      ...(coverage === undefined ? {} : { coverage }),
    };
    const part: Part = { format: PART_FORMAT, header, projects, testFiles, evidence };
    writePart(out, records === undefined ? part : { ...part, coverage: records });
    files += testFiles.length;
  }
  const ended = runs.filter((run) => run.end !== "completed").map((run) => run.end);
  const untrusted = ended.length === 0 ? "" : ` (no test file from a run that ${ended.join(", ")})`;
  const parts = `${runs.length} part${runs.length === 1 ? "" : "s"}`;
  const wrote = `wrote ${parts} with ${files} test file${files === 1 ? "" : "s"} to ${out}${untrusted}`;
  return [wrote, ...runs.flatMap(coverageLine)].join("\nsqueal ci record: ");
}

/**
 * Spec 020 D13: one line per run on its coverage records: how many files
 * have one, or why the provider was not in the run, and an error that cost
 * records.
 */
function coverageLine({ coverage, testFiles }: RecordedRun): string[] {
  if (coverage === undefined) return [];
  if ("off" in coverage) {
    const what = coverage.off === "failed" ? "failed" : "was not added";
    return [`no coverage records: Squeal's provider ${what}: ${coverage.note}`];
  }
  const recorded = testFiles.filter((file) => file.record !== undefined).length;
  const lost = coverage.note === undefined ? "" : `; ${coverage.note}`;
  return [`coverage records for ${recorded} of ${testFiles.length} test files${lost}`];
}
