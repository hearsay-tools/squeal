import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { joinRequestAt, recordedAt } from "../../src/cli/status-at-join.js";
import type { AbsolutePath, RelativePath } from "../../src/core/types/common.js";

/*
 * Review wave-23 B1 on the join path of review wave-23 B2: `status --at
 * --wait` asks a daemon which requests it recorded (`ping`) and follows
 * each (`run-group-status`). A daemon that takes the connection and never
 * answers holds neither past the bound the call gives, here 300 ms; the
 * ping before the repair waited the CLI's whole socket bound (2 s).
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A socket that accepts every connection and answers none. */
async function silentDaemon(): Promise<AbsolutePath> {
  const dir = mkdtempSync(join(tmpdir(), "at-join-"));
  const path = join(dir, "d.sock") as AbsolutePath;
  const open: Socket[] = [];
  const server: Server = createServer((socket) => {
    open.push(socket);
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => resolve());
      }),
  );
  return path;
}

const timed = async <T>(work: () => Promise<T>) => {
  const began = Date.now();
  const value = await work();
  return { value, ms: Date.now() - began };
};

describe("status --at --wait's daemon reads end by the call's bound (review wave-23 B1, B2)", () => {
  it("gives up the recorded-requests ping at the bound", async () => {
    const socket = await silentDaemon();
    const { value, ms } = await timed(() => recordedAt(socket, Date.now() + 300));
    expect(value).toEqual([]);
    expect(ms).toBeLessThan(1500);
  });

  it("gives up following a recorded request at the bound", async () => {
    const socket = await silentDaemon();
    const request = { requestId: "r1", group: "tests", paths: ["test/a.test.ts" as RelativePath] };
    const { value, ms } = await timed(() => joinRequestAt(socket, request, Date.now() + 300));
    expect(value).toEqual({ problem: "the daemon did not answer before the deadline" });
    expect(ms).toBeLessThan(1500);
  });
});
