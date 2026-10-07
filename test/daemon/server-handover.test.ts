import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { createDaemonServer, type DaemonServer } from "../../src/core/daemon/server.js";
import { PAYLOAD_SCHEMA_VERSION } from "../../src/core/types/index.js";

/*
 * Board row 001-77: socket paths are keyed by the root path alone, so a
 * daemon whose root another repository or a fresh clone took over binds
 * where the old daemon still listens. The old one's exit must leave the
 * newcomer's socket in place (spec 001 D10).
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-handover-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function serve(socketPath: string): Promise<DaemonServer> {
  const server = await createDaemonServer(socketPath, () => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "nudge",
  }));
  cleanups.push(() => server.close());
  return server;
}

describe("a daemon socket handed over at one path (spec 001 D10)", () => {
  it("leaves the newcomer's socket when the old server closes", async () => {
    const path = join(tempDir(), "d.sock");
    const old = await serve(path);
    const newcomer = await serve(path);
    const bound = statSync(path).ino;

    await old.close();

    expect(statSync(path).ino).toBe(bound);
    expect(await requestDaemon(path, { type: "nudge" }, 1_000)).toMatchObject({ ok: true });
    await newcomer.close();
    expect(existsSync(path)).toBe(false);
  });

  it("binds at the socket path with nothing else left in its directory", async () => {
    const dir = tempDir();
    const server = await serve(join(dir, "d.sock"));
    expect(readdirSync(dir)).toEqual(["d.sock"]);
    expect(statSync(join(dir, "d.sock")).mode & 0o777).toBe(0o600);
    await server.close();
    expect(readdirSync(dir)).toEqual([]);
  });
});
