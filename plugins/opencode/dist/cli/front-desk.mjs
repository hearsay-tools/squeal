import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/core/daemon/front-desk.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { parentPort } from "node:worker_threads";

// src/core/daemon/handlers.ts
import { randomUUID as randomUUID2 } from "node:crypto";

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
      return parseSync(request.paths);
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
    case "run-group":
      if (!isText(request.group)) return '"group" must be a non-empty string';
      return { type: "run-group", group: request.group };
    case "run-group-paths":
      return parseGroupPaths(request.group, request.paths);
    case "run-group-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "run-group-status", requestId: request.requestId };
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
function parseSync(paths) {
  if (paths === void 0) return { type: "sync" };
  if (!Array.isArray(paths) || !paths.every(isText)) {
    return '"paths" must be a list of non-empty strings';
  }
  return { type: "sync", paths: [...paths] };
}
function parseGroupPaths(group, paths) {
  if (!isText(group)) return '"group" must be a non-empty string';
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every(isText)) {
    return '"paths" must be a non-empty list of non-empty strings';
  }
  return { type: "run-group-paths", group, paths: [...paths] };
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

// src/core/daemon/run-group.ts
import { randomUUID } from "node:crypto";
var GROUP_NOT_SUPPORTED = "squeal run <group> is not supported by this daemon, which predates check groups; `squeal stop`, then `squeal start`, starts the installed version";
var NARROW_NOT_SUPPORTED = "squeal run <group> <path>... is not supported by this daemon, which predates narrow runs, and it ran nothing; `squeal stop`, then `squeal start`, starts the installed version";
var MainSteps = class {
  #running = /* @__PURE__ */ new Map();
  set(operation, since) {
    if (since === null) this.#running.delete(operation);
    else this.#running.set(operation, since);
  }
  current() {
    let oldest = null;
    for (const [operation, since] of this.#running) {
      if (oldest === null || since < oldest.since) oldest = { operation, since };
    }
    return oldest;
  }
};
function groupRequests(requestGroup, max, step = () => null, now = Date.now) {
  const requests = /* @__PURE__ */ new Map();
  const holderOf = (request) => {
    const { held } = request;
    if (request.requested !== null || request.unknown || request.error !== null) return null;
    const at = now();
    const since = (from) => Math.max(0, at - from);
    const running = step();
    const stepped = {
      step: running === null ? null : { operation: running.operation, heldMs: since(running.since) }
    };
    if (held === void 0) return { kind: "unanswered", heldMs: since(request.at), ...stepped };
    if (held === null) return { kind: "unknown", ...stepped };
    if (held.kind === "startup") return { kind: "startup", heldMs: since(held.since), ...stepped };
    const { operation } = held;
    return { kind: "scheduler", operation, heldMs: since(held.since), ...stepped };
  };
  const answer2 = (requestId, request) => {
    const { requested } = request;
    return {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      ok: true,
      type: "run-group",
      requestId,
      group: request.group,
      requested: requested === null ? null : { revision: requested.revision, queued: requested.queued },
      unknown: request.unknown,
      error: request.error,
      holder: holderOf(request),
      ...requested?.narrow === void 0 ? {} : { narrow: requested.narrow }
    };
  };
  return {
    start(group, paths) {
      const requestId = randomUUID();
      const request = {
        group,
        at: now(),
        requested: null,
        unknown: false,
        error: null,
        held: void 0
      };
      requests.set(requestId, request);
      for (const old of requests.keys()) {
        if (requests.size <= max) break;
        requests.delete(old);
      }
      const held = (holder) => {
        request.held = holder;
      };
      const missing = new Error(paths === void 0 ? GROUP_NOT_SUPPORTED : NARROW_NOT_SUPPORTED);
      (requestGroup?.(group, held, paths) ?? Promise.reject(missing)).then(
        (requested) => {
          if (requested === null) request.unknown = true;
          else request.requested = requested;
        },
        (error) => {
          request.error = error instanceof Error ? error.message : String(error);
        }
      );
      return answer2(requestId, request);
    },
    status(requestId) {
      const request = requests.get(requestId);
      return request === void 0 ? null : answer2(requestId, request);
    }
  };
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
  const groups = groupRequests(context.requestGroup, MAX_REQUESTS, context.mainStep);
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
    incarnation: daemonIncarnation(context),
    ...state.readers === null ? {} : { readers: state.readers }
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
        const requestId = randomUUID2();
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
        const requestId = randomUUID2();
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
      case "run-group":
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        return groups.start(request.group);
      case "run-group-paths":
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        return groups.start(request.group, request.paths);
      case "run-group-status":
        return groups.status(request.requestId) ?? errorResponse(`unknown request id ${request.requestId}`);
      case "sync": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        if (context.requestSync === void 0) return errorResponse("this daemon cannot sync");
        context.onActivity();
        const requestId = randomUUID2();
        const state = { revision: null, readers: null, error: null };
        remember(syncRequests, requestId, state);
        context.requestSync(request.paths).then(
          (answer2) => {
            state.revision = answer2.revision;
            state.readers = answer2.readers ?? null;
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
        const requestId = randomUUID2();
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
var waitingGroup = /* @__PURE__ */ new Map();
var steps = new MainSteps();
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
      const id = randomUUID3();
      waiting.set(id, { resolve, reject });
      post({ type: "run-all", id, request });
    }),
    requestSlowSuite: () => new Promise((resolve, reject) => {
      const id = randomUUID3();
      waitingSlow.set(id, { resolve, reject });
      post({ type: "run-slow", id });
    }),
    requestGroup: (group, held, paths) => new Promise((resolve, reject) => {
      const id = randomUUID3();
      waitingGroup.set(id, { resolve, reject, held });
      post({ type: "run-group", id, group, ...paths === void 0 ? {} : { paths } });
    }),
    mainStep: () => steps.current(),
    requestSync: (paths) => new Promise((resolve, reject) => {
      const id = randomUUID3();
      waitingSync.set(id, { resolve, reject });
      post({ type: "sync", id, ...paths === void 0 ? {} : { paths } });
    }),
    requestHold: () => new Promise((resolve, reject) => {
      const id = randomUUID3();
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
    case "run-group-result": {
      const entry = waitingGroup.get(message.id);
      waitingGroup.delete(message.id);
      if (message.error === null) entry?.resolve(message.requested);
      else entry?.reject(new Error(message.error));
      return;
    }
    case "run-group-held":
      waitingGroup.get(message.id)?.held(message.holder);
      return;
    case "main-step":
      steps.set(message.operation, message.since);
      return;
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
