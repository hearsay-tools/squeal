import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { linkedWorktreeDir, runtimeDir, socketPathFor } from "../../src/core/daemon/paths.js";
import { createDaemonServer, type DaemonServer } from "../../src/core/daemon/server.js";
import { PAYLOAD_SCHEMA_VERSION } from "../../src/core/types/index.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-sock-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function serve(socketPath: string): Promise<DaemonServer> {
  const server = await createDaemonServer(socketPath, (request) =>
    request.type === "nudge"
      ? { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "nudge" }
      : { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: false, error: `no ${request.type} here` },
  );
  cleanups.push(() => server.close());
  return server;
}

describe("socket paths (spec 001 D1)", () => {
  it("uses XDG_RUNTIME_DIR when set and absolute, else the temp dir", () => {
    expect(runtimeDir({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe("/run/user/1000");
    expect(runtimeDir({ XDG_RUNTIME_DIR: "" })).toBe(tmpdir());
    expect(runtimeDir({ XDG_RUNTIME_DIR: "relative" })).toBe(tmpdir());
    expect(runtimeDir({})).toBe(tmpdir());
  });

  it("names the socket squeal-<worktree-hash>.sock, short enough for macOS", () => {
    const path = socketPathFor("0123456789abcdef", { XDG_RUNTIME_DIR: "/run/user/1000" });
    expect(path).toBe("/run/user/1000/squeal-0123456789abcdef.sock");
    expect(Buffer.byteLength(path)).toBeLessThan(104);
  });

  it("finds the <common-dir>/worktrees/<name> entry of a linked worktree, none for the main one", () => {
    const dir = tempDir();
    const main = join(dir, "main");
    const entry = join(main, ".git", "worktrees", "feature");
    mkdirSync(entry, { recursive: true });
    const linked = join(dir, "feature");
    mkdirSync(linked);
    writeFileSync(join(linked, ".git"), `gitdir: ${entry}\n`);
    expect(linkedWorktreeDir(main)).toBeNull();
    expect(linkedWorktreeDir(linked)).toBe(entry);
  });
});

describe("daemon socket server and client", () => {
  it("answers one JSON line per connection", async () => {
    const path = join(tempDir(), "d.sock");
    await serve(path);
    expect(await requestDaemon(path, { type: "nudge" }, 1_000)).toEqual({
      schemaVersion: 1,
      ok: true,
      type: "nudge",
    });
    expect(await requestDaemon(path, { type: "ping" }, 1_000)).toEqual({
      schemaVersion: 1,
      ok: false,
      error: "no ping here",
    });
  });

  it("answers malformed and unknown requests with an error, and keeps serving", async () => {
    const path = join(tempDir(), "d.sock");
    await serve(path);
    const raw = (line: string) =>
      requestDaemon(path, JSON.parse(line) as never, 1_000).catch((e: Error) => e.message);
    expect(await raw('{"type":"launch"}')).toMatchObject({ ok: false, error: /unknown request/ });
    expect(await raw('{"type":"run-all","force":"yes"}')).toMatchObject({ ok: false });
    expect(await requestDaemon(path, { type: "nudge" }, 1_000)).toMatchObject({ ok: true });
  });

  it("makes the socket private to the user", async () => {
    const { statSync } = await import("node:fs");
    const path = join(tempDir(), "d.sock");
    await serve(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("replaces a stale socket file left by a killed daemon", async () => {
    const path = join(tempDir(), "d.sock");
    writeFileSync(path, "");
    await expect(requestDaemon(path, { type: "nudge" }, 1_000)).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
    await serve(path);
    expect(await requestDaemon(path, { type: "nudge" }, 1_000)).toMatchObject({ ok: true });
  });

  it("rejects with ENOENT when there is no socket", async () => {
    const path = join(tempDir(), "none.sock");
    await expect(requestDaemon(path, { type: "ping" }, 1_000)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("gives up after the timeout when the daemon does not answer", async () => {
    const path = join(tempDir(), "hung.sock");
    const held: Socket[] = [];
    const hung = createServer((socket) => held.push(socket));
    await new Promise<void>((resolve) => hung.listen(path, resolve));
    cleanups.push(() => {
      for (const socket of held) socket.destroy();
      return new Promise((resolve) => hung.close(resolve));
    });
    const started = performance.now();
    await expect(requestDaemon(path, { type: "ping" }, 100)).rejects.toMatchObject({
      code: "ETIMEDOUT",
    });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("unlinks its socket on close", async () => {
    const { existsSync } = await import("node:fs");
    const path = join(tempDir(), "d.sock");
    const server = await serve(path);
    await server.close();
    expect(existsSync(path)).toBe(false);
  });
});

describe("daemon singleton lock (spec 001 D10)", () => {
  it("is held by one owner until released", () => {
    const path = join(tempDir(), "locks", "abc.sqlite");
    const first = acquireDaemonLock(path);
    expect(first).not.toBeNull();
    expect(acquireDaemonLock(path)).toBeNull();
    first?.release();
    const second = acquireDaemonLock(path);
    expect(second).not.toBeNull();
    second?.release();
  });
});
