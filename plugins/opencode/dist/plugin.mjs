// src/harness/opencode/hooks.ts
import { delimiter, resolve } from "node:path";

// src/harness/opencode/arrivals.ts
var KEY = /* @__PURE__ */ Symbol.for("squeal.opencode.arrivals");
var scope = globalThis;
scope[KEY] ??= /* @__PURE__ */ new Map();
var counts = scope[KEY];
function arrived(id) {
  counts.set(id, (counts.get(id) ?? 0) + 1);
}
function arrivals(id) {
  return counts.get(id) ?? 0;
}

// src/harness/opencode/bridge-client.ts
import { spawn } from "node:child_process";
var EXIT_DRAIN_MS = 50;
var PROXY_SWITCH = "NODE_USE_ENV_PROXY";
var CARRIED_SWITCH = "SQUEAL_CARRIED_NODE_USE_ENV_PROXY";
var RESTORE_SWITCH = `data:text/javascript,process.env.${PROXY_SWITCH}=process.env.${CARRIED_SWITCH};delete process.env.${CARRIED_SWITCH}`;
function bridgeStart(entry, env) {
  const flags = ["--disable-warning=ExperimentalWarning"];
  const value = env[PROXY_SWITCH];
  if (value === void 0) return { args: [...flags, entry], env };
  const { [PROXY_SWITCH]: _switch, ...rest } = env;
  return {
    args: [...flags, "--import", RESTORE_SWITCH, entry],
    env: { ...rest, [CARRIED_SWITCH]: value }
  };
}
function unrefPipe(pipe) {
  const unref = pipe?.unref;
  if (typeof unref === "function") unref.call(pipe);
}
function callBridge(command, event, cwd, deadlineMs, options = {}) {
  return new Promise((resolve2) => {
    if (options.signal?.aborted) return resolve2(null);
    let settled = false;
    const out = [];
    let child;
    try {
      const start = bridgeStart(command.entry, process.env);
      child = spawn(command.node, start.args, {
        cwd,
        env: start.env,
        detached: true,
        stdio: ["pipe", "pipe", "ignore"]
      });
    } catch {
      resolve2(null);
      return;
    }
    let code = null;
    const killGroup = () => {
      if (child.pid === void 0) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
      }
    };
    const settle = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drain);
      options.signal?.removeEventListener("abort", cancel);
      if (code === null) killGroup();
      child.stdout?.destroy();
      child.stdin?.destroy();
      child.unref();
      resolve2(answer);
    };
    const answered = () => settle(code === 0 ? parseAnswer(Buffer.concat(out).toString("utf8")) : null);
    const timer = setTimeout(() => settle(null), deadlineMs);
    let drain;
    const cancel = () => settle(null);
    options.signal?.addEventListener("abort", cancel);
    if (options.background) {
      timer.unref?.();
      child.unref();
      unrefPipe(child.stdout);
      unrefPipe(child.stdin);
    }
    child.on("error", () => settle(null));
    child.stdout?.on("data", (chunk) => out.push(chunk));
    child.stdout?.on("error", () => settle(null));
    child.stdout?.on("end", () => {
      if (code !== null) answered();
    });
    child.stdin?.on("error", () => {
    });
    child.on("exit", (exitCode) => {
      code = exitCode ?? -1;
      killGroup();
      if (code !== 0 || child.stdout === null || child.stdout.readableEnded) return answered();
      drain = setTimeout(answered, EXIT_DRAIN_MS);
    });
    child.stdin?.end(JSON.stringify(event));
  });
}
function parseAnswer(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null || !("answer" in parsed)) return null;
    return parsed.answer;
  } catch {
    return null;
  }
}

// src/harness/opencode/deadline.ts
function deadlineIn(ms) {
  const end = performance.now() + ms;
  return () => Math.max(0, end - performance.now());
}
function within(promise, ms) {
  return new Promise((resolve2) => {
    const timer = setTimeout(() => resolve2(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve2(value);
      },
      () => {
        clearTimeout(timer);
        resolve2(null);
      }
    );
  });
}

// src/harness/opencode/parts.ts
var BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function partId(now = Date.now()) {
  const time = (BigInt(now) * 0x1000n + 0xfffn).toString(16).padStart(12, "0").slice(-12);
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return `prt_${time}${Array.from(bytes, (byte) => BASE62[byte % 62]).join("")}`;
}
function partAfter(parts, now = Date.now()) {
  let last = "";
  for (const part of parts) {
    const id = part?.id;
    if (typeof id !== "string" || !id.startsWith("prt")) return null;
    if (id > last) last = id;
  }
  const fresh = partId(now);
  return fresh > last ? fresh : `${last}z`;
}

// src/harness/opencode/sessions.ts
var MAX_DEPTH = 8;
var keyOf = (consumer) => `${consumer.sessionId}
${consumer.agentId ?? ""}`;
function sessions(client) {
  const parents = /* @__PURE__ */ new Map();
  const parentOf = async (id, deadline) => {
    const known = parents.get(id);
    if (known !== void 0) return known;
    const result = await within(
      client.session.get({ path: { id } }),
      deadline()
    );
    if (result?.data === void 0) return void 0;
    const parent = result.data.parentID ?? null;
    parents.set(id, parent);
    return parent;
  };
  return {
    saw: (info) => parents.set(info.id, info.parentID ?? null),
    forget: (id) => parents.delete(id),
    async consumerOf(id, deadline) {
      let root = id;
      const seen = /* @__PURE__ */ new Set([id]);
      for (let hops = 0; hops <= MAX_DEPTH; hops++) {
        const parent = await parentOf(root, deadline);
        if (parent === void 0) return null;
        if (parent === null)
          return root === id ? { sessionId: id } : { sessionId: root, agentId: id };
        if (seen.has(parent)) return null;
        seen.add(parent);
        root = parent;
      }
      return null;
    }
  };
}

// src/harness/opencode/turns.ts
var PROMPT_DEADLINE_MS = 2e3;
var WAIT_DEADLINE_MS = 36e5;
var REPORT_OPENING = "SQUEAL \xB7 ";
var textOf = (part) => {
  const p = part;
  return p?.type === "text" && typeof p.text === "string" ? p.text : null;
};
var storedBySqueal = (parts) => parts.length > 0 && parts.every(
  (part) => part?.synthetic === true && textOf(part)?.startsWith(REPORT_OPENING) === true
);
function turns(client, ask) {
  const all = /* @__PURE__ */ new Map();
  let stopped = null;
  const turnOf = (id) => {
    let turn = all.get(id);
    if (turn === void 0) {
      turn = {
        open: false,
        continued: false,
        aborted: false,
        own: null,
        last: null,
        arrivals: 0,
        epoch: 0,
        held: [],
        waiter: null
      };
      all.set(id, turn);
    }
    return turn;
  };
  const live = (id, turn, epoch) => all.get(id) === turn && turn.epoch === epoch;
  const current = (id, turn, epoch) => stopped === null && live(id, turn, epoch);
  const latest = async (id, last, deadline) => {
    if (last === null) return false;
    const cancel = new AbortController();
    const read = client.session.messages({
      path: { id },
      query: { limit: 1 },
      signal: cancel.signal
    });
    const result = await within(read, deadline());
    if (result === null) cancel.abort();
    const info = result?.data?.at(-1)?.info;
    return info?.id === last || info?.role === "assistant" && info.parentID === last;
  };
  const cancelWait = (turn) => {
    turn.waiter?.abort();
    turn.waiter = null;
  };
  const say = async (id, turn, text, deadline, epoch) => {
    const stop = stopped;
    const left = stop ?? deadline;
    const overtaken = async (stop2) => !await latest(id, turn.last, stop2) || arrivals(id) !== turn.arrivals;
    if (left() <= 0 || !live(id, turn, epoch) || stop && await overtaken(stop)) {
      turn.held.push(text);
      return false;
    }
    turn.continued = true;
    turn.own = text;
    const cancel = new AbortController();
    const path = { id };
    const signal = cancel.signal;
    const sent = stop === null ? client.session.promptAsync({ path, body: { parts: [{ type: "text", text }] }, signal }) : client.session.prompt({
      path,
      body: { parts: [{ type: "text", text, synthetic: true }], noReply: true },
      signal
    });
    const result = await within(sent, left());
    if (result !== null && result.error === void 0) return true;
    cancel.abort();
    turn.held.push(text);
    return false;
  };
  const armWait = (consumer, turn) => {
    cancelWait(turn);
    if (stopped) return;
    const waiter = new AbortController();
    turn.waiter = waiter;
    const options = { signal: waiter.signal, background: true };
    void ask("wait", { consumer }, deadlineIn(WAIT_DEADLINE_MS), options).then(async (answer) => {
      if (turn.waiter !== waiter) return;
      turn.waiter = null;
      if (answer?.text == null || stopped !== null) return;
      const deadline = deadlineIn(PROMPT_DEADLINE_MS);
      await say(consumer.sessionId, turn, answer.text, deadline, turn.epoch);
    }).catch(() => {
    });
  };
  return {
    message(id, messageId, parts) {
      const turn = turnOf(id);
      turn.open = true;
      turn.last = messageId;
      turn.epoch++;
      cancelWait(turn);
      const own = turn.own;
      if (own !== null && parts.some((part) => textOf(part) === own)) {
        turn.own = null;
        turn.held = turn.held.filter((text) => text !== own);
        return;
      }
      turn.continued = false;
      turn.aborted = false;
    },
    aborted(id) {
      const turn = turnOf(id);
      turn.aborted = true;
      turn.epoch++;
    },
    take(id) {
      const turn = all.get(id);
      if (turn === void 0 || turn.held.length === 0) return null;
      const text = turn.held.join("\n\n");
      turn.held = [];
      return text;
    },
    async idle(consumer, deadline) {
      const id = consumer.sessionId;
      const turn = turnOf(id);
      if (!turn.open) return;
      turn.open = false;
      turn.arrivals = arrivals(id);
      const epoch = turn.epoch;
      if (turn.aborted || turn.continued) {
        const ending = turn.continued ? { consumer, continued: true } : { consumer };
        turn.aborted = false;
        await ask("endTurn", ending, deadline);
      } else {
        const report = (await ask("stop", { consumer }, deadline))?.report ?? null;
        if (report !== null && await say(id, turn, report, deadline, epoch)) return;
      }
      if (current(id, turn, epoch)) armWait(consumer, turn);
    },
    forget(id) {
      const turn = all.get(id);
      if (turn !== void 0) cancelWait(turn);
      all.delete(id);
    },
    stop(deadline) {
      stopped = deadline;
      for (const turn of all.values()) cancelWait(turn);
    }
  };
}

// src/harness/opencode/hooks.ts
var EVENT_DEADLINE_MS = 2e3;
var STOP_WAIT_CAP_MS = 1500;
var IDLE_MARGIN_MS = 500;
var IDLE_DEADLINE_MS = STOP_WAIT_CAP_MS + IDLE_MARGIN_MS;
var DISPOSE_DEADLINE_MS = 3e3;
var DISPOSE_END_MS = 500;
var MAIN_AGENT = "main";
var PRIMER_CAP_CHARS = 8e3;
var joined = (first, second) => first === null ? second : second === null ? first : `${first}

${second}`;
function squealHooks(host) {
  const { client } = host;
  const map = sessions(client);
  const registered = /* @__PURE__ */ new Map();
  const registering = /* @__PURE__ */ new Map();
  const idling = /* @__PURE__ */ new Set();
  let primer = null;
  let stopWaitMs = null;
  let disposed = false;
  const ask = async (kind, request, deadline, options) => {
    const left = deadline();
    if (left <= 0) return null;
    const event = { kind, ...request, worktree: host.worktree, pid: host.pid };
    const command = { node: host.node, entry: host.bridge(kind) };
    return callBridge(command, event, host.directory, left, options);
  };
  const turn = turns(client, ask);
  const identify = async (id, deadline) => {
    const consumer = await map.consumerOf(id, deadline);
    return disposed ? null : consumer;
  };
  const held = (consumer) => consumer.agentId === void 0 ? turn.take(consumer.sessionId) : null;
  const register = (consumer, deadline) => {
    const key = keyOf(consumer);
    const run = (async () => {
      const answer = await ask("register", { consumer }, deadline);
      if (answer === null || !answer.registered) return null;
      primer = answer.primer ?? primer;
      stopWaitMs = answer.stopWaitMs ?? stopWaitMs;
      registered.set(key, consumer);
      return disposed ? null : answer.header;
    })();
    registering.set(key, run);
    return run.finally(() => registering.delete(key));
  };
  const blockReason = async (input, args) => {
    try {
      if (disposed) return null;
      const deadline = deadlineIn(EVENT_DEADLINE_MS);
      const consumer = await identify(input.sessionID, deadline);
      if (consumer === null) return null;
      const { command, workdir } = args ?? {};
      const bash = input.tool === "bash" && typeof command === "string" ? {
        command,
        workdir: resolve(host.directory, typeof workdir === "string" ? workdir : ".")
      } : {};
      const request = { consumer, tool: input.tool, ...bash };
      return (await ask("before", request, deadline))?.reason ?? null;
    } catch {
      return null;
    }
  };
  const idle = async (id) => {
    const wait = Math.max(0, Math.min(stopWaitMs ?? STOP_WAIT_CAP_MS, STOP_WAIT_CAP_MS));
    const deadline = deadlineIn(wait + IDLE_MARGIN_MS);
    const consumer = await map.consumerOf(id, deadline);
    if (consumer === null) return;
    if (consumer.agentId !== void 0) {
      registered.delete(keyOf(consumer));
      await ask("end", { sessions: [], consumers: [consumer] }, deadline);
      return;
    }
    await turn.idle(consumer, deadline);
  };
  return {
    async event({ event }) {
      try {
        const { info, sessionID, error } = event.properties;
        const abort = error?.name === "MessageAbortedError";
        if (event.type === "session.error" && sessionID !== void 0 && abort) arrived(sessionID);
        if (disposed) return;
        if (event.type === "session.created" && info !== void 0) {
          map.saw(info);
        } else if (event.type === "session.deleted" && info !== void 0) {
          map.saw(info);
          const deadline = deadlineIn(EVENT_DEADLINE_MS);
          const consumer = await identify(info.id, deadline);
          map.forget(info.id);
          turn.forget(info.id);
          if (consumer === null) return;
          const root = consumer.agentId === void 0;
          for (const [key, c] of registered) {
            if (key === keyOf(consumer) || root && c.sessionId === info.id)
              registered.delete(key);
          }
          const request = root ? { sessions: [info.id], consumers: [] } : { sessions: [], consumers: [consumer] };
          await ask("end", request, deadline);
        } else if (event.type === "session.error" && sessionID !== void 0) {
          if (abort) turn.aborted(sessionID);
        } else if (event.type === "session.idle" && sessionID !== void 0) {
          const ending = idle(sessionID);
          idling.add(ending);
          await ending.finally(() => idling.delete(ending));
        }
      } catch {
      }
    },
    async "chat.message"(input, output) {
      try {
        if (storedBySqueal(output.parts)) return;
        arrived(input.sessionID);
        if (disposed) return;
        const deadline = deadlineIn(EVENT_DEADLINE_MS);
        const consumer = await identify(input.sessionID, deadline);
        if (consumer === null) return;
        if (consumer.agentId === void 0)
          turn.message(consumer.sessionId, output.message.id, output.parts);
        const key = keyOf(consumer);
        let text;
        if (registered.has(key)) {
          const answer = await ask("prompt", { consumer }, deadline);
          primer = answer?.primer ?? primer;
          stopWaitMs = answer?.stopWaitMs ?? stopWaitMs;
          text = answer?.text ?? null;
        } else {
          const inFlight = registering.get(key);
          if (inFlight !== void 0) {
            await within(inFlight, deadline());
            return;
          }
          text = await register(consumer, deadline);
        }
        if (disposed) return;
        const id = partAfter(output.parts);
        if (id === null) return;
        const added = joined(held(consumer), text);
        if (added === null) return;
        const { message } = output;
        output.parts.push({
          id,
          sessionID: message.sessionID,
          messageID: message.id,
          type: "text",
          text: added,
          synthetic: true
        });
      } catch {
      }
    },
    async "experimental.chat.system.transform"(_input, output) {
      try {
        if (disposed || primer === null) return;
        output.system.push(primer.slice(0, PRIMER_CAP_CHARS));
      } catch {
      }
    },
    async "tool.execute.before"(input, output) {
      const reason = await blockReason(input, output.args);
      if (reason !== null) throw new Error(reason);
    },
    async "tool.execute.after"(input, output) {
      try {
        if (disposed || typeof output.output !== "string") return;
        const deadline = deadlineIn(EVENT_DEADLINE_MS);
        const consumer = await identify(input.sessionID, deadline);
        if (consumer === null) return;
        const request = {
          consumer,
          tool: input.tool,
          ...primer === null ? { primer: true } : {}
        };
        const answer = await ask("after", request, deadline);
        primer = answer?.primer ?? primer;
        stopWaitMs = answer?.stopWaitMs ?? stopWaitMs;
        const text = answer?.text ?? null;
        if (disposed) return;
        const added = joined(held(consumer), text);
        if (added !== null) output.output = `${output.output}

${added}`;
      } catch {
      }
    },
    async "shell.env"(input, output) {
      try {
        if (disposed) return;
        const path = output.env.PATH ?? host.env.PATH;
        output.env.PATH = path === void 0 || path === "" ? host.bin : `${host.bin}${delimiter}${path}`;
        if (input.sessionID === void 0) return;
        const consumer = await identify(input.sessionID, deadlineIn(EVENT_DEADLINE_MS));
        if (consumer === null) return;
        output.env.OPENCODE_SESSION_ID = consumer.sessionId;
        output.env.OPENCODE_AGENT_ID = consumer.agentId ?? MAIN_AGENT;
      } catch {
      }
    },
    async dispose() {
      try {
        if (disposed) return;
        disposed = true;
        const deadline = deadlineIn(DISPOSE_DEADLINE_MS);
        turn.stop(() => deadline() - DISPOSE_END_MS);
        await within(Promise.all([...registering.values(), ...idling]), deadline());
        const consumers = [...registered.values()];
        registered.clear();
        if (consumers.length === 0) return;
        await ask("end", { sessions: [], consumers }, deadline);
      } catch {
      }
    }
  };
}

// src/harness/opencode/host.ts
import { spawn as spawn2 } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { delimiter as delimiter2, dirname, isAbsolute, join } from "node:path";
var floor;
function minimumNode() {
  floor ??= true ? "22.19" : manifestFloor();
  return floor;
}
var NODE_PROBE_MS = 2e3;
var isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};
var firstLine = (path) => readFileSync(path, "utf8").split("\n")[0] ?? "";
function usesSquealAt(dir) {
  try {
    if (dir === "") return false;
    let root = dir;
    if (isFile(join(root, "squeal.config.json"))) return true;
    while (!existsSync(join(root, ".git"))) {
      const up = dirname(root);
      if (up === root) return false;
      root = up;
    }
    if (isFile(join(root, "squeal.config.json"))) return true;
    let git = join(root, ".git");
    if (isFile(git)) {
      const named = firstLine(git).replace(/^gitdir:/, "").trim();
      git = isAbsolute(named) ? named : join(root, named);
      const common = isFile(join(git, "commondir")) ? firstLine(join(git, "commondir")).trim() : "";
      if (common !== "") git = isAbsolute(common) ? common : join(git, common);
    }
    return existsSync(join(git, "squeal"));
  } catch {
    return false;
  }
}
function nodeOnPath(path) {
  for (const dir of (path ?? "").split(delimiter2)) {
    if (dir === "") continue;
    const candidate = join(dir, "node");
    try {
      accessSync(candidate, constants.X_OK);
      if (isFile(candidate)) return candidate;
    } catch {
    }
  }
  return null;
}
function meetsMinimum(version) {
  const [major, minor] = version.trim().split(".").map(Number);
  if (major === void 0 || minor === void 0 || Number.isNaN(major) || Number.isNaN(minor))
    return false;
  const [leastMajor = 0, leastMinor = 0] = minimumNode().split(".").map(Number);
  return major > leastMajor || major === leastMajor && minor >= leastMinor;
}
function nodeVersion(node, timeoutMs = NODE_PROBE_MS) {
  return new Promise((resolve2) => {
    let out = "";
    let child;
    try {
      child = spawn2(node, ["-p", "process.versions.node"], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve2(null);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve2(null);
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve2(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve2(code === 0 ? out.trim() : null);
    });
  });
}
async function findNode(env) {
  const node = nodeOnPath(env.PATH);
  if (node === null) return null;
  const version = await nodeVersion(node);
  return version !== null && meetsMinimum(version) ? node : null;
}

// src/harness/opencode/plugin.ts
var LOG_SERVICE = "squeal";
var NO_NODE_LOG = `Squeal: no Node ${minimumNode()} or later on the PATH, so Squeal is off in this OpenCode process.`;
function squealPlugin(options) {
  return async (input) => {
    try {
      const env = options.env ?? process.env;
      if (!usesSquealAt(input.directory) && !usesSquealAt(input.worktree)) return {};
      const node = await (options.findNode ?? findNode)(env);
      if (node === null) {
        log(input.client, NO_NODE_LOG);
        return {};
      }
      return squealHooks({
        node,
        bridge: options.bridge,
        client: input.client,
        directory: input.directory,
        worktree: input.worktree,
        pid: options.pid ?? process.pid,
        bin: options.bin,
        env
      });
    } catch {
      return {};
    }
  };
}
function log(client, message) {
  try {
    client.app.log({ body: { service: LOG_SERVICE, level: "warn", message } }).catch(() => {
    });
  } catch {
  }
}

// src/harness/opencode/protocol.ts
function bridgeFile(kind) {
  return `${kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}.mjs`;
}

// src/harness/opencode/entries/plugin.ts
var at = (relative) => decodeURIComponent(new URL(relative, import.meta.url).pathname);
var plugin_default = {
  id: "squeal",
  server: squealPlugin({ bridge: (kind) => at(`./hooks/${bridgeFile(kind)}`), bin: at("../bin") })
};
export {
  plugin_default as default
};
