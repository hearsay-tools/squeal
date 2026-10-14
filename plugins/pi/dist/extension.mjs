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
  const settle = (id, answer) => {
    const call = pending.get(id);
    if (call === void 0) return;
    pending.delete(id);
    clearTimeout(call.timer);
    call.resolve(answer);
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
    started.on("message", (message2) => {
      if (worker === started) settle(message2.id, message2.ok ? message2.answer : null);
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
var SETTLE_DEADLINE_MS = 2e3;
var END_TURN_DEADLINE_MS = EVENT_DEADLINE_MS;
var CUSTOM_TYPE = "squeal";
var PRIMER_SECTION = "squeal";
var PRIMER_SECTION_CAP_CHARS = 8e3;
var READ_ONLY_TOOLS = /* @__PURE__ */ new Set(["read", "grep", "find", "ls"]);
var ASKED_TOOLS = /* @__PURE__ */ new Set(["edit", "write", "bash"]);
function sessionOf(ctx) {
  try {
    return { sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd };
  } catch {
    return null;
  }
}
var message = (content) => ({
  customType: CUSTOM_TYPE,
  content,
  display: true
});
var entry = (content) => ({
  type: "custom_message",
  ...message(content)
});
function squealExtension(start) {
  return (pi) => {
    let host = null;
    let shutDown = false;
    const started = /* @__PURE__ */ new Set();
    let continued = false;
    let ended = false;
    let lastPrimer = null;
    const ask = async (ctx, request, deadlineMs) => {
      try {
        const session = sessionOf(ctx);
        if (shutDown || host === null || session === null) return null;
        const answer = await host.call({ ...request, ...session }, deadlineMs);
        return shutDown ? null : answer;
      } catch {
        return null;
      }
    };
    const startRun = () => {
      continued = false;
      ended = false;
    };
    pi.on("session_start", async (event, ctx) => {
      try {
        const session = sessionOf(ctx);
        if (shutDown || session === null || started.has(session.sessionId)) return;
        started.add(session.sessionId);
        host ??= createDeliveryHost(start);
        const text = await ask(ctx, { kind: "start", reason: event.reason }, EVENT_DEADLINE_MS);
        if (text === null) return;
        pi.sendMessage(message(text), { deliverAs: "nextTurn" });
      } catch {
      }
    });
    pi.on("input", () => {
      startRun();
      return void 0;
    });
    pi.on("before_agent_start", async (event, ctx) => {
      startRun();
      const answer = await ask(ctx, { kind: "run" }, EVENT_DEADLINE_MS);
      try {
        lastPrimer = answer?.primer ?? lastPrimer;
        if (lastPrimer !== null && !shutDown) {
          event.systemPromptOptions.sections[PRIMER_SECTION] = lastPrimer.slice(
            0,
            PRIMER_SECTION_CAP_CHARS
          );
        }
      } catch {
      }
      return answer?.news == null ? void 0 : { message: message(answer.news) };
    });
    pi.on("turn_end", async (event, ctx) => {
      const tools = event.toolResults.map((result) => result.toolName);
      if (tools.length === 0) return void 0;
      const edited = tools.some((name) => !READ_ONLY_TOOLS.has(name));
      const text = await ask(ctx, { kind: "boundary", edited }, EVENT_DEADLINE_MS);
      return text === null ? void 0 : { entries: [entry(text)] };
    });
    pi.on("tool_call", async (event, ctx) => {
      if (!ASKED_TOOLS.has(event.toolName)) return void 0;
      const input = event.input;
      const command = event.toolName === "bash" && typeof input.command === "string" ? { command: input.command } : {};
      const reason = await ask(
        ctx,
        { kind: "toolCall", toolName: event.toolName, ...command },
        EVENT_DEADLINE_MS
      );
      return reason === null ? void 0 : { block: true, reason };
    });
    pi.on("agent_before_settle", async (event, ctx) => {
      if (continued || ended || event.outcome !== "completed") return void 0;
      const answer = await ask(ctx, { kind: "settle" }, SETTLE_DEADLINE_MS);
      if (answer === null) return void 0;
      if (answer.report === null) {
        ended = true;
        return void 0;
      }
      continued = true;
      return { entries: [entry(answer.report)], continue: true };
    });
    pi.on("agent_settled", async (_event, ctx) => {
      if (ended) return;
      ended = true;
      await ask(ctx, { kind: "endTurn" }, END_TURN_DEADLINE_MS);
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
