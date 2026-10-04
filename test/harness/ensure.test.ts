import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDaemon, socketPathFor } from "../../src/core/daemon/ensure.js";
import { worktreeIdFor } from "../../src/core/store/index.js";
import { fakeRepo } from "../status/helpers.js";
import { tempDir } from "../store/helpers.js";

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
    const server = createServer((socket) => socket.end());
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

  it("is unavailable when no CLI entry point can be found", async () => {
    const repo = fakeRepo();
    process.env.SQUEAL_CLI = join(tempDir(), "missing.mjs");

    expect(await ensureDaemon(repo.main, { socketTimeoutMs: 100 })).toBe("unavailable");
  });
});
