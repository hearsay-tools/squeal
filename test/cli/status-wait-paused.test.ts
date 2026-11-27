import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, Socket } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { A, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-344: after `status <path> --wait` or `status --wait` decides, a
 * sync request still on a paused daemon's socket no longer holds the process
 * for the CLI socket timeout (2 s): `DaemonSync.stop()` aborts it.
 *
 * Row 011-429 (G1): the CLI runs in this process, and the check is the
 * order: when the command returns its outcome, every socket it opened is
 * already destroyed. A request left on the paused socket stays open until
 * its 2 s timeout. The time from the outcome's line to the process's exit
 * under 300 ms, asserted before, failed on a shared CI runner.
 */

let scratch: string;
const servers: Server[] = [];
const sockets: Socket[] = [];
const saved = { ...process.env };

beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  scratch = mkdtempSync("/tmp/sq-");
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...saved };
  for (const s of sockets.splice(0)) s.destroy();
  for (const s of servers.splice(0)) s.close();
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * A paused daemon: its socket accepts and never answers. `accepted` counts
 * its connections: the sync's ping or request, and the liveness watch's ping.
 */
async function pausedDaemon(path: string, accepted: { count: number }): Promise<void> {
  const server = createServer((socket) => {
    sockets.push(socket);
    // Read and drop the request, so the peer's end is seen.
    socket.resume();
    accepted.count += 1;
    socket.on("error", () => {});
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(path, () => done()));
}

interface Run {
  readonly code: number;
  readonly output: string;
  /** From the call to the first output, the outcome's: the longest the CLI's wait can have run. */
  readonly beforeMs: number;
  /** The client sockets the command opened, and those still open when it returned. */
  readonly opened: number;
  readonly openAtReturn: number;
  readonly accepted: number;
}

async function statusAgainstPaused(args: readonly string[]): Promise<Run> {
  const { repo } = repoWith([A]);
  process.env.XDG_RUNTIME_DIR = join(scratch, "run");
  process.env.HOME = join(scratch, "home");
  delete process.env.PLUGIN_ROOT;
  delete process.env.PLUGIN_DATA;
  const socket = socketPathFor(repo.mainId, process.env);
  mkdirSync(join(socket, ".."), { recursive: true });
  mkdirSync(join(scratch, "home"));
  const accepted = { count: 0 };
  await pausedDaemon(socket, accepted);

  // Every client socket this process connects while the command runs.
  const clients: Socket[] = [];
  const connect = Socket.prototype.connect;
  vi.spyOn(Socket.prototype, "connect").mockImplementation(function (
    this: Socket,
    ...args: unknown[]
  ) {
    clients.push(this);
    return (connect as (...a: unknown[]) => Socket).apply(this, args);
  });

  let output = "";
  let firstAt: number | null = null;
  const take = (text: string) => {
    firstAt ??= performance.now();
    output += text;
  };
  const io: CliIo = { stdout: take, stderr: take, cwd: repo.main, env: process.env };
  const began = performance.now();
  const code = await main(["status", ...args], io);
  const openAtReturn = clients.filter((c) => !c.destroyed).length;
  vi.restoreAllMocks();
  return {
    code,
    output,
    beforeMs: (firstAt ?? performance.now()) - began,
    opened: clients.length,
    openAtReturn,
    accepted: accepted.count,
  };
}

/**
 * The seconds `prefix` names in the output ("after N.N s"), checked against
 * two measured ends, not an exact tenth (row 011-374): the deadline passed,
 * so the wait ran at least the `askedMs` the test asked for (less 1 ms of
 * timer clock, `wait-clock.ts`), and it ran inside the call before its
 * first output. Each end allows the half tenth the line rounds.
 */
function expectElapsed(run: Run, prefix: string, askedMs: number): void {
  const found = new RegExp(`^${prefix} after (\\d+\\.\\d) s`, "m").exec(run.output);
  expect(found, run.output).not.toBeNull();
  const shownMs = Number(found?.[1]) * 1_000;
  expect(shownMs, run.output).toBeGreaterThanOrEqual(askedMs - 1 - 50);
  expect(shownMs, run.output).toBeLessThanOrEqual(run.beforeMs + 50);
}

describe("a wait against a paused daemon ends with its outcome (row 011-344)", () => {
  it("status <path> --wait: no verdict, exit 3, and the process ends with it", async () => {
    const run = await statusAgainstPaused([A, "--wait", "600"]);

    expect(run.code, run.output).toBe(3);
    expect(run.output).toMatch(
      /^Named test files have no verdict: the deadline passed after \d+\.\d s/m,
    );
    expectElapsed(run, "Named test files have no verdict: the deadline passed", 600);
    // Before the row a request stayed on the socket until its 2 s timeout, after this line.
    // The sync's ping and the liveness watch's ping both reached the socket and ended with the wait.
    expect(run.accepted, run.output).toBeGreaterThanOrEqual(2);
    expect(run.opened, run.output).toBeGreaterThanOrEqual(2);
    expect(run.openAtReturn, run.output).toBe(0);
  }, 30_000);

  it("status --wait: returned on timeout, exit 0, and the process ends with it", async () => {
    const run = await statusAgainstPaused(["--wait", "600"]);

    expect(run.code, run.output).toBe(0);
    expect(run.output).toMatch(
      /^Returned on timeout after \d+\.\d s: 2 checks \(2 tests\) pending/m,
    );
    expectElapsed(run, "Returned on timeout", 600);
    expect(run.accepted, run.output).toBeGreaterThanOrEqual(2);
    expect(run.opened, run.output).toBeGreaterThanOrEqual(2);
    expect(run.openAtReturn, run.output).toBe(0);
  }, 30_000);
});
