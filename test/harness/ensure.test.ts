import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDaemon, probeDaemon, socketPathFor } from "../../src/core/daemon/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { fakeRepo } from "../status/helpers.js";
import { tempDir } from "../store/helpers.js";
import { squealRepo } from "./helpers.js";

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

function listen(path: string): Promise<Server> {
  return new Promise((resolve) => {
    // Answer the daemon's ping the way a live daemon does; a bare connection is not "alive".
    const server = createServer((socket) => {
      socket.once("data", () => {
        const response = {
          schemaVersion: 1,
          ok: true,
          type: "ping",
          pid: process.pid,
          worktreeId: "0123456789abcdef",
          root: "/",
          squealVersion: "0.0.0-test",
          phase: "ready",
          startedAt: Date.now(),
        };
        socket.end(`${JSON.stringify(response)}\n`);
      });
    });
    servers.push(server);
    server.listen(path, () => resolve(server));
  });
}

/** A stand-in CLI that records its arguments, so a spawn is observable. */
function recordingCli(): { cli: string; argsFile: string } {
  const dir = tempDir("squeal-cli-");
  const argsFile = join(dir, "args.json");
  const cli = join(dir, "cli.mjs");
  writeFileSync(
    cli,
    // Written whole and renamed into place, so a reader never sees a half-written file.
    `import { renameSync, writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(`${argsFile}.tmp`)}, JSON.stringify(process.argv.slice(2)));\nrenameSync(${JSON.stringify(`${argsFile}.tmp`)}, ${JSON.stringify(argsFile)});\n`,
  );
  chmodSync(cli, 0o755);
  return { cli, argsFile };
}

async function waitFor(path: string): Promise<void> {
  for (let i = 0; i < 100 && !existsSync(path); i++) await sleep(20);
}

describe("ensureDaemon", () => {
  it("puts the socket in the runtime dir, named by the worktree id", () => {
    expect(socketPathFor("0123456789abcdef")).toBe(
      join(runtimeDir, "squeal-0123456789abcdef.sock"),
    );
  });

  it("is alive when the socket accepts a connection, and spawns nothing", async () => {
    const repo = fakeRepo();
    const { cli, argsFile } = recordingCli();
    process.env.SQUEAL_CLI = cli;
    await listen(socketPathFor(worktreeIdFor(repo.main)));

    expect(await ensureDaemon(repo.main, { socketTimeoutMs: 100 })).toBe("alive");
    await sleep(200);
    expect(existsSync(argsFile)).toBe(false);
  });

  it("spawns `squeal daemon <root>` detached when no socket exists", async () => {
    const repo = fakeRepo();
    const { cli, argsFile } = recordingCli();
    process.env.SQUEAL_CLI = cli;

    expect(await ensureDaemon(repo.main, { socketTimeoutMs: 100 })).toBe("spawned");
    await waitFor(argsFile);
    expect(JSON.parse(readFileSync(argsFile, "utf8"))).toEqual(["daemon", repo.main]);
  });

  it("spawns when the socket file is stale (connection refused)", async () => {
    const repo = fakeRepo();
    const { cli, argsFile } = recordingCli();
    process.env.SQUEAL_CLI = cli;
    const path = socketPathFor(worktreeIdFor(repo.main));
    const server = await listen(path);
    // Closing a unix server unlinks its file; a file left behind is what a killed daemon leaves.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    writeFileSync(path, "");

    expect(await ensureDaemon(repo.main, { socketTimeoutMs: 100 })).toBe("spawned");
    await waitFor(argsFile);
    expect(existsSync(argsFile)).toBe(true);
  });

  it("spawns the CLI the caller ships when SQUEAL_CLI is not set (B1)", async () => {
    const repo = fakeRepo();
    const { cli, argsFile } = recordingCli();
    delete process.env.SQUEAL_CLI;

    expect(await ensureDaemon(repo.main, { cli, socketTimeoutMs: 100 })).toBe("spawned");
    await waitFor(argsFile);
    expect(JSON.parse(readFileSync(argsFile, "utf8"))).toEqual(["daemon", repo.main]);
  });

  it("lets SQUEAL_CLI override the CLI the caller ships, for tests", async () => {
    const repo = fakeRepo();
    const shipped = recordingCli();
    const override = recordingCli();
    process.env.SQUEAL_CLI = override.cli;

    expect(await ensureDaemon(repo.main, { cli: shipped.cli, socketTimeoutMs: 100 })).toBe(
      "spawned",
    );
    await waitFor(override.argsFile);
    expect(existsSync(override.argsFile)).toBe(true);
    expect(existsSync(shipped.argsFile)).toBe(false);
  });

  it("is unavailable with neither a CLI from the caller nor SQUEAL_CLI", async () => {
    const repo = fakeRepo();
    delete process.env.SQUEAL_CLI;
    expect(await ensureDaemon(repo.main, { socketTimeoutMs: 100 })).toBe("unavailable");
  });

  it("is unavailable when no CLI entry point can be found", async () => {
    const repo = fakeRepo();
    process.env.SQUEAL_CLI = join(tempDir(), "missing.mjs");

    expect(await ensureDaemon(repo.main, { socketTimeoutMs: 100 })).toBe("unavailable");
  });
});

describe("probeDaemon and the recorded socket (review wave 3, S8)", () => {
  function record(r: ReturnType<typeof squealRepo>, socketPath: string, heartbeatAt: number) {
    r.store.worktrees.setDaemon(r.worktreeId, {
      socketPath,
      startedAt: heartbeatAt,
      heartbeatAt,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
    });
  }

  it("asks the socket the daemon recorded first while its heartbeat is fresh", async () => {
    const r = squealRepo();
    // A daemon started from a shell with another runtime dir records where it really listens.
    const elsewhere = join(mkdtempSync("/tmp/sq-"), "other.sock");
    await listen(elsewhere);
    record(r, elsewhere, Date.now());

    expect(await probeDaemon(r.root, 100)).toMatchObject({ state: "alive" });
    const { cli, argsFile } = recordingCli();
    expect(await ensureDaemon(r.root, { cli, socketTimeoutMs: 100 })).toBe("alive");
    await sleep(100);
    expect(existsSync(argsFile)).toBe(false);
    rmSync(dirname(elsewhere), { recursive: true, force: true });
  });

  it("ignores a recorded socket whose heartbeat is stale and probes the computed path", async () => {
    const r = squealRepo();
    const elsewhere = join(mkdtempSync("/tmp/sq-"), "other.sock");
    await listen(elsewhere);
    record(r, elsewhere, Date.now() - 60_000);

    expect(await probeDaemon(r.root, 100)).toEqual({ state: "absent", code: "ENOENT" });
    rmSync(dirname(elsewhere), { recursive: true, force: true });
  });

  it("falls back to the computed path when the recorded socket is gone", async () => {
    const r = squealRepo();
    record(r, join(runtimeDir, "gone.sock"), Date.now());
    await listen(socketPathFor(r.worktreeId));

    expect(await probeDaemon(r.root, 100)).toMatchObject({ state: "alive" });
  });
});
