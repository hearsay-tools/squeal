import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/core/daemon/front-desk.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { parentPort } from "node:worker_threads";

// src/core/daemon/handlers.ts
import { randomUUID } from "node:crypto";

// src/core/types/common.ts
var PAYLOAD_SCHEMA_VERSION = 1;

// src/core/types/store-records.ts
var CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1e3;
var WAITERLESS_EXPIRY_MS = 10 * 60 * 1e3;

// src/core/daemon/protocol.ts
var MAX_LINE_BYTES = 64 * 1024;
function parseRequest(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return "request is not valid JSON";
  }
  if (typeof value !== "object" || value === null) return "request is not a JSON object";
  const request = value;
  switch (request.type) {
    case "ping":
    case "nudge":
    case "stop":
      return { type: request.type };
    case "run-all":
      if (request.force !== void 0 && typeof request.force !== "boolean") {
        return '"force" must be true or false';
      }
      return { type: "run-all", force: request.force === true };
    case "run-all-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "run-all-status", requestId: request.requestId };
    default:
      return `unknown request type ${JSON.stringify(request.type)}`;
  }
}
function errorResponse(error) {
  return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: false, error };
}

// src/core/daemon/handlers.ts
var MAX_REQUESTS = 32;
function createHandlers(context) {
  const requests = /* @__PURE__ */ new Map();
  const runAll = (requestId, state) => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "run-all",
    requestId,
    checkpoint: state.checkpoint,
    error: state.error
  });
  return (request) => {
    switch (request.type) {
      case "ping":
        return {
          schemaVersion: PAYLOAD_SCHEMA_VERSION,
          ok: true,
          type: "ping",
          pid: process.pid,
          worktreeId: context.worktreeId,
          root: context.root,
          squealVersion: context.squealVersion,
          phase: context.phase(),
          startedAt: context.startedAt
        };
      case "nudge":
        context.onActivity();
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "nudge" };
      case "run-all": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        const requestId = randomUUID();
        const state = { checkpoint: null, error: null };
        requests.set(requestId, state);
        for (const old of requests.keys()) {
          if (requests.size <= MAX_REQUESTS) break;
          requests.delete(old);
        }
        context.requestFullSuite(request.force === true).then(
          (checkpoint) => {
            state.checkpoint = checkpoint;
          },
          (error) => {
            state.error = error instanceof Error ? error.message : String(error);
          }
        );
        return runAll(requestId, state);
      }
      case "run-all-status": {
        const state = requests.get(request.requestId);
        if (state === void 0) return errorResponse(`unknown request id ${request.requestId}`);
        return runAll(request.requestId, state);
      }
      case "stop":
        context.onStop();
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "stop" };
    }
  };
}

// src/core/daemon/server.ts
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join } from "node:path";
var IDLE_CONNECTION_MS = 2e3;
async function createDaemonServer(socketPath, handle) {
  mkdirSync(dirname(socketPath), { recursive: true, mode: 448 });
  const connections = /* @__PURE__ */ new Set();
  const server2 = createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    serve(socket, handle);
  });
  const bound = await bindAt(server2, socketPath);
  let closing = null;
  return {
    socketPath,
    close() {
      closing ??= new Promise((resolve) => {
        if (stillBound(socketPath, bound)) rmSync(socketPath, { force: true });
        server2.close(() => resolve());
        for (const socket of connections) socket.destroy();
      });
      return closing;
    }
  };
}
async function bindAt(server2, socketPath) {
  const name = `.${randomBytes(8).toString("hex")}`.slice(
    0,
    Math.max(2, basename(socketPath).length)
  );
  const staging = join(dirname(socketPath), name);
  await new Promise((resolve, reject) => {
    server2.once("error", reject);
    server2.listen(staging, () => {
      server2.off("error", reject);
      resolve();
    });
  });
  try {
    chmodSync(staging, 384);
    const { dev, ino } = statSync(staging);
    renameSync(staging, socketPath);
    return { dev, ino };
  } catch (error) {
    await new Promise((resolve) => server2.close(() => resolve()));
    throw error;
  }
}
function stillBound(socketPath, bound) {
  try {
    const { dev, ino } = statSync(socketPath);
    return dev === bound.dev && ino === bound.ino;
  } catch {
    return false;
  }
}
function serve(socket, handle) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.setTimeout(IDLE_CONNECTION_MS, () => socket.destroy());
  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk) => {
    buffer += chunk;
    const end = buffer.indexOf("\n");
    if (end < 0) {
      if (buffer.length > MAX_LINE_BYTES) answer(socket, errorResponse("request too long"));
      return;
    }
    const request = parseRequest(buffer.slice(0, end));
    buffer = "";
    if (typeof request === "string") {
      answer(socket, errorResponse(request));
      return;
    }
    let response;
    try {
      response = handle(request);
    } catch (error) {
      response = errorResponse(`daemon error: ${String(error)}`);
    }
    answer(socket, response);
  });
}
function answer(socket, response) {
  socket.removeAllListeners("data");
  socket.end(`${JSON.stringify(response)}
`);
}

// src/core/daemon/front-desk.ts
var port = parentPort;
if (port === null) throw new Error("squeal front desk: not a worker thread");
var post = (message) => port.postMessage(message);
var phase = "starting";
var waiting = /* @__PURE__ */ new Map();
var server = null;
function bind(identity) {
  const handle = createHandlers({
    worktreeId: identity.worktreeId,
    root: identity.root,
    squealVersion: identity.squealVersion,
    startedAt: identity.startedAt,
    phase: () => phase,
    requestFullSuite: (force) => new Promise((resolve, reject) => {
      const id = randomUUID2();
      waiting.set(id, { resolve, reject });
      post({ type: "run-all", id, force });
    }),
    onActivity: () => post({ type: "activity" }),
    onStop: () => post({ type: "stop" })
  });
  createDaemonServer(identity.socketPath, handle).then(
    (bound) => {
      server = bound;
      post({ type: "listening" });
    },
    (error) => post({ type: "failed", error: String(error) })
  );
}
port.on("message", (message) => {
  switch (message.type) {
    case "bind":
      bind(message.identity);
      return;
    case "phase":
      phase = message.phase;
      return;
    case "run-all-result": {
      const entry = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.checkpoint !== null) entry?.resolve(message.checkpoint);
      else entry?.reject(new Error(message.error ?? "run --all failed"));
      return;
    }
    case "close":
      phase = "stopping";
      void (server?.close() ?? Promise.resolve()).then(() => post({ type: "closed" }));
      return;
  }
});
