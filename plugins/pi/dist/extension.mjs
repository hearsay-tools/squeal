import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/harness/pi/entries/extension.ts
import { Worker } from "node:worker_threads";

// src/harness/pi/host.ts
function createDeliveryHost(start) {
  let worker = null;
  let stopped = false;
  let next = 1;
  const pending = /* @__PURE__ */ new Map();
  const settle = (id, text) => {
    const call = pending.get(id);
    if (call === void 0) return;
    pending.delete(id);
    clearTimeout(call.timer);
    call.resolve(text);
  };
  const discard = (dead) => {
    if (worker !== dead) return;
    worker = null;
    dead.terminate().catch(() => {
    });
    for (const id of [...pending.keys()]) settle(id, null);
  };
  const current = () => {
    if (worker !== null) return worker;
    const started = start();
    started.on("message", (message) => {
      if (worker === started) settle(message.id, message.ok ? message.text : null);
    });
    started.on("error", () => discard(started));
    started.on("exit", () => discard(started));
    started.on("messageerror", () => {
    });
    started.unref();
    worker = started;
    return started;
  };
  return {
    call(request, deadlineMs) {
      if (stopped) return Promise.resolve(null);
      return new Promise((resolve) => {
        let target;
        try {
          target = current();
        } catch {
          target = null;
        }
        if (target === null) return resolve(null);
        const id = next++;
        const timer = setTimeout(() => {
          settle(id, null);
          discard(target);
        }, deadlineMs);
        pending.set(id, { resolve, timer });
        try {
          target.postMessage({ id, request });
        } catch {
          settle(id, null);
        }
      });
    },
    stop() {
      stopped = true;
      if (worker !== null) discard(worker);
    }
  };
}

// src/harness/pi/extension.ts
var EVENT_DEADLINE_MS = 2e3;
var SHUTDOWN_DEADLINE_MS = 3e3;
var CUSTOM_TYPE = "squeal";
function sessionOf(ctx) {
  try {
    return { sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd };
  } catch {
    return null;
  }
}
function squealExtension(start) {
  return (pi) => {
    let host = null;
    let shutDown = false;
    const started = /* @__PURE__ */ new Set();
    pi.on("session_start", async (event, ctx) => {
      try {
        const session = sessionOf(ctx);
        if (shutDown || session === null || started.has(session.sessionId)) return;
        started.add(session.sessionId);
        host ??= createDeliveryHost(start);
        const text = await host.call(
          { kind: "start", reason: event.reason, ...session },
          EVENT_DEADLINE_MS
        );
        if (text === null || shutDown) return;
        pi.sendMessage(
          { customType: CUSTOM_TYPE, content: text, display: true },
          { deliverAs: "nextTurn" }
        );
      } catch {
      }
    });
    pi.on("session_shutdown", async (event, ctx) => {
      if (shutDown) return;
      shutDown = true;
      const running = host;
      host = null;
      if (running === null) return;
      try {
        const session = sessionOf(ctx);
        if (event.reason !== "reload" && session !== null) {
          await running.call({ kind: "shutdown", ...session }, SHUTDOWN_DEADLINE_MS);
        }
      } catch {
      } finally {
        running.stop();
      }
    });
  };
}

// src/harness/pi/entries/extension.ts
var extension_default = squealExtension(() => new Worker(new URL("./worker.mjs", import.meta.url)));
export {
  extension_default as default
};
