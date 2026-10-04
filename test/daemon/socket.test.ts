import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import {
  checkPrivateDir,
  linkedWorktreeDir,
  prepareSocketDir,
  runtimeDir,
  socketPathFor,
} from "../../src/core/daemon/paths.js";
import { createDaemonServer, type DaemonServer } from "../../src/core/daemon/server.js";
import { PAYLOAD_SCHEMA_VERSION } from "../../src/core/types/index.js";

const uid = process.getuid?.() ?? 0;
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
  it("uses XDG_RUNTIME_DIR when set and absolute, else <tmpdir>/squeal-<uid> (review S8)", () => {
    expect(runtimeDir({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe("/run/user/1000");
    expect(runtimeDir({ XDG_RUNTIME_DIR: "", TMPDIR: "/var/tmp" })).toBe(`/var/tmp/squeal-${uid}`);
    expect(runtimeDir({ XDG_RUNTIME_DIR: "relative", TMPDIR: "/var/tmp/" })).toBe(
      `/var/tmp/squeal-${uid}`,
    );
    expect(runtimeDir({})).toBe(`/tmp/squeal-${uid}`);
    expect(runtimeDir({ TMPDIR: "relative" })).toBe(`/tmp/squeal-${uid}`);
  });

  it("names the socket squeal-<worktree-hash>.sock, short enough for macOS", () => {
    const path = socketPathFor("0123456789abcdef", { XDG_RUNTIME_DIR: "/run/user/1000" });
    expect(path).toBe("/run/user/1000/squeal-0123456789abcdef.sock");
    expect(Buffer.byteLength(path)).toBeLessThan(104);
    expect(socketPathFor("0123456789abcdef", { TMPDIR: "/tmp" })).toBe(
      `/tmp/squeal-${uid}/squeal-0123456789abcdef.sock`,
    );
  });

  it("falls back to /tmp/squeal-<uid> when the runtime dir would make the path too long to bind", () => {
    const long = `/home/agent/${"x".repeat(80)}`;
    expect(socketPathFor("0123456789abcdef", { XDG_RUNTIME_DIR: long })).toBe(
      `/tmp/squeal-${uid}/squeal-0123456789abcdef.sock`,
    );
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

describe("socket directory outside XDG_RUNTIME_DIR (review S8)", () => {
  // Short, so the socket path stays below the bind limit and no fallback applies.
  const tempDir = () => {
    const dir = realpathSync(mkdtempSync("/tmp/sq-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  };
  const socketIn = (tmp: string) => socketPathFor("0123456789abcdef", { TMPDIR: tmp });

  it("is created with mode 0700 and accepted again", () => {
    const tmp = tempDir();
    const socketPath = socketIn(tmp);
    prepareSocketDir(socketPath, { TMPDIR: tmp });
    const stat = statSync(join(tmp, `squeal-${uid}`));
    expect(stat.mode & 0o777).toBe(0o700);
    expect(stat.uid).toBe(uid);
    expect(() => prepareSocketDir(socketPath, { TMPDIR: tmp })).not.toThrow();
  });

  it("is refused when another user owns it", () => {
    const tmp = tempDir();
    prepareSocketDir(socketIn(tmp), { TMPDIR: tmp });
    // Without root no test can chown; the owner the check expects is what differs.
    expect(() => prepareSocketDir(socketIn(tmp), { TMPDIR: tmp }, uid + 1)).toThrow(
      new RegExp(`squeal-${uid} is owned by uid ${uid}, not ${uid + 1}; refusing to bind in it`),
    );
  });

  it("is refused when its mode lets others in, or when it is a symlink", () => {
    const tmp = tempDir();
    const dir = join(tmp, `squeal-${uid}`);
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    expect(() => prepareSocketDir(socketIn(tmp), { TMPDIR: tmp })).toThrow(
      /has mode 755, not 700; refusing to bind in it/,
    );
    rmSync(dir, { recursive: true });
    const elsewhere = tempDir();
    symlinkSync(elsewhere, dir);
    expect(() => checkPrivateDir(dir, uid)).toThrow(/is not a directory; refusing to bind in it/);
  });

  it("leaves XDG_RUNTIME_DIR as it is", () => {
    const xdg = tempDir();
    chmodSync(xdg, 0o755);
    const socketPath = socketPathFor("0123456789abcdef", { XDG_RUNTIME_DIR: xdg });
    expect(() => prepareSocketDir(socketPath, { XDG_RUNTIME_DIR: xdg })).not.toThrow();
  });
});
