import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { type Checkout, stopGroup } from "../core/checkout/checkout.js";
import { recordGroup } from "../core/checkout/marker.js";
import { leaseProcess } from "../core/daemon/lease-process.js";
import type { HostLoad } from "../core/retry/load.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import { type GateFilesResult, runGateFiles } from "./code-gate-files.js";
import { PARENT_PID_VARIABLE, takeParentPid, watchParent } from "./code-gate-parent.js";

/*
 * Spec 023 D4.4, D6 (row 023-07, review wave-7 B1 and B3): `--run` runs
 * 020's gate (`runGateFiles`) in a child of the CLI that leads a process
 * group of its own. Its group is recorded in the checkout's marker, so the
 * checkout's removal and the next sweep stop it, with every process a test
 * started in it; the child ends its group, and its descendants' groups, as
 * soon as the CLI process is gone (`watchParent`, as the gate's `--json`
 * child does). The child starts with the command's environment as it was
 * before any runner set a variable in the CLI process (Vitest sets
 * `NODE_ENV`), so the run and the keys describe one environment.
 */

/** The mark of the run's child: the request file it reads. */
export const RUN_REQUEST_VARIABLE = "SQUEAL_STATUS_AT_RUN_REQUEST";

/** How long past its budget the parent waits for the child before it stops the group. */
const GRACE_SECONDS = 60;

interface RunRequest {
  readonly tree: AbsolutePath;
  readonly files: readonly RelativePath[];
  readonly budgetSeconds: number;
  readonly tempDir: AbsolutePath;
  readonly answer: string;
  /** Whether the gate reads and keeps results in the shared stores (`runGateFiles`' `store`). */
  readonly store: boolean;
  /** Row 023-11: `false` when a failed file must never run again under load (`NO_LOAD_RETRY`). */
  readonly retry?: boolean;
}

/**
 * Row 023-11 (candidate CI of 0.1.562): the host's load as the gate reads
 * it for a run that must count each first result. The gate runs a failed
 * file once more when the one-minute load is over the CPU count, and the
 * rerun's result replaces the failure (row 020-54); with the load unknown
 * it never does. A proof's run is one observation: `--repeat` counts runs,
 * and a green failure that a rerun turned into a pass read `proven`.
 */
export function noLoadRetry(): HostLoad {
  return { oneMinute: null, cpus: availableParallelism() };
}

/** The child's answer: the gate's per-file outcomes, or why it gave none. */
export type RunAnswer = { readonly result: GateFilesResult } | { readonly error: string };

/** The request file this process was given, taken out of `env` at once; `undefined` when none. */
export function takeRunRequest(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[RUN_REQUEST_VARIABLE];
  if (value === undefined) return undefined;
  delete env[RUN_REQUEST_VARIABLE];
  return value;
}

/** In the child: the requested files run, the answer written, exit 0; the parent reads the rest. */
export async function runChild(request: string): Promise<number> {
  const parent = takeParentPid();
  if (parent !== undefined) watchParent(parent);
  const asked = JSON.parse(readFileSync(request, "utf8")) as RunRequest;
  let answer: RunAnswer;
  try {
    const result = await runGateFiles({
      root: asked.tree,
      files: asked.files,
      budgetSeconds: asked.budgetSeconds,
      tempDir: asked.tempDir,
      store: asked.store,
      ...(asked.retry === false ? { hostLoad: noLoadRetry } : {}),
      note: (text) => process.stderr.write(`squeal: ${text}\n`),
      output: () => {},
    });
    answer = { result };
  } catch (error) {
    answer = { error: error instanceof Error ? error.message : String(error) };
  }
  writeFileSync(asked.answer, JSON.stringify(answer));
  return 0;
}

export interface ChildRun {
  /** The command that runs this CLI: `CliIo.relaunch`. */
  readonly relaunch: readonly string[] | undefined;
  readonly checkout: Checkout;
  readonly files: readonly RelativePath[];
  readonly budgetSeconds: number;
  /** Row 023-07: `false` when the install changed the checkout: the gate stores nothing. */
  readonly store: boolean;
  /** Row 023-11: `false` for a proof's run: no failed file runs again under load (`noLoadRetry`). */
  readonly retry?: boolean;
  /** The child's whole environment: the command's, as it started. */
  readonly env: NodeJS.ProcessEnv;
  /** The child's stdout and stderr, as they come. */
  readonly forward: (text: string) => void;
}

/** In the CLI process: the files run in the child, in a group of its own; its answer. */
export async function runInChild(run: ChildRun): Promise<RunAnswer> {
  const [command, ...flags] = run.relaunch ?? [];
  if (command === undefined) return { error: "no command to start the run's process with" };
  const { checkout } = run;
  const request = join(checkout.folder, "at-run-request.json");
  const answer = join(checkout.folder, "at-run-answer.json");
  const asked: RunRequest = {
    tree: checkout.tree,
    files: run.files,
    budgetSeconds: run.budgetSeconds,
    tempDir: checkout.run,
    answer,
    store: run.store,
    ...(run.retry === undefined ? {} : { retry: run.retry }),
  };
  writeFileSync(request, JSON.stringify(asked));
  const child = spawn(command, [...flags, "status", "--at", checkout.commit], {
    cwd: checkout.tree,
    env: {
      ...run.env,
      [RUN_REQUEST_VARIABLE]: request,
      [PARENT_PID_VARIABLE]: String(process.pid),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const exited = new Promise<string>((done) => {
    child.once("error", (error) => done(`could not start: ${error.message}`));
    child.once("exit", (code, signal) => done(signal === null ? `exit ${code}` : `on ${signal}`));
  });
  if (child.pid !== undefined) {
    try {
      recordGroup(checkout.folder, leaseProcess(child.pid));
    } catch {
      // No marker to record in: the checkout's removal cannot stop the group, the child still can.
    }
  }
  for (const pipe of [child.stdout, child.stderr] as (Readable | null)[]) {
    pipe?.on("data", (chunk: Buffer) => run.forward(chunk.toString("utf8")));
  }
  const pid = child.pid;
  const limit = setTimeout(
    () => {
      if (pid !== undefined) void stopGroup(pid).catch(() => {});
    },
    (run.budgetSeconds + GRACE_SECONDS) * 1000,
  );
  const how = await exited;
  clearTimeout(limit);
  if (!existsSync(answer)) return { error: `the run's process ended ${how} with no answer` };
  try {
    return JSON.parse(readFileSync(answer, "utf8")) as RunAnswer;
  } catch {
    return { error: `the run's process ended ${how} with an unreadable answer` };
  }
}
