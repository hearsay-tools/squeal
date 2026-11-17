import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

/*
 * Row 009-30: the Pi idle wake is lost about once in 300 CI runs, and a timeout said only
 * "never armed". `awaitArmed` waits for the wake as the tests did and, at its deadline, throws
 * what it saw: the lock and consumer history, the Pi process (which owns the waiter, its
 * delivery worker thread), the worker's starts, requests, answers and exit, Pi's RPC events
 * and stderr writes, each at its time. Pi's side comes from `pi-trace-preload.mjs`, which only
 * records; without it the message says so and gives what /proc shows.
 *
 * The message goes to CI logs, so it prints fixed facts only (human, 2026-11-17): pids, counts,
 * exit codes, booleans, times, byte counts, and names from the closed sets below. A string
 * that Pi, a worker, an error or the environment wrote is never printed: a name outside its
 * set prints as "other", and stderr prints as its sizes and times.
 */

const PRELOAD = resolve(import.meta.dirname, "pi-trace-preload.mjs");
const STEPS_SHOWN = 60;
/** A closed set from a space-separated list. */
const names = (...lists: string[]): ReadonlySet<string> => new Set(lists.join(" ").split(" "));
/** RPC events of a model response's stream: many per run, and no step of the arm. */
const STREAM_EVENTS = names("message_start message_update message_end tool_execution_update");
/** Pi's RPC event types (`pi-coding-agent`, `modes/rpc/rpc-types.d.ts`, agent events). */
export const EVENT_TYPES = names(
  [...STREAM_EVENTS].join(" "),
  "agent_start agent_end agent_settled turn_start turn_end response queue_update",
  "tool_execution_start tool_execution_end extension_ui_request extension_error",
  "compaction_start compaction_end auto_retry_start auto_retry_end entry_appended",
  "session_info_changed thinking_level_changed",
);
/** The RPC commands a `response` event can name, of those the Squeal tests send. */
export const COMMANDS = names(
  "prompt steer follow_up abort get_state get_messages new_session set_model compact bash",
  "get_session_stats extension_ui_response",
);
/** The waiter's request kinds (`src/harness/pi/protocol.ts`), and the preload's "cancel". */
export const REQUESTS = names(
  "start shutdown boundary run toolCall settle endTurn wait ping cancel",
);
/** Error codes a probe of the store or the lock can throw. */
export const ERROR_CODES = names(
  "ENOENT EACCES EPERM EBUSY EAGAIN EEXIST EISDIR ENOTDIR ELOOP EMFILE ENFILE EIO ENOSPC",
  "EROFS ETIMEDOUT ERR_SQLITE_ERROR",
);
/** JavaScript's own error names, for a worker's error event. */
export const ERROR_NAMES = names(
  "Error TypeError RangeError ReferenceError SyntaxError EvalError URIError AggregateError",
  "AbortError DOMException",
);
/** The shapes the preload records for a worker's answer. */
const ANSWER_SHAPES = names("null text object boolean number undefined");
/** The lock states (`waiterLockState`); any other text from a probe prints as "not read". */
const LOCK_STATES = names("held free absent");
/** Pi's package commands, which run no agent: `runPi` runs `pi install` before Pi. */
const PI_COMMANDS = names("install remove uninstall update list config");

/** One record of the preload (`pi-trace-preload.mjs`). */
export interface TraceLine {
  t: number;
  pid: number;
  thread: number;
  kind: string;
  [key: string]: unknown;
}

/** A trace file for one Pi run, and the environment that loads the preload into it. */
export interface WakeTrace {
  /** For Pi's environment: the preload, its file, and `withContext` throws on stderr. */
  readonly env: Record<string, string>;
  readonly file: string;
  read(): TraceLine[];
  cleanup(): void;
}

export function wakeTrace(): WakeTrace {
  const dir = mkdtempSync(join(tmpdir(), "squeal-pi-trace-"));
  const file = join(dir, "trace.jsonl");
  return {
    env: {
      NODE_OPTIONS: `--import=${pathToFileURL(PRELOAD).href}`,
      SQUEAL_PI_TRACE: file,
      SQUEAL_DEBUG_CONTEXT: "1",
    },
    file,
    read: () => readTrace(file),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function readTrace(file: string): TraceLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => {
      try {
        return line === "" ? [] : [JSON.parse(line) as TraceLine];
      } catch {
        return [];
      }
    });
}

/** What one poll saw: the registered consumers, and the session's waiter lock. */
export interface ArmSight {
  readonly consumers: readonly string[];
  /** The lock state (`held` is armed), or why none was read, such as "no consumer". */
  readonly lock: string;
}

export interface ArmWait {
  /** The message's first line, as the tests and the board name the failure. */
  readonly headline: string;
  readonly boundMs: number;
  readonly pollMs: number;
  readonly probe: () => ArmSight;
  /** Pi's trace, when the run loaded the preload. */
  readonly trace?: WakeTrace | undefined;
  /** Pi's working directory, to find its process in /proc when the trace has none. */
  readonly piCwd: string;
}

/** Until the probe sees the lock `held`; at the deadline, throws everything seen. */
export async function awaitArmed(wait: ArmWait): Promise<void> {
  const start = Date.now();
  const seen: { t: number; sight: string }[] = [];
  let last = "";
  for (;;) {
    let sight: ArmSight | null = null;
    let said: string;
    try {
      sight = wait.probe();
      const lock = oneOf(LOCK_STATES, sight.lock, "not read");
      said = `${count(sight.consumers.length)} consumer(s), lock ${lock}`;
    } catch (error) {
      said = `probe threw, code ${errorCode(error)}`;
    }
    if (said !== last) seen.push({ t: Date.now(), sight: said });
    last = said;
    if (sight?.lock === "held") return;
    if (Date.now() - start > wait.boundMs) throw new Error(describeTimeout(wait, start, seen));
    await sleep(wait.pollMs);
  }
}

/** The timeout's message: every fact a reader needs to name the step that lost the wake. */
export function describeTimeout(
  wait: ArmWait,
  start: number,
  seen: readonly { t: number; sight: string }[],
): string {
  const at = (t: unknown) =>
    typeof t === "number" ? `${t >= start ? "+" : ""}${t - start} ms` : "at an unknown time";
  const lines = [
    `${wait.headline}: the session's waiter lock was not held within ${count(wait.boundMs)} ms`,
    `Times are from the wait's start, ${new Date(start).toISOString()}.`,
    "Lock and consumers, at each change:",
    ...seen.map((s) => `  ${at(s.t)}  ${s.sight}`),
  ];
  const all = safely(() => wait.trace?.read(), undefined);
  const run = all === undefined ? undefined : piRun(all);
  const pid = run ?? findPi(wait.piCwd);
  lines.push(`Pi process (it runs the waiter thread): ${processState(pid, all)}`);
  if (all === undefined) {
    lines.push("No Pi trace: this run did not load pi-trace-preload.mjs.");
    return lines.join("\n");
  }
  if (all.length === 0) lines.push("Pi trace: empty, so the preload never ran in Pi.");
  for (const other of all.filter((l) => l.kind === "start" && l.thread === 0 && l.pid !== run)) {
    const exit = all.find((l) => l.kind === "exit" && l.pid === other.pid);
    lines.push(
      `Not Pi's run, left out: pid ${count(other.pid)} (first argument ${oneOf(PI_COMMANDS, other.arg)}), started at ${at(other.t)}, ${exit === undefined ? "no exit recorded" : `exited with code ${count(exit.code)} at ${at(exit.t)}`}.`,
    );
  }
  const trace = all.filter((l) => l.pid === run);
  lines.push(...waiterLife(trace, at));
  lines.push(...armSummary(trace, at));
  const steps = trace.filter(
    (l) =>
      l.kind !== "stderr" &&
      l.kind !== "start" &&
      !(l.kind === "event" && STREAM_EVENTS.has(String(l.type))),
  );
  const shown = steps.length > STEPS_SHOWN ? `last ${STEPS_SHOWN} of ${steps.length}` : "all";
  lines.push(`Steps of Pi and its waiter, without message streaming (${shown}):`);
  for (const step of steps.slice(-STEPS_SHOWN)) lines.push(`  ${at(step.t)}  ${stepText(step)}`);
  const writes = trace.filter((l) => l.kind === "stderr");
  const bytes = writes.reduce(
    (sum, l) => sum + (Number.isInteger(l.bytes) ? Number(l.bytes) : 0),
    0,
  );
  lines.push(
    writes.length === 0
      ? "Pi stderr: nothing written."
      : `Pi stderr: wrote ${bytes} bytes in ${writes.length} writes, first at ${at(writes[0]?.t)}, last at ${at(writes.at(-1)?.t)}.`,
  );
  return lines.join("\n");
}

/**
 * The pid of Pi's run in a trace. `runPi` starts `pi install <package>` with the same
 * environment first, so a start whose first argument is a package command is not the run; of
 * the rest, the last.
 */
export function piRun(trace: readonly TraceLine[]): number | undefined {
  const starts = trace.filter((l) => l.kind === "start" && l.thread === 0);
  return starts.filter((l) => !PI_COMMANDS.has(String(l.arg))).at(-1)?.pid;
}

/** Each worker thread's start and end, as the worker and as Pi's main thread saw them. */
function waiterLife(trace: TraceLine[], at: (t: unknown) => string): string[] {
  const workers = trace.filter((l) => l.kind === "worker-start");
  const lines = [
    workers.length === 0
      ? "Waiter (delivery worker thread): never started."
      : `Waiter (delivery worker thread): started ${workers.length} time(s), ${workers
          .map((w) => `thread ${count(w.thread)} at ${at(w.t)}`)
          .join("; ")}.`,
  ];
  for (const worker of workers) {
    const own = trace.find((l) => l.kind === "worker-exit" && l.thread === worker.thread);
    const host = trace.find((l) => l.kind === "worker-ended" && l.worker === worker.thread);
    const error = trace.find((l) => l.kind === "worker-error" && l.worker === worker.thread);
    const ends = [
      ...(own === undefined
        ? []
        : [`its exit listener ran, code ${count(own.code)}, at ${at(own.t)}`]),
      ...(error === undefined
        ? []
        : [`Pi saw an error event, ${oneOf(ERROR_NAMES, error.error)}, at ${at(error.t)}`]),
      ...(host === undefined
        ? []
        : [`Pi saw it exit with code ${count(host.code)} at ${at(host.t)}`]),
    ];
    lines.push(
      `  thread ${count(worker.thread)}: ${ends.length === 0 ? "no exit recorded (still running, or its process ended)" : ends.join("; ")}`,
    );
  }
  return lines;
}

/** The arm's own steps: each run's settle, and each wait the waiter received and its answer. */
function armSummary(trace: TraceLine[], at: (t: unknown) => string): string[] {
  const settles = trace.filter((l) => l.kind === "event" && l.type === "agent_settled");
  const waits = trace.filter((l) => l.kind === "worker-in" && l.request === "wait");
  const lines = [
    `Arm: ${settles.length} agent_settled event(s)${settles.length === 0 ? "" : `, at ${settles.map((s) => at(s.t)).join(", ")}`}; ${waits.length} wait request(s) reached the waiter.`,
  ];
  for (const wait of waits) {
    const answer = trace.find(
      (l) => l.kind === "worker-out" && l.thread === wait.thread && l.id === wait.id,
    );
    const cancel = trace.find(
      (l) =>
        l.kind === "worker-in" &&
        l.thread === wait.thread &&
        l.id === wait.id &&
        l.request === "cancel",
    );
    lines.push(
      `  wait ${count(wait.id)} on thread ${count(wait.thread)} at ${at(wait.t)}: ${
        answer === undefined
          ? "no answer"
          : `answered ok=${flag(answer.ok)} answer=${oneOf(ANSWER_SHAPES, String(answer.answer))} at ${at(answer.t)}`
      }${cancel === undefined ? "" : `; cancelled at ${at(cancel.t)}`}`,
    );
  }
  return lines;
}

/** One step, as its kind's fixed facts. */
function stepText(step: TraceLine): string {
  const who = step.thread === 0 ? "pi" : `thread ${count(step.thread)}`;
  switch (step.kind) {
    case "event":
      return `${who} event ${oneOf(EVENT_TYPES, step.type)}${step.command === undefined ? "" : ` command ${oneOf(COMMANDS, step.command)}`}`;
    case "exit":
    case "worker-exit":
      return `${who} ${step.kind} code ${count(step.code)}`;
    case "worker-start":
      return `${who} worker-start`;
    case "worker-ended":
      return `${who} worker-ended thread ${count(step.worker)} code ${count(step.code)}`;
    case "worker-error":
      return `${who} worker-error thread ${count(step.worker)} ${oneOf(ERROR_NAMES, step.error)}`;
    case "worker-in":
      return `${who} worker-in id ${count(step.id)} request ${oneOf(REQUESTS, step.request)}`;
    case "worker-out":
      return `${who} worker-out id ${count(step.id)} ok ${flag(step.ok)} held ${flag(step.held)} answer ${oneOf(ANSWER_SHAPES, String(step.answer))}`;
    default:
      return `${who} other`;
  }
}

/** Whether `pid` lives, its /proc state, and the exit code its trace recorded. */
function processState(pid: number | undefined, trace: TraceLine[] | undefined): string {
  if (pid === undefined) return "not found (no trace start and no Pi process in /proc).";
  const exit = trace?.find((l) => l.kind === "exit" && l.pid === pid);
  const state = safely(() => readFileSync(`/proc/${pid}/stat`, "utf8"), null);
  const code = state?.slice(state.lastIndexOf(")") + 2).split(" ")[0];
  const live =
    state === null
      ? "not running"
      : `alive, /proc state ${/^[A-Za-z]$/.test(code ?? "") ? code : "other"}`;
  const ended =
    exit !== undefined
      ? `exited with code ${count(exit.code)}`
      : state === null
        ? "no exit recorded, so its exit code or signal is unknown"
        : "no exit recorded (still running)";
  return `pid ${count(pid)}, ${live}; ${ended}.`;
}

/** A Pi process whose working directory is `cwd`, from /proc; Linux only. */
export function findPi(cwd: string): number | undefined {
  const pids = safely(() => readdirSync("/proc").filter((name) => /^\d+$/.test(name)), []);
  return pids
    .map(Number)
    .find(
      (pid) =>
        safely(() => readlinkSync(`/proc/${pid}/cwd`), "") === cwd &&
        safely(() => readFileSync(`/proc/${pid}/cmdline`, "utf8"), "").includes("pi-coding-agent"),
    );
}

/** `value` when it is in `set`, else `other`: no free text reaches the message. */
function oneOf(set: ReadonlySet<string>, value: unknown, other = "other"): string {
  return typeof value === "string" && set.has(value) ? value : other;
}

/** An integer as digits; anything else, which the preload did not write, as "unknown". */
const count = (value: unknown) => (Number.isInteger(value) ? String(value) : "unknown");
const flag = (value: unknown) => (typeof value === "boolean" ? String(value) : "unknown");

/** A thrown value's error code when it is a known one, "none" when it has none. */
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return code === undefined ? "none" : oneOf(ERROR_CODES, code);
}

function safely<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
