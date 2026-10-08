import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandlers } from "../../src/core/daemon/handlers.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import { isNewerVersion, squealVersion } from "../../src/core/daemon/version.js";
import type { DaemonRecord, DaemonRequest } from "../../src/core/types/index.js";
import { SOCKET_TIMEOUT_MS, stepDownIfOlder } from "../../src/harness/shared/ensure.js";

/*
 * Lessons, defect 26: a hook newer than the daemon asks it to step down;
 * an equal or newer daemon is left alone, and a daemon from before the
 * request is sent `stop`. Against stand-in sockets; `test/daemon/step-down`
 * runs real daemons.
 */

let dir: string;
const servers: Server[] = [];
beforeEach(() => {
  dir = mkdtempSync("/tmp/sq-");
});
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A socket answering each request with `answer`, recording what it was asked. */
async function daemonAt(answer: (request: DaemonRequest) => object): Promise<{
  socketPath: string;
  asked: DaemonRequest[];
}> {
  const socketPath = join(dir, "d.sock");
  const asked: DaemonRequest[] = [];
  const server = createServer((socket) => {
    socket.once("data", (chunk) => {
      const request = JSON.parse(chunk.toString("utf8")) as DaemonRequest;
      asked.push(request);
      socket.end(`${JSON.stringify({ schemaVersion: 1, ...answer(request) })}\n`);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return { socketPath, asked };
}

function record(socketPath: string, squealVersion: string, heartbeatAt = Date.now()): DaemonRecord {
  return { socketPath, startedAt: 1, heartbeatAt, heartbeatIntervalMs: 5_000, squealVersion };
}

const current = (request: DaemonRequest) =>
  request.type === "step-down"
    ? { ok: true, type: "step-down", squealVersion: "0.1.0", steppingDown: true }
    : { ok: true, type: request.type };

describe("isNewerVersion", () => {
  it("compares major, minor and patch numerically", () => {
    expect(isNewerVersion("0.1.32", "0.1.24")).toBe(true);
    expect(isNewerVersion("0.1.10", "0.1.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.1.99")).toBe(true);
  });

  it("is false for an equal or older version", () => {
    expect(isNewerVersion("0.1.32", "0.1.32")).toBe(false);
    expect(isNewerVersion("0.1.24", "0.1.32")).toBe(false);
  });

  it("is false when either side is not plain major.minor.patch", () => {
    expect(isNewerVersion("0.0.0-unknown", "0.0.0")).toBe(false);
    expect(isNewerVersion("0.1.32", "0.0.0-unknown")).toBe(false);
    expect(isNewerVersion("0.1.32", "0.1.31-rc.1")).toBe(false);
    expect(isNewerVersion("x", "0.1.0")).toBe(false);
  });
});

describe("stepDownIfOlder (hook side)", () => {
  it("asks an older daemon with a fresh heartbeat to step down, with the hook's version", async () => {
    const d = await daemonAt(current);
    expect(await stepDownIfOlder(record(d.socketPath, "0.1.24"), Date.now(), "0.1.31")).toBe(true);
    expect(d.asked).toEqual([{ type: "step-down", version: "0.1.31" }]);
  });

  it("uses the hook's own version by default", async () => {
    const d = await daemonAt(current);
    await stepDownIfOlder(record(d.socketPath, "0.0.1"), Date.now());
    expect(d.asked).toEqual([{ type: "step-down", version: squealVersion() }]);
  });

  it("asks nothing of an equal or newer daemon (a downgrade stays a no-op)", async () => {
    const d = await daemonAt(current);
    expect(await stepDownIfOlder(record(d.socketPath, "0.1.31"), Date.now(), "0.1.31")).toBe(false);
    expect(await stepDownIfOlder(record(d.socketPath, "0.2.0"), Date.now(), "0.1.31")).toBe(false);
    expect(d.asked).toEqual([]);
  });

  it("asks nothing of a daemon whose heartbeat is past grace, or of no daemon", async () => {
    const d = await daemonAt(current);
    const stale = record(d.socketPath, "0.1.0", Date.now() - 60_000);
    expect(await stepDownIfOlder(stale, Date.now(), "0.1.31")).toBe(false);
    expect(await stepDownIfOlder(null, Date.now(), "0.1.31")).toBe(false);
    expect(d.asked).toEqual([]);
  });

  it("asks nothing while another session registered with an older version, or with none", async () => {
    const d = await daemonAt(current);
    const older = record(d.socketPath, "0.1.24");
    for (const others of [["0.1.30"], [null], ["0.1.31", null], ["0.0.0-unknown"]]) {
      expect(await stepDownIfOlder(older, Date.now(), "0.1.31", others)).toBe(false);
    }
    expect(d.asked).toEqual([]);
    expect(await stepDownIfOlder(older, Date.now(), "0.1.31", ["0.1.31", "0.2.0"])).toBe(true);
    expect(d.asked).toHaveLength(1);
  });

  it("is false when the daemon answers that it keeps running", async () => {
    const d = await daemonAt(() => ({
      ok: true,
      type: "step-down",
      squealVersion: "0.1.40",
      steppingDown: false,
    }));
    expect(await stepDownIfOlder(record(d.socketPath, "0.1.24"), Date.now(), "0.1.31")).toBe(false);
  });

  it("sends stop to a daemon from before the request", async () => {
    // What a 0.1.32 daemon answers: protocol.ts before this row.
    const d = await daemonAt((request) =>
      request.type === "stop"
        ? { ok: true, type: "stop" }
        : { ok: false, error: `unknown request type ${JSON.stringify(request.type)}` },
    );
    expect(await stepDownIfOlder(record(d.socketPath, "0.1.24"), Date.now(), "0.1.31")).toBe(true);
    expect(d.asked).toEqual([{ type: "step-down", version: "0.1.31" }, { type: "stop" }]);
  });

  it("sends no stop for any other error, and never throws on a socket that is gone", async () => {
    const d = await daemonAt(() => ({ ok: false, error: "daemon error: boom" }));
    expect(await stepDownIfOlder(record(d.socketPath, "0.1.0"), Date.now(), "0.1.31")).toBe(false);
    expect(d.asked).toHaveLength(1);
    const gone = record(join(dir, "gone.sock"), "0.1.0");
    expect(await stepDownIfOlder(gone, Date.now(), "0.1.31")).toBe(false);
  });
});

describe("the hook's budget", () => {
  it("gives up on a daemon that accepts and never answers within the socket timeout", async () => {
    const socketPath = join(dir, "hung.sock");
    const server = createServer(() => {});
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    const at = performance.now();
    expect(await stepDownIfOlder(record(socketPath, "0.1.0"), Date.now(), "0.1.31")).toBe(false);
    expect(performance.now() - at).toBeLessThan(SOCKET_TIMEOUT_MS + 400);
  });
});

describe("the step-down request (daemon side)", () => {
  function handler(version: string) {
    const steps: string[] = [];
    const handle = createHandlers({
      worktreeId: "0123456789abcdef" as never,
      root: "/" as never,
      squealVersion: version,
      startedAt: 1 as never,
      phase: () => "ready",
      requestFullSuite: () => new Promise(() => {}),
      onActivity: () => {},
      onStop: () => steps.push("stop"),
      onStepDown: (v) => steps.push(v),
    });
    return { handle, steps };
  }

  it("parses only with a string version", () => {
    expect(parseRequest('{"type":"step-down","version":"0.1.33"}')).toEqual({
      type: "step-down",
      version: "0.1.33",
    });
    expect(parseRequest('{"type":"step-down"}')).toBe('"version" must be a string');
  });

  it("steps down for a strictly newer hook and answers with its own version", () => {
    const { handle, steps } = handler("0.1.31");
    expect(handle({ type: "step-down", version: "0.1.33" })).toMatchObject({
      ok: true,
      type: "step-down",
      squealVersion: "0.1.31",
      steppingDown: true,
    });
    expect(steps).toEqual(["0.1.33"]);
  });

  it("keeps running for an equal, older or unparsable hook version", () => {
    const { handle, steps } = handler("0.1.31");
    for (const version of ["0.1.31", "0.1.30", "0.0.0-unknown"]) {
      expect(handle({ type: "step-down", version })).toMatchObject({ steppingDown: false });
    }
    expect(steps).toEqual([]);
  });
});
