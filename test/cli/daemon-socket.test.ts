import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { squealRepo } from "../harness/helpers.js";

const saved = { ...process.env };
let runtimeDir: string;
const servers: Server[] = [];

beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** A stand-in daemon: answers ping, run-all and stop, and goes away after a stop. */
function fakeDaemon(path: string): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.once("data", (data) => {
        const request = JSON.parse(data.toString()) as { type: string };
        const base = { schemaVersion: 1, ok: true, type: request.type };
        const response =
          request.type === "ping"
            ? {
                ...base,
                pid: process.pid,
                worktreeId: "0123456789abcdef",
                root: "/",
                squealVersion: "0.0.0-test",
                phase: "ready",
                startedAt: Date.now(),
              }
            : request.type === "run-all"
              ? {
                  ...base,
                  requestId: "r1",
                  checkpoint: { id: "c1", revision: 3, testFiles: [] },
                  error: null,
                }
              : base;
        socket.end(`${JSON.stringify(response)}\n`);
        if (request.type === "stop") server.close();
      });
    });
    servers.push(server);
    server.listen(path, () => resolve(server));
  });
}

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

describe("the socket the CLI asks (001-71, D1)", () => {
  it("stop reaches the daemon on the computed socket when the record is stale and its socket gone", async () => {
    const r = squealRepo();
    // The record names `/tmp/squeal-test-<id>.sock`, where nobody listens.
    r.daemon("stale", Date.now() - 60_000);
    await fakeDaemon(socketPathFor(r.worktreeId));

    const stop = await run(["stop"], r.root);
    expect(stop).toMatchObject({ code: 0, stdout: `Squeal daemon stopped for ${r.root}\n` });
  });

  it("run --all asks the recorded socket while its heartbeat is fresh", async () => {
    const r = squealRepo();
    // A daemon started from a shell with another runtime dir records where it really listens.
    const elsewhere = join(mkdtempSync("/tmp/sq-"), "other.sock");
    await fakeDaemon(elsewhere);
    r.store.worktrees.setDaemon(r.worktreeId, {
      socketPath: elsewhere,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
    });

    const runAll = await run(["run", "--all"], r.root);
    expect(runAll).toMatchObject({
      code: 0,
      stdout: "Checkpoint c1 started at revision 3: 0 test files\n",
    });
    rmSync(join(elsewhere, ".."), { recursive: true, force: true });
  });
});
