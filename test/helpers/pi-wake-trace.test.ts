import { type ChildProcess, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "../store/helpers.js";
import {
  type ArmWait,
  awaitArmed,
  type TraceLine,
  type WakeTrace,
  wakeTrace,
} from "./pi-wake-trace.js";

/*
 * Row 009-30: a forced timeout names every fact the brief lists. A stand-in for Pi loads the
 * preload as Pi does: it prints an `agent_settled` RPC line and a stderr line, starts a worker
 * thread that dies on its `wait` as the research's single-shot arm case does, and spawns a
 * Node child, which must stay out of the trace. Its first argument `install` makes it a stand-in
 * for `pi install`, which exits; `terminate` ends its worker from Pi's side; `leak` writes a home
 * path and synthetic secrets to stderr.
 */

const WORKER = `
import { parentPort } from "node:worker_threads";
parentPort.on("message", (message) => {
  if (message.request?.kind === "wait") process.exit(3);
  parentPort.postMessage({ id: message.id, ok: true, answer: null });
});
`;

/** Synthetic markers only: no real credential or private path is read or written. */
const MARKER = "SYNTHETIC0MARKER0009x30";
const LEAK = [
  `Error: boom\\n    at withContext (${homedir()}/synthetic-repo/dist/extension.mjs:12:3)\n`,
  "api_tok",
  `en=${MARKER}a and Authorization: Bearer ${MARKER}b and Bearer ${MARKER}d\n`,
];

const pi = (stay: boolean) => `
import { execFileSync } from "node:child_process";
import { Worker } from "node:worker_threads";
const mode = process.argv[2];
execFileSync(process.execPath, ["-e", ""]);
process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
if (mode === "install") process.exit(0);
process.stderr.write("DEBUG withContext boom\\n");
if (mode === "leak") for (const part of ${JSON.stringify(LEAK)}) process.stderr.write(part);
const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
  execArgv: ["--disable-warning=ExperimentalWarning"],
});
worker.postMessage({ id: 6, request: { kind: "endTurn" } });
if (mode === "terminate") worker.once("message", () => void worker.terminate());
else worker.postMessage({ id: 7, request: { kind: "wait" } });
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
    expect(message).toMatch(/\+\d+ ms {2}consumers \[s-1\/main\], lock absent/);
    expect(message).toContain(`Pi process (it runs the waiter thread): pid ${pid}, alive`);
    expect(message).toContain("no exit recorded (still running).");
    expect(message).toMatch(
      /Waiter \(delivery worker thread\): started 1 time\(s\), thread 1 at -\d+ ms/,
    );
    expect(message).toMatch(
      /thread 1: its exit listener ran, code 3, at -\d+ ms; Pi saw it exit with code 3 at -\d+ ms/,
    );
    expect(message).toMatch(/Arm: 1 agent_settled event\(s\), at -\d+ ms; 1 wait request\(s\)/);
    expect(message).toMatch(/wait 7 on thread 1 at -\d+ ms: no answer/);
    expect(message).toMatch(/-\d+ ms {2}thread 1 worker-in id=6 request="endTurn"/);
    expect(message).toMatch(/-\d+ ms {2}thread 1 worker-out id=6 ok=true answer=null/);
    expect(message).toMatch(/-\d+ ms {2}pi event type="agent_settled"/);
    expect(message).toContain(
      "Pi stderr (last 2000 characters, home as ~, secrets redacted):\n  DEBUG withContext boom",
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
        `Not Pi's run, left out: pid ${install} \\(first argument "install"\\), .*exited with code 0`,
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
    expect(message).toMatch(/thread 1: Pi saw it exit with code 1 at -\d+ ms/);
  });

  it("writes home as ~ and redacts secret-shaped text in stderr and probe errors", {
    timeout: 30_000,
  }, async () => {
    const { trace, dir } = await standIn(true, ["leak"]);
    const message = await timeout(trace, dir, () => {
      throw new Error(`EACCES ${homedir()}/synthetic-store password=${MARKER}c`);
    });
    expect(message).not.toContain(homedir());
    expect(message).not.toContain(MARKER);
    expect(message).toContain("at withContext (~/synthetic-repo/dist/extension.mjs:12:3)");
    // The key was split across two writes.
    expect(message).toContain("api_token=[redacted]");
    expect(message).toContain("Authorization: [redacted] and Bearer [redacted]");
    expect(message).toContain("probe threw: Error: EACCES ~/synthetic-store password=[redacted]");
  });

  it("says when the run loaded no trace", async () => {
    const message = await timeout(undefined, tempDir("squeal-pi-trace-test-"));
    expect(message).toContain("Pi process (it runs the waiter thread): not found");
    expect(message).toContain("No Pi trace: this run did not load pi-trace-preload.mjs.");
  });
});
