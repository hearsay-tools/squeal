// Throwaway probe for 016-34: the host side of each binding, one shape for
// all: invalidate, affected, closure, run, hint, plus the probe's own
// remoteCpu (called outside timed spans), kill and close.
//
// - inproc: the provider imported into the host's thread.
// - worker: the provider in a worker thread; structured-clone messages.
// - rpc: the provider in a persistent child process; JSON-RPC 2.0 with
//   Content-Length framing over stdio.
// - command, command-cc: a process per run that writes a report file. The
//   host selects (invalidate, affected, closure) with the same provider code,
//   as a core would from a manifest's declared scope. command-cc sets
//   NODE_COMPILE_CACHE so later runs reuse V8's compiled code.
// - command-cli (eslint check only): ESLint's own CLI per run, `-f json -o`.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { frame, reader } from "./framing.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BINDINGS = ["inproc", "worker", "rpc", "command", "command-cc", "command-cli"];

/** `options`: the provider's ({ root, check, eslintDir, fault }) plus `compileCache` for command-cc. */
export async function open(kind, options) {
  const { compileCache, ...provider } = options;
  if (kind === "inproc") return openInproc(provider);
  if (kind === "worker") return openWorker(provider);
  if (kind === "rpc") return openRpc(provider);
  if (kind.startsWith("command")) return openCommand(kind, provider, compileCache);
  throw new Error(`unknown binding ${kind}`);
}

async function openInproc(options) {
  const { createProvider } = await import("./provider.mjs");
  const p = createProvider(options);
  return {
    kind: "inproc",
    invalidate: async (paths) => p.invalidate(paths),
    affected: async (paths) => p.affected(paths),
    closure: async (unit) => p.closure(unit),
    run: (files) => p.run(files),
    hint: (unit, grant) => p.tierWidth(unit, grant),
    remoteCpu: async () => null,
    kill: () => false,
    close: async () => {},
  };
}

/** Pending calls of a message-passing binding; `fail` rejects them all. */
function calls() {
  const pending = new Map();
  let next = 1;
  return {
    add(resolve, reject) {
      const id = next++;
      pending.set(id, { resolve, reject });
      return id;
    },
    settle({ id, result, error }) {
      const call = pending.get(id);
      if (call === undefined) return;
      pending.delete(id);
      if (error !== undefined) call.reject(new Error(typeof error === "string" ? error : error.message));
      else call.resolve(result);
    },
    fail(error) {
      for (const call of pending.values()) call.reject(error);
      pending.clear();
    },
  };
}

async function openWorker(options) {
  const worker = new Worker(join(HERE, "worker-entry.mjs"), { workerData: options });
  const pending = calls();
  worker.on("message", (m) => pending.settle(m));
  worker.on("error", (e) => pending.fail(new Error(`worker error: ${e.message}`)));
  worker.on("exit", (code) => pending.fail(new Error(`worker exited ${code}`)));
  const call = (method, ...params) =>
    new Promise((resolve, reject) => worker.postMessage({ id: pending.add(resolve, reject), method, params }));
  await new Promise((resolve, reject) => {
    worker.once("online", resolve);
    worker.once("error", reject);
  });
  return {
    kind: "worker",
    invalidate: (paths) => call("invalidate", paths),
    affected: (paths) => call("affected", paths),
    closure: (unit) => call("closure", unit),
    run: (files) => call("run", files),
    hint: (unit, grant) => call("tierWidth", unit, grant),
    remoteCpu: async () => null,
    kill: () => (worker.terminate(), true),
    close: () => worker.terminate(),
  };
}

async function openRpc(options) {
  const child = spawn(process.execPath, [join(HERE, "rpc-server.mjs"), JSON.stringify(options)], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = calls();
  child.stdout.on("data", reader((m) => pending.settle(m)));
  child.on("exit", (code, signal) => pending.fail(new Error(`provider process exited ${code ?? signal}`)));
  const call = (method, ...params) =>
    new Promise((resolve, reject) => {
      const id = pending.add(resolve, reject);
      child.stdin.write(frame({ jsonrpc: "2.0", id, method, params }));
    });
  return {
    kind: "rpc",
    pid: child.pid,
    invalidate: (paths) => call("invalidate", paths),
    affected: (paths) => call("affected", paths),
    closure: (unit) => call("closure", unit),
    run: (files) => call("run", files),
    hint: (unit, grant) => call("tierWidth", unit, grant),
    remoteCpu: () => call("$/cpu"),
    kill: () => child.kill("SIGKILL"),
    close: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("exit", resolve);
        child.stdin.end();
      }),
  };
}

async function openCommand(kind, options, compileCache) {
  const { createProvider } = await import("./provider.mjs");
  const local = createProvider(options);
  const scratch = mkdtempSync(join(tmpdir(), "bc34-cmd-"));
  let child = null;
  let last = null;
  let runs = 0;
  const run = (files) =>
    new Promise((resolve, reject) => {
      runs += 1;
      const report = join(scratch, `report-${runs}.json`);
      const cpuOut = join(scratch, `cpu-${runs}.json`);
      const args =
        kind === "command-cli"
          ? [join(options.eslintDir, "node_modules/eslint/bin/eslint.js"), "-f", "json", "-o", report, ...files]
          : [join(HERE, "command.mjs"), JSON.stringify(options), report, ...files];
      const env = { ...process.env, BC34_CPU_OUT: cpuOut };
      if (kind === "command-cc") env.NODE_COMPILE_CACHE = compileCache;
      else delete env.NODE_COMPILE_CACHE;
      child = spawn(process.execPath, ["--import", join(HERE, "exit-cpu.mjs"), ...args], {
        cwd: options.root,
        env,
        stdio: ["ignore", "ignore", "inherit"],
      });
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        child = null;
        try {
          last = JSON.parse(readFileSync(cpuOut, "utf8"));
        } catch {
          last = null;
        }
        // ESLint's CLI exits 1 when it finds errors; its report decides.
        if (signal !== null || (code !== 0 && !(kind === "command-cli" && code === 1)))
          return reject(new Error(`command exited ${code ?? signal}`));
        try {
          const raw = JSON.parse(readFileSync(report, "utf8"));
          resolve(kind === "command-cli" ? fromEslintJson(raw, options.root, files) : raw);
        } catch (error) {
          reject(new Error(`no report: ${error.message}`));
        }
      });
    });
  return {
    kind,
    invalidate: async (paths) => local.invalidate(paths),
    affected: async (paths) => local.affected(paths),
    closure: async (unit) => local.closure(unit),
    run,
    hint: (unit, grant) => local.tierWidth(unit, grant),
    // The last run's own CPU and peak RSS, from exit-cpu.mjs.
    remoteCpu: async () => last,
    kill: () => (child === null ? false : child.kill("SIGKILL")),
    close: async () => rmSync(scratch, { recursive: true, force: true }),
  };
}

/** ESLint's `json` formatter output in the provider's report shape. */
function fromEslintJson(raw, root, files) {
  const results = raw.map((r) => ({
    file: r.filePath.slice(root.length + 1),
    outcome: r.errorCount > 0 ? "fail" : "pass",
    messages: r.messages.map((m) => ({ rule: m.ruleId, line: m.line, column: m.column, message: m.message })),
  }));
  return { end: "completed", completedFiles: files, results };
}
