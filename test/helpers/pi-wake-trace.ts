import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

/*
 * Row 009-30: the Pi idle wake is lost about once in 300 CI runs, and a timeout said only
 * "never armed". `awaitArmed` waits for the wake as the tests did and, at its deadline, throws
 * what it saw: the lock and consumer history, the Pi process (which owns the waiter, its
 * delivery worker thread), the worker's starts, requests, answers and exit, Pi's RPC events
 * and stderr tail, each at its time. Pi's side comes from `pi-trace-preload.mjs`, which only
 * records; without it the message says so and gives what /proc shows. The message goes to CI
 * logs, so `safeText` writes each home directory as `~` and redacts secret-shaped text.
 */

const PRELOAD = resolve(import.meta.dirname, "pi-trace-preload.mjs");
const STDERR_TAIL = 2_000;
const STEPS_SHOWN = 60;
/** RPC events of a model response's stream: many per run, and no step of the arm. */
const STREAM_EVENTS = new Set([
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_update",
]);

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
      said = `consumers [${sight.consumers.join(", ")}], lock ${sight.lock}`;
    } catch (error) {
      said = `probe threw: ${safeText(String(error))}`;
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
  const at = (t: number) => `${t >= start ? "+" : ""}${t - start} ms`;
  const lines = [
    `${wait.headline}: the session's waiter lock was not held within ${wait.boundMs} ms`,
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
    return safeText(lines.join("\n"));
  }
  if (all.length === 0) lines.push("Pi trace: empty, so the preload never ran in Pi.");
  for (const other of all.filter((l) => l.kind === "start" && l.thread === 0 && l.pid !== run)) {
    const exit = all.find((l) => l.kind === "exit" && l.pid === other.pid);
    lines.push(
      `Not Pi's run, left out: pid ${other.pid} (first argument ${JSON.stringify(other.arg)}), started at ${at(other.t)}, ${exit === undefined ? "no exit recorded" : `exited with code ${String(exit.code)} at ${at(exit.t)}`}.`,
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
  // Joined before redaction, so a secret split across two writes is still one match.
  const stderr = safeText(
    trace
      .filter((l) => l.kind === "stderr")
      .map((l) => String(l.text))
      .join(""),
  );
  lines.push(
    stderr === ""
      ? "Pi stderr: empty."
      : `Pi stderr (last ${STDERR_TAIL} characters, home as ~, secrets redacted):\n${indent(stderr.slice(-STDERR_TAIL))}`,
  );
  return safeText(lines.join("\n"));
}

/** Pi's package commands, which run no agent: `runPi` runs `pi install` before Pi. */
const PI_COMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config"]);

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
function waiterLife(trace: TraceLine[], at: (t: number) => string): string[] {
  const workers = trace.filter((l) => l.kind === "worker-start");
  const lines = [
    workers.length === 0
      ? "Waiter (delivery worker thread): never started."
      : `Waiter (delivery worker thread): started ${workers.length} time(s), ${workers
          .map((w) => `thread ${w.thread} at ${at(w.t)}`)
          .join("; ")}.`,
  ];
  for (const worker of workers) {
    const own = trace.find((l) => l.kind === "worker-exit" && l.thread === worker.thread);
    const host = trace.find((l) => l.kind === "worker-ended" && l.worker === worker.thread);
    const error = trace.find((l) => l.kind === "worker-error" && l.worker === worker.thread);
    const ends = [
      ...(own === undefined
        ? []
        : [`its exit listener ran, code ${String(own.code)}, at ${at(own.t)}`]),
      ...(error === undefined
        ? []
        : [`Pi saw an error event, ${String(error.error)}, at ${at(error.t)}`]),
      ...(host === undefined
        ? []
        : [`Pi saw it exit with code ${String(host.code)} at ${at(host.t)}`]),
    ];
    lines.push(
      `  thread ${worker.thread}: ${ends.length === 0 ? "no exit recorded (still running, or its process ended)" : ends.join("; ")}`,
    );
  }
  return lines;
}

/** Secret-shaped text: a key that names a secret and its value, a bearer token, known prefixes. */
const SECRETS: readonly [RegExp, string][] = [
  [
    /\b([\w.-]*(?:token|secret|passw(?:or)?d|api[_-]?key|auth(?:orization)?|credential|cookie|private[_-]?key)[\w.-]*)(["']?\s*[:=]\s*["']?)(?:(?:bearer|basic|token)\s+)?[^\s"',;&]+/gi,
    "$1$2[redacted]",
  ],
  [/\b(bearer|basic)\s+[\w.~+/=-]+/gi, "$1 [redacted]"],
  [/\b(?:sk|pk|rk)-[\w-]{8,}/g, "[redacted]"],
  [/\b(?:gh[pousr]_|github_pat_|glpat-|xox[abposr]-|AKIA|ASIA)[\w-]{8,}/g, "[redacted]"],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted]"],
  // A long run of letters and digits, as a key is; a path's slashes break it.
  [/(?=[\w+=-]*\d)(?=[\w+=-]*[A-Za-z])[\w+=-]{40,}/g, "[redacted]"],
  [/:\/\/[^\s/:@]+:[^\s/@]+@/g, "://[redacted]@"],
];

/** `text` with each home directory as `~` and secret-shaped text redacted, for a CI log. */
export function safeText(text: string): string {
  let safe = text;
  const home = safely(() => homedir(), "");
  for (const dir of new Set([home, process.env.HOME ?? ""])) {
    if (dir.length > 1) safe = safe.split(dir).join("~");
  }
  safe = safe.replace(/(?:\/home|\/Users|\/var\/home)\/[^/\s"'`:]+|\/root(?=\/|\s|$)/g, "~");
  for (const [pattern, replacement] of SECRETS) safe = safe.replace(pattern, replacement);
  return safe;
}

/** The arm's own steps: each run's settle, and each wait the waiter received and its answer. */
function armSummary(trace: TraceLine[], at: (t: number) => string): string[] {
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
      `  wait ${String(wait.id)} on thread ${wait.thread} at ${at(wait.t)}: ${
        answer === undefined
          ? "no answer"
          : `answered ok=${String(answer.ok)} answer=${String(answer.answer)} at ${at(answer.t)}`
      }${cancel === undefined ? "" : `; cancelled at ${at(cancel.t)}`}`,
    );
  }
  return lines;
}

function stepText(step: TraceLine): string {
  const { t: _t, pid: _pid, thread, kind, ...rest } = step;
  const who = thread === 0 ? "pi" : `thread ${thread}`;
  const details = Object.entries(rest)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  return `${who} ${kind}${details === "" ? "" : ` ${details}`}`;
}

/** Whether `pid` lives, its /proc state, and the exit code its trace recorded. */
function processState(pid: number | undefined, trace: TraceLine[] | undefined): string {
  if (pid === undefined) return "not found (no trace start and no Pi process in /proc).";
  const exit = trace?.find((l) => l.kind === "exit" && l.pid === pid);
  const state = safely(() => readFileSync(`/proc/${pid}/stat`, "utf8"), null);
  const live =
    state === null
      ? "not running"
      : `alive, /proc state ${state.slice(state.lastIndexOf(")") + 2).split(" ")[0]}`;
  const ended =
    exit !== undefined
      ? `exited with code ${String(exit.code)}`
      : state === null
        ? "no exit recorded, so its exit code or signal is unknown"
        : "no exit recorded (still running)";
  return `pid ${pid}, ${live}; ${ended}.`;
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

function safely<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

const indent = (text: string) =>
  text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
