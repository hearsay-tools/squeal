import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/core/daemon/front-desk.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { parentPort } from "node:worker_threads";

// src/core/daemon/handlers.ts
import { randomUUID } from "node:crypto";

// src/core/types/common.ts
var PAYLOAD_SCHEMA_VERSION = 1;

// src/core/types/daemon.ts
function daemonIncarnation(daemon) {
  if (daemon?.token === void 0) return null;
  return `${daemon.squealVersion}@${daemon.startedAt}#${daemon.token}`;
}

// src/core/types/store-records.ts
var CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1e3;
var HOOK_TIMEOUT_MS = 2e3;
var LEAVING_GRACE_MS = 5 * HOOK_TIMEOUT_MS;
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
    case "retry":
    case "run-slow":
    case "stop":
    case "hold":
    case "resume":
      return { type: request.type };
    // An older CLI's `after` and `resolvedSince` are ignored (task 001-258).
    case "sync":
      return { type: "sync" };
    case "run-all":
      if (request.force !== void 0 && typeof request.force !== "boolean") {
        return '"force" must be true or false';
      }
      if (request.observeIgnored !== void 0 && typeof request.observeIgnored !== "boolean") {
        return '"observeIgnored" must be true or false';
      }
      if (request.lane !== void 0 && request.lane !== "fast" && request.lane !== "slow") {
        return '"lane" must be "fast" or "slow"';
      }
      return {
        type: "run-all",
        force: request.force === true,
        ...request.observeIgnored === true ? { observeIgnored: true } : {},
        ...request.lane === void 0 ? {} : { lane: request.lane }
      };
    case "step-down":
      if (typeof request.version !== "string") return '"version" must be a string';
      return { type: "step-down", version: request.version };
    case "run-all-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "run-all-status", requestId: request.requestId };
    case "run-slow-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "run-slow-status", requestId: request.requestId };
    case "sync-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "sync-status", requestId: request.requestId };
    case "hold-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "hold-status", requestId: request.requestId };
    case "promote": {
      const { testFiles, withinMs } = request;
      if (!Array.isArray(testFiles) || !testFiles.every(isTestFileRef)) {
        return '"testFiles" must be a list of { project, path } strings';
      }
      if (typeof withinMs !== "number" || !Number.isFinite(withinMs) || withinMs < 0) {
        return '"withinMs" must be a number of milliseconds';
      }
      const refs = testFiles.map(({ project, path }) => ({ project, path }));
      return { type: "promote", testFiles: refs, withinMs };
    }
    case "focus": {
      const { testFiles, texts, withinMs } = request;
      if (!Array.isArray(testFiles) || !testFiles.every(isTestFileRef)) {
        return '"testFiles" must be a list of { project, path } strings';
      }
      if (!Array.isArray(texts) || texts.length === 0 || !texts.every(isText)) {
        return '"texts" must be a list of non-empty strings';
      }
      if (typeof withinMs !== "number" || !Number.isFinite(withinMs) || withinMs < 0) {
        return '"withinMs" must be a number of milliseconds';
      }
      const refs = testFiles.map(({ project, path }) => ({ project, path }));
      return { type: "focus", testFiles: refs, texts: [...texts], withinMs };
    }
    default:
      return `unknown request type ${JSON.stringify(request.type)}`;
  }
}
function isTestFileRef(value) {
  if (typeof value !== "object" || value === null) return false;
  const { project, path } = value;
  return typeof project === "string" && typeof path === "string";
}
function isText(value) {
  return typeof value === "string" && value.length > 0;
}
function errorResponse(error) {
  return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: false, error };
}

// src/core/daemon/run-slow.ts
var SLOW_NOT_SUPPORTED = "run --slow is not supported by this daemon";

// src/core/daemon/version.ts
function isNewerVersion(version, than) {
  const a = versionParts(version);
  const b = versionParts(than);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}
function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match === null ? null : match.slice(1).map(Number);
}

// src/core/daemon/handlers.ts
var MAX_REQUESTS = 32;
function createHandlers(context) {
  const requests = /* @__PURE__ */ new Map();
  const slowRequests = /* @__PURE__ */ new Map();
  const syncRequests = /* @__PURE__ */ new Map();
  const holdRequests = /* @__PURE__ */ new Map();
  const runAll = (requestId, state) => {
    const answer2 = {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      ok: true,
      type: "run-all",
      requestId,
      error: state.error
    };
    if (state.checkpoint === null) return { ...answer2, checkpoint: null };
    const { owner, ...checkpoint } = state.checkpoint;
    return { ...answer2, checkpoint, owner };
  };
  const runSlow = (requestId, state) => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "run-slow",
    requestId,
    requested: state.requested,
    error: state.error
  });
  const sync = (requestId, state) => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "sync",
    requestId,
    revision: state.revision,
    error: state.error,
    moves: true,
    incarnation: daemonIncarnation(context)
  });
  const hold = (requestId, state) => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "hold",
    requestId,
    settled: state.holding !== null || state.error !== null,
    holding: state.holding,
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
        context.onNudge?.();
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "nudge" };
      case "retry":
        context.onActivity();
        context.requestRetries?.().catch(() => {
        });
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "retry" };
      case "run-all": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        const requestId = randomUUID();
        const state = { checkpoint: null, error: null };
        remember(requests, requestId, state);
        const full = {
          force: request.force === true,
          observeIgnored: request.observeIgnored === true,
          ...request.lane === void 0 ? {} : { lane: request.lane }
        };
        context.requestFullSuite(full).then(
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
      case "run-slow": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        const requestId = randomUUID();
        const state = { requested: null, error: null };
        remember(slowRequests, requestId, state);
        const request2 = context.requestSlowSuite?.() ?? Promise.reject(new Error(SLOW_NOT_SUPPORTED));
        request2.then(
          (requested) => {
            state.requested = requested;
          },
          (error) => {
            state.error = error instanceof Error ? error.message : String(error);
          }
        );
        return runSlow(requestId, state);
      }
      case "run-slow-status": {
        const state = slowRequests.get(request.requestId);
        if (state === void 0) return errorResponse(`unknown request id ${request.requestId}`);
        return runSlow(request.requestId, state);
      }
      case "sync": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        if (context.requestSync === void 0) return errorResponse("this daemon cannot sync");
        context.onActivity();
        const requestId = randomUUID();
        const state = { revision: null, error: null };
        remember(syncRequests, requestId, state);
        context.requestSync().then(
          (answer2) => {
            state.revision = answer2.revision;
          },
          (error) => {
            state.error = error instanceof Error ? error.message : String(error);
          }
        );
        return sync(requestId, state);
      }
      case "sync-status": {
        const state = syncRequests.get(request.requestId);
        if (state === void 0) return errorResponse(`unknown request id ${request.requestId}`);
        return sync(request.requestId, state);
      }
      case "hold": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        if (context.requestHold === void 0) return errorResponse("this daemon cannot hold");
        const requestId = randomUUID();
        const state = { holding: null, error: null };
        remember(holdRequests, requestId, state);
        context.requestHold().then(
          (holding) => {
            state.holding = holding;
          },
          (error) => {
            state.error = error instanceof Error ? error.message : String(error);
          }
        );
        return hold(requestId, state);
      }
      case "hold-status": {
        const state = holdRequests.get(request.requestId);
        if (state === void 0) return errorResponse(`unknown request id ${request.requestId}`);
        return hold(request.requestId, state);
      }
      case "resume":
        if (context.requestResume === void 0) return errorResponse("this daemon cannot hold");
        context.requestResume().catch(() => {
        });
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "resume" };
      case "promote":
        if (context.requestPromotion === void 0)
          return errorResponse("this daemon cannot promote");
        context.onActivity();
        context.requestPromotion(request.testFiles, request.withinMs).catch(() => {
        });
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "promote" };
      case "focus":
        if (context.requestFocus === void 0) return errorResponse("this daemon cannot focus");
        context.onActivity();
        context.requestFocus(request.testFiles, request.texts, request.withinMs).catch(() => {
        });
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "focus" };
      case "stop":
        context.onStop();
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "stop" };
      case "step-down": {
        const steppingDown = isNewerVersion(request.version, context.squealVersion);
        if (steppingDown) context.onStepDown(request.version);
        return {
          schemaVersion: PAYLOAD_SCHEMA_VERSION,
          ok: true,
          type: "step-down",
          squealVersion: context.squealVersion,
          steppingDown
        };
      }
    }
  };
}
function remember(requests, requestId, state) {
  requests.set(requestId, state);
  for (const old of requests.keys()) {
    if (requests.size <= MAX_REQUESTS) break;
    requests.delete(old);
  }
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
var waitingSlow = /* @__PURE__ */ new Map();
var waitingSync = /* @__PURE__ */ new Map();
var waitingHold = /* @__PURE__ */ new Map();
var server = null;
function bind(identity) {
  const handle = createHandlers({
    worktreeId: identity.worktreeId,
    root: identity.root,
    squealVersion: identity.squealVersion,
    startedAt: identity.startedAt,
    token: identity.token,
    phase: () => phase,
    requestFullSuite: (request) => new Promise((resolve, reject) => {
      const id = randomUUID2();
      waiting.set(id, { resolve, reject });
      post({ type: "run-all", id, request });
    }),
    requestSlowSuite: () => new Promise((resolve, reject) => {
      const id = randomUUID2();
      waitingSlow.set(id, { resolve, reject });
      post({ type: "run-slow", id });
    }),
    requestSync: () => new Promise((resolve, reject) => {
      const id = randomUUID2();
      waitingSync.set(id, { resolve, reject });
      post({ type: "sync", id });
    }),
    requestHold: () => new Promise((resolve, reject) => {
      const id = randomUUID2();
      waitingHold.set(id, { resolve, reject });
      post({ type: "hold", id });
    }),
    requestResume: async () => post({ type: "resume" }),
    onActivity: () => post({ type: "activity" }),
    onNudge: () => post({ type: "nudge" }),
    requestRetries: async () => post({ type: "retry" }),
    requestPromotion: async (testFiles, withinMs) => post({ type: "promote", testFiles, withinMs }),
    requestFocus: async (testFiles, texts, withinMs) => post({ type: "focus", testFiles, texts, withinMs }),
    onStop: () => post({ type: "stop" }),
    onStepDown: (version) => post({ type: "step-down", version })
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
  try {
    receive(message);
  } catch (error) {
    console.error(`squeal front desk: ${String(error)}`);
  }
});
function receive(message) {
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
    case "run-slow-result": {
      const entry = waitingSlow.get(message.id);
      waitingSlow.delete(message.id);
      if (message.requested !== null) entry?.resolve(message.requested);
      else entry?.reject(new Error(message.error ?? "run --slow failed"));
      return;
    }
    case "sync-result": {
      const entry = waitingSync.get(message.id);
      waitingSync.delete(message.id);
      if (message.answer !== null) entry?.resolve(message.answer);
      else entry?.reject(new Error(message.error ?? "sync failed"));
      return;
    }
    case "hold-result": {
      const entry = waitingHold.get(message.id);
      waitingHold.delete(message.id);
      if (message.holding !== null) entry?.resolve(message.holding);
      else entry?.reject(new Error(message.error ?? "hold failed"));
      return;
    }
    case "close":
      phase = "stopping";
      void (server?.close() ?? Promise.resolve()).catch((error) => console.error(`squeal front desk: ${String(error)}`)).then(() => post({ type: "closed" }));
      return;
  }
}
