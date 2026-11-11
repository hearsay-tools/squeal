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

/** In the child: `report` to `fd` as one frame, whole, then the descriptor closed. */
export function sendReport(fd: number, report: string): void {
  const body = Buffer.from(report, "utf8");
  const frame = Buffer.concat([Buffer.from(`${body.length}\n`, "utf8"), body]);
  for (let at = 0; at < frame.length; ) at += writeSync(fd, frame, at);
  closeSync(fd);
}

/** The report a whole frame holds; `null` when the bytes are not one whole frame. */
export function unframe(bytes: Buffer): string | null {
  const end = bytes.indexOf(0x0a);
  if (end < 0) return null;
  const head = bytes.subarray(0, end).toString("utf8");
  if (!/^\d+$/.test(head)) return null;
  const body = bytes.subarray(end + 1);
  return body.length === Number(head) ? body.toString("utf8") : null;
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

/** Every byte `pipe` gives until it ends, or `DRAIN_MS` after `exited` when something else holds it. */
async function readAll(pipe: Readable, exited: Promise<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  pipe.on("data", (chunk: Buffer) => chunks.push(chunk));
  const end = new Promise<void>((resolve) => {
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
 * process's, its report taken from fd 3 and written to `io.stdout`. The
 * child's exit code; 3 when it ends without one whole report, which then
 * writes nothing to stdout; 2 when it cannot start. SIGINT and SIGTERM from
 * `signals` go on to the child.
 */
export async function relaunchGate(
  relaunch: readonly string[],
  args: readonly string[],
  io: CliIo,
  signals: SignalSource = process,
): Promise<number> {
  const [command = process.execPath, ...flags] = relaunch;
  const child = spawn(command, [...flags, "code", ...args], {
    cwd: io.cwd ?? process.cwd(),
    env: { ...(io.env ?? process.env), [REPORT_FD_VARIABLE]: String(REPORT_FD) },
    stdio: ["inherit", 2, "inherit", "pipe"],
  });
  const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
  const listeners = FORWARDED.map((signal) => [signal, forward(signal)] as const);
  for (const [signal, listener] of listeners) signals.on(signal, listener);
  try {
    const exited = ended(child);
    const pipe = child.stdio[REPORT_FD] as Readable | null;
    const bytes = pipe === null ? Buffer.alloc(0) : await readAll(pipe, exited);
    const end = await exited;
    if (end.error !== undefined) {
      io.stderr(`squeal code: could not start the gate's process: ${end.error.message}\n`);
      return 2;
    }
    const report = unframe(bytes);
    if (report === null || end.code === null) {
      io.stderr(
        `squeal code: the gate's process ended ${how(end)} without a whole report, so stdout stays empty\n`,
      );
      return 3;
    }
    io.stdout(report);
    return end.code;
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
