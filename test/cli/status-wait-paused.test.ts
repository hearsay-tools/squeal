import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, type Server, type Socket } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { VERSION_ARGS } from "../fixed-version.js";
import { A, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-344: after `status <path> --wait` or `status --wait` decides, a
 * sync request still on a paused daemon's socket no longer holds the process
 * for the CLI socket timeout (2 s): `DaemonSync.stop()` aborts it. The CLI
 * runs from source through tsx; the exit is timed from the outcome's line.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

let scratch: string;
const servers: Server[] = [];
const sockets: Socket[] = [];

beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  scratch = mkdtempSync("/tmp/sq-");
});

afterEach(() => {
  for (const s of sockets.splice(0)) s.destroy();
  for (const s of servers.splice(0)) s.close();
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * A paused daemon: its socket accepts and never answers. Each connection's
 * close time lands in `closes` (the CLI's side ended it: the sync's ping or
 * request, or the liveness watch's ping).
 */
async function pausedDaemon(path: string, closes: number[]): Promise<void> {
  const server = createServer((socket) => {
    sockets.push(socket);
    // Read and drop the request, so the peer's end is seen.
    socket.resume();
    socket.on("close", () => closes.push(performance.now()));
    socket.on("error", () => {});
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(path, () => done()));
}

interface Run {
  readonly code: number | null;
  readonly output: string;
  /** From the first output byte, the outcome's, to the exit. */
  readonly tailMs: number;
  /** From the spawn to the first output byte: the longest the CLI's wait can have run. */
  readonly beforeMs: number;
  /** Each connection's close, from the first output byte. */
  readonly closesMs: readonly number[];
}

async function statusAgainstPaused(args: readonly string[]): Promise<Run> {
  const { repo } = repoWith([A]);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: join(scratch, "run"),
    HOME: join(scratch, "home"),
  };
  delete env.PLUGIN_ROOT;
  delete env.PLUGIN_DATA;
  const socket = socketPathFor(repo.mainId, env);
  mkdirSync(join(socket, ".."), { recursive: true });
  mkdirSync(join(scratch, "home"));
  const closes: number[] = [];
  await pausedDaemon(socket, closes);

  const flags = ["--disable-warning=ExperimentalWarning", ...VERSION_ARGS, "--import", TSX, CLI];
  const spawnedAt = performance.now();
  const child = spawn(process.execPath, [...flags, "status", ...args], {
    cwd: repo.main,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let firstAt: number | null = null;
  const take = (chunk: Buffer) => {
    firstAt ??= performance.now();
    output += chunk.toString("utf8");
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  try {
    const end = await new Promise<{ code: number | null; at: number }>((done) =>
      child.once("exit", (code) => done({ code, at: performance.now() })),
    );
    const from = firstAt ?? end.at;
    // The process's exit closed every connection it left; give the server a moment to see it.
    await new Promise((done) => setTimeout(done, 50));
    return {
      code: end.code,
      output,
      tailMs: end.at - from,
      beforeMs: from - spawnedAt,
      closesMs: closes.map((at) => at - from),
    };
  } finally {
    child.kill("SIGKILL");
  }
}

/**
 * The seconds `prefix` names in the output ("after N.N s"), checked against
 * two measured ends, not an exact tenth (row 011-374): the deadline passed,
 * so the wait ran at least the `askedMs` the test asked for (less 1 ms of
 * timer clock, `wait-clock.ts`), and it ran inside the child's life before
 * its first output byte. Each end allows the half tenth the line rounds.
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
    // Before the row the process ended at the 2 s socket timeout, about 1.4 s after this line.
    expect(run.tailMs, run.output).toBeLessThan(300);
    // The sync's ping and the liveness watch's ping both reached the socket and closed with the wait.
    expect(run.closesMs.length, run.output).toBeGreaterThanOrEqual(2);
    for (const close of run.closesMs) expect(close, run.output).toBeLessThan(300);
  }, 30_000);

  it("status --wait: returned on timeout, exit 0, and the process ends with it", async () => {
    const run = await statusAgainstPaused(["--wait", "600"]);

    expect(run.code, run.output).toBe(0);
    expect(run.output).toMatch(
      /^Returned on timeout after \d+\.\d s: 2 checks \(2 tests\) pending/m,
    );
    expectElapsed(run, "Returned on timeout", 600);
    expect(run.tailMs, run.output).toBeLessThan(300);
    expect(run.closesMs.length, run.output).toBeGreaterThanOrEqual(2);
    for (const close of run.closesMs) expect(close, run.output).toBeLessThan(300);
  }, 30_000);
});
