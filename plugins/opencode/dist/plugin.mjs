// src/harness/opencode/plugin.ts
import { delimiter as delimiter2 } from "node:path";

// src/harness/opencode/bridge-client.ts
import { spawn } from "node:child_process";
function callBridge(command, event, cwd, deadlineMs) {
  return new Promise((resolve) => {
    let settled = false;
    let exited = false;
    const out = [];
    let child;
    try {
      child = spawn(command.node, ["--disable-warning=ExperimentalWarning", command.entry], {
        cwd,
        detached: true,
        stdio: ["pipe", "pipe", "ignore"]
      });
    } catch {
      resolve(null);
      return;
    }
    const killGroup = () => {
      if (exited || child.pid === void 0) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
      }
    };
    const settle = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (answer === null) killGroup();
      child.stdout?.destroy();
      child.stdin?.destroy();
      child.unref();
      resolve(answer);
    };
    const timer = setTimeout(() => settle(null), deadlineMs);
    child.on("error", () => settle(null));
    child.stdout?.on("data", (chunk) => out.push(chunk));
    child.stdout?.on("error", () => settle(null));
    child.stdin?.on("error", () => {
    });
    child.on("exit", () => {
      exited = true;
    });
    child.on("close", (code) => {
      exited = true;
      if (code !== 0) return settle(null);
      settle(parseAnswer(Buffer.concat(out).toString("utf8")));
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

// src/harness/opencode/host.ts
import { spawn as spawn2 } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
var MIN_NODE = [22, 13];
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
  for (const dir of (path ?? "").split(delimiter)) {
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
  return major > MIN_NODE[0] || major === MIN_NODE[0] && minor >= MIN_NODE[1];
}
function nodeVersion(node, timeoutMs = NODE_PROBE_MS) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn2(node, ["-p", "process.versions.node"], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim() : null);
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
var EVENT_DEADLINE_MS = 2e3;
var DISPOSE_DEADLINE_MS = 3e3;
var LOOKUP_DEADLINE_MS = 2e3;
var MAIN_AGENT = "main";
var LOG_SERVICE = "squeal";
var NO_NODE_LOG = "Squeal: no Node 22.13 or later on the PATH, so Squeal is off in this OpenCode process.";
var MAX_DEPTH = 8;
function within(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}
function partId(now = Date.now()) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const time = (BigInt(now) * 0x1000n + 0xfffn).toString(16).padStart(12, "0").slice(-12);
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return `prt_${time}${Array.from(bytes, (byte) => chars[byte % 62]).join("")}`;
}
var keyOf = (consumer) => `${consumer.sessionId}
${consumer.agentId ?? ""}`;
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
      return hooks(
        { node, entry: options.entry },
        input.client,
        input.directory,
        input.worktree,
        options
      );
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
function hooks(bridge, client, directory, worktree, options) {
  const env = options.env ?? process.env;
  const pid = options.pid ?? process.pid;
  const parents = /* @__PURE__ */ new Map();
  const registered = /* @__PURE__ */ new Map();
  const registering = /* @__PURE__ */ new Map();
  let disposed = false;
  const ask = (kind, request, deadlineMs) => callBridge(bridge, { kind, ...request, worktree, pid }, directory, deadlineMs);
  const parentOf = async (id) => {
    const known = parents.get(id);
    if (known !== void 0) return known;
    const result = await within(
      client.session.get({ path: { id } }),
      LOOKUP_DEADLINE_MS
    );
    if (result?.data === void 0) return null;
    const parent = result.data.parentID ?? null;
    parents.set(id, parent);
    return parent;
  };
  const consumerOf = async (sessionId) => {
    let root = sessionId;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const parent = await parentOf(root);
      if (parent === null) break;
      root = parent;
    }
    return root === sessionId ? { sessionId } : { sessionId: root, agentId: sessionId };
  };
  const registerOnce = async (consumer, message, parts) => {
    const answer = await ask("register", { consumer }, EVENT_DEADLINE_MS);
    if (answer === null || disposed) return;
    registered.set(keyOf(consumer), consumer);
    if (answer.header === null) return;
    parts.push({
      id: partId(),
      sessionID: message.sessionID,
      messageID: message.id,
      type: "text",
      text: answer.header,
      synthetic: true
    });
  };
  return {
    async event({ event }) {
      try {
        const info = event.properties.info;
        if (disposed || info === void 0) return;
        if (event.type === "session.created") {
          parents.set(info.id, info.parentID ?? null);
        } else if (event.type === "session.deleted") {
          parents.set(info.id, info.parentID ?? null);
          const consumer = await consumerOf(info.id);
          parents.delete(info.id);
          for (const [key, c] of registered) {
            if (key === keyOf(consumer) || consumer.agentId === void 0 && c.sessionId === info.id)
              registered.delete(key);
          }
          if (consumer.agentId === void 0) {
            await ask("end", { sessions: [info.id], consumers: [] }, EVENT_DEADLINE_MS);
          } else {
            await ask("end", { sessions: [], consumers: [consumer] }, EVENT_DEADLINE_MS);
          }
        }
      } catch {
      }
    },
    async "chat.message"(input, output) {
      try {
        if (disposed) return;
        const consumer = await consumerOf(input.sessionID);
        const key = keyOf(consumer);
        if (registered.has(key)) return;
        const inFlight = registering.get(key);
        if (inFlight !== void 0) return await inFlight;
        const registration = registerOnce(consumer, output.message, output.parts);
        registering.set(key, registration);
        try {
          await registration;
        } finally {
          registering.delete(key);
        }
      } catch {
      }
    },
    async "shell.env"(input, output) {
      try {
        const path = output.env.PATH ?? env.PATH;
        output.env.PATH = path === void 0 || path === "" ? options.bin : `${options.bin}${delimiter2}${path}`;
        if (input.sessionID === void 0) return;
        const consumer = await consumerOf(input.sessionID);
        output.env.OPENCODE_SESSION_ID = consumer.sessionId;
        output.env.OPENCODE_AGENT_ID = consumer.agentId ?? MAIN_AGENT;
      } catch {
      }
    },
    async dispose() {
      try {
        if (disposed) return;
        disposed = true;
        const consumers = [...registered.values()];
        registered.clear();
        if (consumers.length === 0) return;
        await ask("end", { sessions: [], consumers }, DISPOSE_DEADLINE_MS);
      } catch {
      }
    }
  };
}

// src/harness/opencode/entries/plugin.ts
var at = (relative) => decodeURIComponent(new URL(relative, import.meta.url).pathname);
var plugin_default = {
  id: "squeal",
  server: squealPlugin({ entry: at("./hooks/opencode.mjs"), bin: at("../bin") })
};
export {
  plugin_default as default
};
