import { resolve } from "node:path";
import { type NotStarted, runCommand } from "../core/ci/command.js";
import { PART_FORMAT, type PartHeader, writePart } from "../core/ci/parts.js";
import { readPolicy } from "../core/daemon/policy.js";
import { squealVersion } from "../core/daemon/version.js";
import { readHead } from "../core/daemon-loop/head.js";
import { findWorktreeRoot } from "../core/fs/git-layout.js";
import { WorktreePaths } from "../core/fs/worktree-paths.js";
import { KEY_FORMAT_VERSION } from "../core/keys/key-format.js";
import type { AbsolutePath } from "../core/types/common.js";
import { type RecordedRun, startRecording, vitestResolves } from "../runners/vitest/ci-record.js";
import { sourceOf } from "./export.js";
import type { CliIo } from "./main.js";

const USAGE = "usage: squeal ci record [--out <dir>] -- <command> [args...]\n";

/** The directory `--out` defaults to, in the working directory. */
export const DEFAULT_PARTS_DIR = "squeal-parts";

export interface CiDeps {
  /** Where the private directory goes; default the OS temp directory. */
  readonly tempDir?: AbsolutePath;
}

/**
 * `squeal ci <subcommand>`, spec 018's CI side. `record` (D8): runs the
 * project's test command unchanged and exits with its code; for a Vitest
 * command, also writes one part per Vitest process into `--out` (default
 * `squeal-parts/`). Exit 2 on a usage error; otherwise the command's code,
 * whatever Squeal could record, since nothing in CI gates on Squeal (D16).
 */
export async function ciCommand(
  args: readonly string[],
  io: CliIo,
  deps: CiDeps = {},
): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== "record") {
    io.stderr(`squeal ci: ${sub === undefined ? "no subcommand" : `unknown "${sub}"`}\n${USAGE}`);
    return 2;
  }
  const parsed = parseRecord(rest);
  if ("error" in parsed) {
    io.stderr(`squeal ci record: ${parsed.error}\n${USAGE}`);
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
    ...(deps.tempDir === undefined ? {} : { tempDir: deps.tempDir }),
  });
  if (typeof recording === "string") return unchanged(recording);
  try {
    const exit = exitOf(await runCommand(args.command, cwd, recording.env), say);
    try {
      const { runs, notes } = recording.finish();
      for (const note of notes) say(note);
      if (runs.length > 0) {
        const out = resolve(cwd, args.out ?? DEFAULT_PARTS_DIR);
        say(await writeParts(runs, out, root, env, io));
      }
    } catch (error) {
      say(`no part written: ${error instanceof Error ? (error.stack ?? error.message) : error}`);
    }
    return exit;
  } finally {
    recording.close();
  }
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
  for (const { projects, testFiles, end, runnerVersion, observing } of runs) {
    const header: PartHeader = { ...base, runnerVersion, end, observing };
    writePart(out, { format: PART_FORMAT, header, projects, testFiles });
    files += testFiles.length;
  }
  const ended = runs.filter((run) => run.end !== "completed").map((run) => run.end);
  const untrusted = ended.length === 0 ? "" : ` (no test file from a run that ${ended.join(", ")})`;
  const parts = `${runs.length} part${runs.length === 1 ? "" : "s"}`;
  return `wrote ${parts} with ${files} test file${files === 1 ? "" : "s"} to ${out}${untrusted}`;
}
