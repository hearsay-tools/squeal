import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, writeSync } from "node:fs";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import type { CliIo } from "./main.js";

/*
 * Spec 020 D14.4 (row 020-15b, #182): with `--json`, stdout holds the
 * report and nothing else. Collection runs Vitest's global setups in the
 * gate's own process, and a process they start with `stdio: "inherit"`
 * writes to that process's stdout directly. So the CLI process runs the
 * gate again in a child whose stdout is the parent's stderr, and takes the
 * report back on a pipe at fd 3, as one frame: its byte length, a line
 * feed, the report. The child is marked, and a marked process never runs
 * the gate again in a child.
 */

/** The mark of the gate's child: the descriptor its report goes to. */
export const REPORT_FD_VARIABLE = "SQUEAL_CODE_GATE_REPORT_FD";

/**
 * Spec 023 D6 (row 023-04): the pid of the CLI process that started the
 * gate's child. The child ends, with every process of its group, once its
 * parent is gone, so a SIGKILL'd parent leaves nothing writing to the store
 * (`temp-checkout.md` 4: an orphaned child wrote 4 files after the kill).
 */
export const PARENT_PID_VARIABLE = "SQUEAL_CODE_GATE_PARENT";

/** How often the child looks for its parent; the check is one field read. */
const PARENT_POLL_MS = 250;

const REPORT_FD = 3;

/** How long the parent waits, after the child exits, for the pipe to end: a process the child started may hold it. */
const DRAIN_MS = 2000;

/** Where the signals the parent forwards to its child come from; `process`, or a test's emitter. */
export interface SignalSource {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

const FORWARDED: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

/**
 * Whether this process is the gate's child: the mark is taken out of `env`
 * at once, so no process the gate starts sees it. The descriptor, `null`
 * when the mark names none; `undefined` when this process is not marked.
 */
export function takeReportFd(env: NodeJS.ProcessEnv = process.env): number | null | undefined {
  const value = env[REPORT_FD_VARIABLE];
  if (value === undefined) return undefined;
  delete env[REPORT_FD_VARIABLE];
  const fd = Number(value);
  return Number.isInteger(fd) && fd > 2 ? fd : null;
}

/**
 * The parent pid the gate's child was given, taken out of `env` at once as
 * the mark is; `undefined` when none or not a pid.
 */
export function takeParentPid(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const value = env[PARENT_PID_VARIABLE];
  if (value === undefined) return undefined;
  delete env[PARENT_PID_VARIABLE];
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** What `watchParent` reads and does; a test gives its own. */
export interface ParentWatch {
  /** This process's parent pid now. Default `process.ppid`. */
  readonly ppid?: () => number;
  /** Called once the parent is gone. Default `endGroup`. */
  readonly gone?: () => void;
  readonly intervalMs?: number;
}

/**
 * Row 023-04 (spec 023 D6): calls `gone` once this process's parent is no
 * longer `parent`, at once when it already is not, then every
 * `intervalMs`. A dead parent's children go to another process, so the
 * parent pid changes; this reads it on Linux and macOS alike. The timer
 * keeps no process alive. Returns the function that stops the watch.
 */
export function watchParent(parent: number, watch: ParentWatch = {}): () => void {
  const ppid = watch.ppid ?? (() => process.ppid);
  const gone = watch.gone ?? endGroup;
  let ended = false;
  const look = () => {
    if (ended || ppid() === parent) return;
    ended = true;
    clearInterval(timer);
    gone();
  };
  const timer = setInterval(look, watch.intervalMs ?? PARENT_POLL_MS);
  timer.unref();
  look();
  return () => {
    ended = true;
    clearInterval(timer);
  };
}

/**
 * Ends this process's group with SIGKILL: the gate's child leads its own
 * (`relaunchGate` starts it detached), so its runners' workers end with
 * it. When it leads none, only this process ends.
 */
export function endGroup(): void {
  try {
    process.kill(-process.pid, "SIGKILL");
  } catch {
    process.kill(process.pid, "SIGKILL");
  }
}

/** In the child: `report` to `fd` as one frame, whole, then the descriptor closed. */
export function sendReport(fd: number, report: string): void {
  const body = Buffer.from(report, "utf8");
  const frame = Buffer.concat([Buffer.from(`${body.length}\n`, "utf8"), body]);
  for (let at = 0; at < frame.length; ) at += writeSync(fd, frame, at);
  closeSync(fd);
}

/** The report a whole frame holds; `null` when the bytes are not one whole frame. */
export function unframe(bytes: Buffer): string | null {
  if (frameSize(bytes) !== bytes.length) return null;
  return bytes.subarray(bytes.indexOf(0x0a) + 1).toString("utf8");
}

/** The byte length of the frame whose head `bytes` start with; `null` before a whole head. */
function frameSize(bytes: Buffer): number | null {
  const end = bytes.indexOf(0x0a);
  if (end < 0) return null;
  const head = bytes.subarray(0, end).toString("utf8");
  return /^\d+$/.test(head) ? end + 1 + Number(head) : null;
}

interface Ended {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

function ended(child: ChildProcess): Promise<Ended> {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, signal: null, error }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

/**
 * Every byte `pipe` gives until it holds one whole frame or ends, or
 * `DRAIN_MS` after `exited` when something else holds it. A whole frame
 * ends the read at once (D17.5): the child keeps its files after it.
 */
async function readAll(pipe: Readable, exited: Promise<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let read = 0;
  let size: number | null = null;
  const end = new Promise<void>((resolve) => {
    pipe.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      read += chunk.length;
      size ??= frameSize(Buffer.concat(chunks));
      if (size !== null && read >= size) resolve();
    });
    pipe.once("end", resolve);
    pipe.once("close", resolve);
    pipe.once("error", () => resolve());
  });
  const cut = new AbortController();
  const drained = exited.then(() => delay(DRAIN_MS, undefined, { signal: cut.signal }));
  await Promise.race([end, drained.catch(() => {})]);
  cut.abort();
  pipe.destroy();
  return Buffer.concat(chunks);
}

const how = (e: Ended) => (e.signal === null ? `with exit code ${e.code}` : `on ${e.signal}`);

/**
 * In the CLI process: `squeal code <args>` run again by `relaunch` in a
 * child whose stdout is this process's stderr and whose stdin is this
 * process's, its report taken from fd 3 and written to `io.stdout` as soon
 * as it is whole, before the child keeps its files (D17.5). The child's
 * exit code; 3 when it ends without one whole report, which then writes
 * nothing to stdout, and 3 when it ends on a signal, also after a whole
 * report (D1's codes; review 0.1.444 B1); 2 when it cannot start. SIGINT
 * and SIGTERM from `signals` go on to the child, which leads its own
 * process group, so a terminal's signal reaches it only through this one.
 * The child ends its group once this process is gone (spec 023 D6).
 */
export async function relaunchGate(
  relaunch: readonly string[],
  args: readonly string[],
  io: CliIo,
  signals: SignalSource = process,
): Promise<number> {
  const [command = process.execPath, ...flags] = relaunch;
  const marks = {
    [REPORT_FD_VARIABLE]: String(REPORT_FD),
    [PARENT_PID_VARIABLE]: String(process.pid),
  };
  // Row 023-04 (spec 023 D6): the child leads a process group of its own, which it ends when this process is gone.
  const child = spawn(command, [...flags, "code", ...args], {
    cwd: io.cwd ?? process.cwd(),
    env: { ...(io.env ?? process.env), ...marks },
    stdio: ["inherit", 2, "inherit", "pipe"],
    detached: true,
  });
  const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
  const listeners = FORWARDED.map((signal) => [signal, forward(signal)] as const);
  for (const [signal, listener] of listeners) signals.on(signal, listener);
  try {
    const exited = ended(child);
    const pipe = child.stdio[REPORT_FD] as Readable | null;
    const bytes = pipe === null ? Buffer.alloc(0) : await readAll(pipe, exited);
    const report = unframe(bytes);
    if (report !== null) io.stdout(report);
    const end = await exited;
    if (end.error !== undefined) {
      io.stderr(`squeal code: could not start the gate's process: ${end.error.message}\n`);
      return 2;
    }
    if (report === null) {
      io.stderr(
        `squeal code: the gate's process ended ${how(end)} without a whole report, so stdout stays empty\n`,
      );
      return 3;
    }
    if (end.code !== null) return end.code;
    io.stderr(
      `squeal code: the gate's process ended ${how(end)} after its report, so the exit code is 3\n`,
    );
    return 3;
  } finally {
    for (const [signal, listener] of listeners) signals.off(signal, listener);
  }
}

/**
 * In the gate's child: `run` with its stdout kept, then sent to `fd` as the
 * report. A run that throws sends nothing, so the parent says so.
 */
export async function runAsChild(
  fd: number,
  run: (stdout: (text: string) => void) => Promise<number>,
): Promise<number> {
  let report = "";
  const code = await run((text) => {
    report += text;
  });
  sendReport(fd, report);
  return code;
}
