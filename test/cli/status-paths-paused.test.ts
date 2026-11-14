import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, type Server, type Socket } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncDaemon } from "../../src/cli/status-sync.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { A, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-49 (review of cand/0.1.233, S1): `squeal status <path>` reads its
 * snapshot near its 750 ms bound, and the process ends there too, not when
 * a request its sync left on a paused daemon's socket times out (2 s). The
 * CLI runs from source through tsx, so the process's own end is measured,
 * from the moment the daemon's socket first got a connection.
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

/** A paused daemon: its socket accepts and never answers. Resolves to when it first accepted. */
function pausedDaemon(path: string): { listening: Promise<void>; first: Promise<number> } {
  let accepted: (at: number) => void = () => {};
  const first = new Promise<number>((done) => {
    accepted = done;
  });
  const server = createServer((socket) => {
    accepted(performance.now());
    sockets.push(socket);
    socket.on("error", () => {});
  });
  servers.push(server);
  const listening = new Promise<void>((done) => server.listen(path, () => done()));
  return { listening, first };
}

describe("squeal status <path> against a paused daemon (row 011-49)", () => {
  it("exits within about 1 s of reaching the daemon, not after the socket timeout", async () => {
    const { repo } = repoWith([A]);
    const runtime = join(scratch, "run");
    const home = join(scratch, "home");
    const env: NodeJS.ProcessEnv = { ...process.env, XDG_RUNTIME_DIR: runtime, HOME: home };
    delete env.PLUGIN_ROOT;
    delete env.PLUGIN_DATA;
    const socket = socketPathFor(repo.mainId, env);
    mkdirSync(join(socket, ".."), { recursive: true });
    mkdirSync(home);
    const daemon = pausedDaemon(socket);
    await daemon.listening;

    const flags = ["--disable-warning=ExperimentalWarning", "--import", TSX, CLI];
    const child = spawn(process.execPath, [...flags, "status", A], {
      cwd: repo.main,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    const exited = new Promise<{ code: number | null; at: number }>((done) =>
      child.once("exit", (code) => done({ code, at: performance.now() })),
    );
    try {
      const reached = await daemon.first;
      const end = await exited;

      // No verdict: the daemon never answered its sync.
      expect(end.code, output).toBe(3);
      expect(output).toMatch(/^Named test files have no verdict at revision 4/m);
      // The snapshot reads at 750 ms; before the row the process ended past 2,000 ms.
      expect(end.at - reached, output).toBeLessThan(1_300);
    } finally {
      child.kill("SIGKILL");
    }
  }, 30_000);

  it("ends a deadline-bound sync by its deadline as unsupported, and one without it waits on", async () => {
    const { repo } = repoWith([A]);
    const runtime = join(scratch, "run");
    const prior = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = runtime;
    try {
      const socket = socketPathFor(repo.mainId);
      mkdirSync(join(socket, ".."), { recursive: true });
      const daemon = pausedDaemon(socket);
      await daemon.listening;
      const root = repo.main as AbsolutePath;
      const started = performance.now();
      const bound = syncDaemon(root, 50, [], started + 300);
      const open = syncDaemon(root, 50, []);
      await bound.answered;
      const ended = performance.now() - started;

      expect(bound.current()).toEqual({ state: "unsupported" });
      expect(ended).toBeGreaterThanOrEqual(290);
      expect(ended).toBeLessThan(1_000);
      // The named and edit waits pass no deadline: their sync still waits on the daemon.
      expect(open.current()).toEqual({ state: "pending" });
      open.stop();
      bound.stop();
    } finally {
      process.env.XDG_RUNTIME_DIR = prior;
    }
  });
});
