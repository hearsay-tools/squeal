import { type ChildProcess, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "../store/helpers.js";
import { awaitArmed, type TraceLine, type WakeTrace, wakeTrace } from "./pi-wake-trace.js";

/*
 * Row 009-30: a forced timeout names every fact the brief lists. A stand-in for Pi loads the
 * preload as Pi does: it prints an `agent_settled` RPC line and a stderr line, starts a worker
 * thread that dies on its `wait` as the research's single-shot arm case does, and spawns a
 * Node child, which must stay out of the trace.
 */

const WORKER = `
import { parentPort } from "node:worker_threads";
parentPort.on("message", (message) => {
  if (message.request?.kind === "wait") process.exit(3);
  parentPort.postMessage({ id: message.id, ok: true, answer: null });
});
`;

const pi = (stay: boolean) => `
import { execFileSync } from "node:child_process";
import { Worker } from "node:worker_threads";
execFileSync(process.execPath, ["-e", ""]);
process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
process.stderr.write("DEBUG withContext boom\\n");
const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
  execArgv: ["--disable-warning=ExperimentalWarning"],
});
worker.postMessage({ id: 6, request: { kind: "endTurn" } });
worker.postMessage({ id: 7, request: { kind: "wait" } });
${stay ? "setInterval(() => {}, 1000);" : ""}
`;

const children: ChildProcess[] = [];
const traces: WakeTrace[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const trace of traces.splice(0)) trace.cleanup();
});

/** Starts the stand-in and resolves once its worker has exited. */
async function standIn(stay: boolean): Promise<{ trace: WakeTrace; dir: string; pid: number }> {
  const dir = tempDir("squeal-pi-trace-test-");
  writeFileSync(join(dir, "worker.mjs"), WORKER);
  writeFileSync(join(dir, "pi.mjs"), pi(stay));
  const trace = wakeTrace();
  traces.push(trace);
  const child = spawn(process.execPath, ["pi.mjs"], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? "", ...trace.env },
    stdio: "ignore",
  });
  children.push(child);
  const has = (kind: string) => trace.read().some((l: TraceLine) => l.kind === kind);
  const deadline = Date.now() + 20_000;
  while (!has("worker-exit") || (!stay && !has("exit"))) {
    if (Date.now() > deadline) throw new Error(`the stand-in did not finish: ${trace.read()}`);
    await sleep(20);
  }
  return { trace, dir, pid: child.pid ?? -1 };
}

async function timeout(trace: WakeTrace | undefined, dir: string): Promise<string> {
  const error = await awaitArmed({
    headline: "the idle wake was never armed",
    boundMs: 200,
    pollMs: 20,
    probe: () => ({ consumers: ["s-1/main"], lock: "absent" }),
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
    expect(message).toMatch(/\+0 ms {2}consumers \[s-1\/main\], lock absent/);
    expect(message).toContain(`Pi process (it runs the waiter thread): pid ${pid}, alive`);
    expect(message).toContain("no exit recorded (still running, or ended by a signal)");
    expect(message).toMatch(
      /Waiter \(delivery worker thread\): started 1 time\(s\), thread 1 at -\d+ ms/,
    );
    expect(message).toMatch(/thread 1 exited with code 3 at -\d+ ms/);
    expect(message).toMatch(/Arm: 1 agent_settled event\(s\), at -\d+ ms; 1 wait request\(s\)/);
    expect(message).toMatch(/wait 7 on thread 1 at -\d+ ms: no answer/);
    expect(message).toMatch(/-\d+ ms {2}thread 1 worker-in id=6 request="endTurn"/);
    expect(message).toMatch(/-\d+ ms {2}thread 1 worker-out id=6 ok=true answer=null/);
    expect(message).toMatch(/-\d+ ms {2}pi event type="agent_settled"/);
    expect(message).toContain("Pi stderr (last 2000 characters):\n  DEBUG withContext boom");
    // The Node child inherited the preload and recorded nothing.
    expect(new Set(trace.read().map((l) => l.pid))).toEqual(new Set([pid]));
  });

  it("says when Pi has exited, and with what code", { timeout: 30_000 }, async () => {
    const { trace, dir, pid } = await standIn(false);
    const message = await timeout(trace, dir);
    expect(message).toContain(`pid ${pid}, not running; exited with code 0.`);
  });

  it("says when the run loaded no trace", async () => {
    const message = await timeout(undefined, tempDir("squeal-pi-trace-test-"));
    expect(message).toContain("Pi process (it runs the waiter thread): not found");
    expect(message).toContain("No Pi trace: this run did not load pi-trace-preload.mjs.");
  });
});
