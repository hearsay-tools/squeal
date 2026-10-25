import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clientGone, closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

// Row 011-220: a client that resets the connection before the stand-in answers, as a probe
// that timed out does, leaves no unhandled error behind.

const dirs: string[] = [];
afterEach(() => {
  closeFakeDaemons();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the CLI tests' stand-in daemon", () => {
  it("survives a client that resets its connection before the answer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-fake-daemon-"));
    dirs.push(dir);
    const path = join(dir, "d.sock");
    const errors: unknown[] = [];
    const onError = (error: unknown) => errors.push(error);
    process.on("uncaughtException", onError);
    try {
      await fakeDaemon(path, { ping: [{ ok: true, type: "ping" }] });
      const client = connect(path);
      // The client reads nothing, so the answer waits unread in its buffer, and closing then
      // resets the stand-in's side (a Unix socket closed with unread data does that on Linux).
      client.pause();
      await new Promise<void>((resolve) => client.once("connect", () => resolve()));
      client.write(`${JSON.stringify({ type: "ping" })}\n`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      client.destroy();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(errors).toEqual([]);
    } finally {
      process.off("uncaughtException", onError);
    }
  });

  it("throws any other socket error, so it fails the test that met it (review 0.1.322 S1)", () => {
    const error = (code: string) => Object.assign(new Error(`read ${code}`), { code });
    expect(() => clientGone(error("ECONNRESET"))).not.toThrow();
    expect(() => clientGone(error("EPIPE"))).not.toThrow();
    expect(() => clientGone(error("EIO"))).toThrow("read EIO");
  });
});
