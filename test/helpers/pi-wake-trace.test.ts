import { type ChildProcess, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "../store/helpers.js";
import {
  type ArmWait,
  awaitArmed,
  COMMANDS,
  ERROR_CODES,
  ERROR_NAMES,
  EVENT_TYPES,
  REQUESTS,
  type TraceLine,
  type WakeTrace,
  wakeTrace,
} from "./pi-wake-trace.js";

/*
 * Row 009-30: a forced timeout names every fact the brief lists. A stand-in for Pi loads the
 * preload as Pi does: it prints an `agent_settled` RPC line and a stderr line, starts a worker
 * thread that dies on its `wait` as the research's single-shot arm case does, and spawns a
 * Node child, which must stay out of the trace. Its first argument `install` makes it a stand-in
 * for `pi install`, which exits; `terminate` ends its worker from Pi's side; `leak` writes home
 * paths, synthetic secrets and arbitrary text to stderr, as an RPC event's type and command, as
 * a worker request, answer and id, and as the name of the worker's error.
 */

/** Synthetic markers only: no real credential or private path is read or written. */
const MARKER = "SYNTHETIC0MARKER0009x30";
/** Every form of secret and path the two reviews used, and arbitrary text. */
const LEAK = [
  `Error: boom\\n    at withContext (${homedir()}/synthetic-repo/dist/extension.mjs:12:3)\n`,
  // Built from parts: a literal home path in a source file fails the private-material check.
  `${["", "home", "someone", "x"].join("/")} ${["", "Users", "someone", "y"].join("/")} ${["", "root", "z"].join("/")} ~/w\n`,
  "api_tok",
  `en=${MARKER}a and Authorization: Bearer ${MARKER}b and Bearer ${MARKER}d\n`,
  `password="${MARKER}e first ${MARKER}f tail" {"api_key":"${MARKER}g,${MARKER}h"}\n`,
  `sk-${MARKER}i ghp_${MARKER}j https://user:${MARKER}k@example.test eyJ${MARKER}.l.m\n`,
  "arbitrary words: the quick brown fox; DEBUG withContext held\n",
];
const TEXT = LEAK.join("");

const WORKER = `
import { parentPort } from "node:worker_threads";
parentPort.on("message", (message) => {
  if (message.request?.kind === "wait") {
    if (!message.leak) process.exit(3);
    const error = new Error(message.leak);
    error.name = message.leak;
    throw error;
  }
  parentPort.postMessage({ id: message.id, ok: true, answer: message.leak ?? null });
});
`;

const pi = (stay: boolean) => `
import { execFileSync } from "node:child_process";
import { Worker } from "node:worker_threads";
const mode = process.argv[2];
const leak = mode === "leak" ? ${JSON.stringify(TEXT)} : undefined;
execFileSync(process.execPath, ["-e", ""]);
process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
if (mode === "install") process.exit(0);
process.stderr.write("DEBUG withContext boom\\n");
if (leak !== undefined) {
  for (const part of ${JSON.stringify(LEAK)}) process.stderr.write(part);
  process.stdout.write(JSON.stringify({ type: leak, command: leak, id: leak }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "response", command: leak, id: 1 }) + "\\n");
}
const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
  execArgv: ["--disable-warning=ExperimentalWarning"],
});
worker.on("error", () => {});
worker.postMessage({ id: 6, request: { kind: "endTurn" } });
if (leak !== undefined) worker.postMessage({ id: leak, request: { kind: leak }, leak });
if (mode === "terminate") worker.once("message", () => void worker.terminate());
else worker.postMessage({ id: 7, request: { kind: "wait" }, leak });
${stay ? "setInterval(() => {}, 1000);" : ""}
`;

const children: ChildProcess[] = [];
const traces: WakeTrace[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const trace of traces.splice(0)) trace.cleanup();
});

interface StandIn {
  readonly trace: WakeTrace;
  readonly dir: string;
  readonly pid: number;
  /** Pids of the earlier `install` stand-ins, in order. */
  readonly installs: number[];
}

/**
 * Starts the stand-in, after `installs` stand-ins for `pi install` in the same trace, and
 * resolves once Pi's main thread has seen its worker end.
 */
async function standIn(stay: boolean, args: string[] = [], installs = 0): Promise<StandIn> {
  const dir = tempDir("squeal-pi-trace-test-");
  writeFileSync(join(dir, "worker.mjs"), WORKER);
  writeFileSync(join(dir, "pi.mjs"), pi(stay));
  const trace = wakeTrace();
  traces.push(trace);
  const start = (argv: string[]) => {
    const child = spawn(process.execPath, ["pi.mjs", ...argv], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "", ...trace.env },
      stdio: "ignore",
    });
    children.push(child);
    return child;
  };
  const pids: number[] = [];
  for (let n = 0; n < installs; n++) {
    const child = start(["install", "./package"]);
    await new Promise((done) => child.once("exit", done));
    pids.push(child.pid ?? -1);
  }
  const child = start(args);
  const pid = child.pid ?? -1;
  const has = (kind: string) =>
    trace.read().some((l: TraceLine) => l.pid === pid && l.kind === kind);
  const deadline = Date.now() + 20_000;
  while (!has("worker-ended") || (!stay && !has("exit"))) {
    if (Date.now() > deadline) throw new Error(`the stand-in did not finish: ${trace.read()}`);
    await sleep(20);
  }
  return { trace, dir, pid, installs: pids };
}

async function timeout(
  trace: WakeTrace | undefined,
  dir: string,
  probe: ArmWait["probe"] = () => ({ consumers: ["s-1/main"], lock: "absent" }),
): Promise<string> {
  const error = await awaitArmed({
    headline: "the idle wake was never armed",
    boundMs: 200,
    pollMs: 20,
    probe,
    trace,
    piCwd: dir,
  }).catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(Error);
  return (error as Error).message;
}

describe("awaitArmed at its deadline", () => {
  it("names the lock, the consumers, Pi's process, the waiter's life, its waits, events and stderr", {
    timeout: 30_000,
  }, async () => {
    const { trace, dir, pid } = await standIn(true);
    const message = await timeout(trace, dir);

    expect(message).toMatch(/^the idle wake was never armed: .* within 200 ms\n/);
    expect(message).toMatch(/Times are from the wait's start, \d{4}-/);
    // The first observation's offset is whatever the clock read: a tick may pass before it.
    expect(message).toMatch(/[+-]\d+ ms {2}1 consumer\(s\), lock absent\n/);
    expect(message).toContain(`Pi process (it runs the waiter thread): pid ${pid}, alive`);
    expect(message).toContain("no exit recorded (still running).");
    expect(message).toMatch(
      /Waiter \(delivery worker thread\): started 1 time\(s\), thread 1 at [+-]\d+ ms/,
    );
    expect(message).toMatch(
      /thread 1: its exit listener ran, code 3, at [+-]\d+ ms; Pi saw it exit with code 3 at [+-]\d+ ms/,
    );
    expect(message).toMatch(/Arm: 1 agent_settled event\(s\), at [+-]\d+ ms; 1 wait request\(s\)/);
    expect(message).toMatch(/wait 7 on thread 1 at [+-]\d+ ms: no answer/);
    expect(message).toMatch(/[+-]\d+ ms {2}thread 1 worker-in id 6 request endTurn\n/);
    expect(message).toMatch(
      /[+-]\d+ ms {2}thread 1 worker-out id 6 ok true held unknown answer null\n/,
    );
    expect(message).toMatch(/[+-]\d+ ms {2}pi event agent_settled\n/);
    expect(message).toMatch(
      /\nPi stderr: wrote 23 bytes in \d+ writes, first at [+-]\d+ ms, last at [+-]\d+ ms\.$/,
    );
    // The Node child inherited the preload and recorded nothing.
    expect(new Set(trace.read().map((l) => l.pid))).toEqual(new Set([pid]));
  });

  it("says when Pi has exited, and with what code", { timeout: 30_000 }, async () => {
    const { trace, dir, pid } = await standIn(false);
    const message = await timeout(trace, dir);
    expect(message).toContain(`pid ${pid}, not running; exited with code 0.`);
  });

  it("names Pi's run, not the `pi install` that ran before it in the same trace", {
    timeout: 30_000,
  }, async () => {
    const { trace, dir, pid, installs } = await standIn(
      true,
      ["--no-context-files", "--mode", "rpc"],
      1,
    );
    const [install] = installs;
    expect(install).not.toBe(pid);
    const message = await timeout(trace, dir);
    expect(message).toContain(`Pi process (it runs the waiter thread): pid ${pid}, alive`);
    expect(message).not.toContain(`pid ${install}, not running`);
    expect(message).toMatch(
      new RegExp(
        `Not Pi's run, left out: pid ${install} \\(first argument install\\), .*exited with code 0`,
      ),
    );
    // The installer's own agent_settled line is not counted as Pi's.
    expect(message).toMatch(/Arm: 1 agent_settled event\(s\)/);
  });

  it("records a worker that Pi ends with terminate(): its exit code and time", {
    timeout: 30_000,
  }, async () => {
    const { trace, dir } = await standIn(true, ["terminate"]);
    const message = await timeout(trace, dir);
    // terminate() stops the worker before its own exit listener runs; Pi's side still sees it.
    expect(message).toMatch(/thread 1: Pi saw it exit with code 1 at [+-]\d+ ms/);
    // Row 005-107: the exit can come in the wait's first millisecond, or after it starts.
    const ended = trace.read().find((l) => l.kind === "worker-ended")?.t;
    expect(ended).toBeTypeOf("number");
    for (const offset of [-1, 0, 1]) {
      vi.spyOn(Date, "now").mockReturnValueOnce((ended as number) - offset);
      const forced = await timeout(trace, dir);
      vi.restoreAllMocks();
      const signed = offset < 0 ? String(offset) : `+${offset}`;
      expect(forced).toContain(`thread 1: Pi saw it exit with code 1 at ${signed} ms`);
    }
  });

  it("prints only fixed facts, whatever text Pi, its worker, an error or a probe wrote", {
    timeout: 30_000,
  }, async () => {
    const { trace, dir } = await standIn(true, ["leak"]);
    let polls = 0;
    const message = await timeout(trace, dir, () => {
      if (polls++ % 2 === 0) return { consumers: [TEXT, TEXT], lock: TEXT };
      const error = new Error(`EACCES ${TEXT}`);
      Object.assign(error, { code: TEXT, name: TEXT });
      throw error;
    });
    // The arbitrary text reached the trace's step records, so the report had it to print.
    // Review 009-30-r3 N1: a boolean, so a failure never prints the trace.
    expect(JSON.stringify(trace.read()).includes(MARKER)).toBe(true);
    expect(message).toContain(`2 consumer(s), lock not read`);
    expect(message).toContain(`probe threw, code other`);
    expect(message).toMatch(/pi event other command other\n/);
    expect(message).toMatch(/pi event response command other\n/);
    expect(message).toMatch(/worker-in id unknown request other\n/);
    expect(message).toMatch(/worker-out id unknown ok true held unknown answer text\n/);
    expect(message).toMatch(/Pi saw an error event, \w+, at/);
    expect(message).toMatch(/Pi stderr: wrote \d+ bytes in \d+ writes, first at [+-]\d+ ms/);
    expect(unexpectedTokens(message)).toEqual([]);
  });

  it("the token check rejects each leak form, so passing it means something", () => {
    for (const line of [...LEAK, TEXT, "~", homedir(), "lock not-a-state"]) {
      expect(unexpectedTokens(`thread 1 ${line}`), line).not.toEqual([]);
    }
  });

  it("says when the run loaded no trace", async () => {
    const message = await timeout(undefined, tempDir("squeal-pi-trace-test-"));
    expect(message).toContain("Pi process (it runs the waiter thread): not found");
    expect(message).toContain("No Pi trace: this run did not load pi-trace-preload.mjs.");
  });
});

/**
 * The report's allowed tokens: its own template words, the closed sets it maps names into,
 * integers, and the wait's ISO start time. Words are split on spaces and the punctuation the
 * templates use, so `/`, `"`, `@`, `~` and any word not listed stay in a token and fail.
 */
const WORDS = new Set(
  (
    "the idle wake was never armed session's waiter lock not held within ms Times are from " +
    "wait's start Lock and consumers at each change consumer s held free absent read probe " +
    "threw code other none Pi process it runs thread pid alive proc state not running no " +
    "exit recorded still exited with so its or signal is unknown found trace in Not run left " +
    "out first argument install started Waiter delivery worker time its listener ran saw an " +
    "error event Arm agent_settled request reached wait answered ok answer cancelled Steps " +
    "of and without message streaming all last pi worker-start worker-exit worker-ended " +
    "worker-error worker-in worker-out id command true false stderr wrote bytes writes " +
    "nothing written empty so preload never ran this did load pi-trace-preload mjs " +
    "text object null number boolean undefined R S D Z T on /proc"
  ).split(" "),
);
const VALUES = [EVENT_TYPES, COMMANDS, REQUESTS, ERROR_CODES, ERROR_NAMES];

function unexpectedTokens(message: string): string[] {
  return message
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, " ")
    .split(/[\s,.;:()=[\]]+/)
    .filter(
      (token) =>
        token !== "" &&
        !/^[+-]?\d+$/.test(token) &&
        !WORDS.has(token) &&
        !VALUES.some((set) => set.has(token)),
    );
}
