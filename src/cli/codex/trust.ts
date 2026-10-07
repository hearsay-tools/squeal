import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { isRecord } from "../../core/fs/index.js";
import type { CliIo } from "../main.js";

/*
 * `squeal init --harness codex --trust`, row 002-17 (spec 002 D1): Codex
 * trusts the Squeal plugin's hooks through its own app-server, the
 * `hooks/list` then `config/batchWrite` edit Codex makes for workspace
 * plugins (`research/wave-0-checks.md` 3). Codex writes its own config;
 * Squeal opens no file under `CODEX_HOME` and depends on no hash format.
 */

/** How long `codex app-server` may stay silent on one request. */
export const CODEX_APP_SERVER_TIMEOUT_MS = 10_000;

/** One hook as `hooks/list` reports it; `trustStatus` is `trusted`, `untrusted` or `modified`. */
export interface CodexHook {
  readonly key: string;
  readonly eventName: string;
  readonly command: string;
  readonly currentHash: string;
  readonly trustStatus: string;
  readonly pluginId: string | null;
}

export interface TrustOptions {
  /** The plugin whose hooks to trust, `squeal@squeal`. */
  readonly pluginId: string;
  /** The commands that install the plugin, named when Codex has none of its hooks. */
  readonly installCommands: readonly string[];
  /** `--yes`: trust without asking. */
  readonly yes: boolean;
  /** Asks one question on the terminal, resolving with the answer line; null without a terminal. */
  readonly ask: ((question: string) => Promise<string>) | null;
  /** Default `CODEX_APP_SERVER_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

/** A failure of the app-server conversation, said in one line. */
class AppServerError extends Error {}

/**
 * Lists the plugin's hooks that Codex has not trusted, asks, and on yes has
 * Codex trust exactly those. Exit 0 when every hook of the plugin is trusted
 * at the end, 1 otherwise, including a no; the app-server is killed on every
 * path.
 */
export async function trustCodexHooks(
  io: CliIo,
  root: string,
  options: TrustOptions,
): Promise<number> {
  let server: AppServer | null = null;
  try {
    server = new AppServer(
      root,
      io.env ?? process.env,
      options.timeoutMs ?? CODEX_APP_SERVER_TIMEOUT_MS,
    );
    await server.request("initialize", {
      clientInfo: { name: "squeal", title: null, version: "0" },
    });
    server.notify("initialized", {});
    const hooks = await listHooks(server, root, options.pluginId);
    if (hooks.length === 0) {
      io.stderr(
        [
          `squeal init: Codex lists no hooks of ${options.pluginId}; install the plugin first:`,
          ...options.installCommands.map((c) => `  ${c}`),
          "",
        ].join("\n"),
      );
      return 1;
    }
    const pending = hooks.filter(
      (h) => h.trustStatus === "untrusted" || h.trustStatus === "modified",
    );
    if (pending.length === 0) {
      io.stdout(
        `squeal init: every hook of ${options.pluginId} is trusted in Codex; nothing to do\n`,
      );
      return 0;
    }
    io.stdout(
      [
        `squeal init: Codex has not trusted ${pending.length} hooks of ${options.pluginId}:`,
        ...pending.flatMap((h) => [
          `  ${event(h).padEnd(16)}  ${h.trustStatus.padEnd(9)}  ${h.currentHash}`,
          `    ${h.command}`,
        ]),
        "",
      ].join("\n"),
    );
    if (!options.yes) {
      if (options.ask === null) {
        io.stderr(
          "squeal init: no terminal to ask on; rerun with --yes to trust them, or use /hooks in the Codex TUI; nothing changed\n",
        );
        return 1;
      }
      const answer = await options.ask(`Have Codex trust these ${pending.length} hooks? [y/N] `);
      if (!/^y(es)?$/i.test(answer.trim())) {
        io.stderr("squeal init: not trusted; nothing changed\n");
        return 1;
      }
    }
    const written = await server.request("config/batchWrite", {
      edits: pending.map((h) => ({
        keyPath: `hooks.state."${h.key}".trusted_hash`,
        value: h.currentHash,
        mergeStrategy: "replace",
      })),
      reloadUserConfig: true,
    });
    const filePath =
      isRecord(written) && typeof written.filePath === "string" ? written.filePath : null;
    const after = await listHooks(server, root, options.pluginId);
    io.stdout(
      [
        `squeal init: Codex wrote the trust${filePath === null ? "" : ` to ${filePath}`}; its hooks now:`,
        ...after.map((h) => `  ${event(h).padEnd(16)}  ${h.trustStatus}`),
        "",
      ].join("\n"),
    );
    if (after.every((h) => h.trustStatus === "trusted")) return 0;
    io.stderr(`squeal init: Codex still lists hooks of ${options.pluginId} that are not trusted\n`);
    return 1;
  } catch (error) {
    if (!(error instanceof AppServerError)) throw error;
    io.stderr(`squeal init: ${error.message}\n`);
    return 1;
  } finally {
    await server?.close();
  }
}

/**
 * Asks on the controlling terminal, or null when stdin or stdout is not one.
 * End of input answers the empty line, so the default no.
 */
export function terminalAsk(): TrustOptions["ask"] {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) return null;
  return (question) =>
    new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      let answered = false;
      rl.on("close", () => {
        if (!answered) resolve("");
      });
      rl.question(question, (answer) => {
        answered = true;
        rl.close();
        resolve(answer);
      });
    });
}

/** `preToolUse` as hooks.json names it, `PreToolUse`. */
function event(hook: CodexHook): string {
  return `${hook.eventName.charAt(0).toUpperCase()}${hook.eventName.slice(1)}`;
}

async function listHooks(server: AppServer, root: string, pluginId: string): Promise<CodexHook[]> {
  const result = await server.request("hooks/list", { cwds: [root] });
  const data = isRecord(result) ? result.data : undefined;
  if (!Array.isArray(data))
    throw new AppServerError("codex app-server answered hooks/list without data");
  const hooks: CodexHook[] = [];
  for (const entry of data) {
    const listed: unknown[] = isRecord(entry) && Array.isArray(entry.hooks) ? entry.hooks : [];
    for (const hook of listed) {
      if (!isRecord(hook) || hook.pluginId !== pluginId) continue;
      const { key, eventName, command, currentHash, trustStatus } = hook;
      if (
        typeof key !== "string" ||
        typeof eventName !== "string" ||
        typeof command !== "string" ||
        typeof currentHash !== "string" ||
        typeof trustStatus !== "string"
      ) {
        throw new AppServerError(
          `codex app-server listed a hook of ${pluginId} in a shape Squeal does not know`,
        );
      }
      if (!hooks.some((h) => h.key === key)) {
        hooks.push({ key, eventName, command, currentHash, trustStatus, pluginId });
      }
    }
  }
  return hooks;
}

/** `codex app-server`: JSON-RPC, one message per line on stdio. */
class AppServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (message: Record<string, unknown>) => void>();
  private nextId = 1;
  private buffer = "";
  private lastStderr = "";
  /** Set once the process failed to start, exited or spoke out of protocol; every request rejects with it. */
  private failure: AppServerError | null = null;
  private readonly failed: Promise<never>;
  private readonly exited: Promise<void>;

  constructor(
    cwd: string,
    env: Readonly<Record<string, string | undefined>>,
    private readonly timeoutMs: number,
  ) {
    // PATH and CODEX_HOME as the user's environment has them; spawn looks `codex` up on env.PATH.
    this.child = spawn("codex", ["app-server"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let fail: (error: AppServerError) => void = () => {};
    this.failed = new Promise<never>((_, reject) => {
      fail = (error) => {
        this.failure ??= error;
        reject(this.failure);
      };
    });
    this.failed.catch(() => {});
    this.exited = new Promise((resolve) => this.child.on("close", () => resolve()));
    // "close", not "exit": the last stderr line is read by then.
    this.child.on("error", (error: NodeJS.ErrnoException) => {
      fail(
        new AppServerError(
          error.code === "ENOENT"
            ? "codex is not on PATH; install the Codex CLI, or trust the hooks with /hooks in the Codex TUI"
            : `cannot start codex app-server: ${error.message}`,
        ),
      );
    });
    this.child.on("close", (code, signal) => {
      const why = this.lastStderr === "" ? "" : `: ${this.lastStderr}`;
      fail(new AppServerError(`codex app-server exited (${signal ?? `code ${code}`})${why}`));
    });
    this.child.stdin.on("error", () => {}); // a dead app-server is reported by "close"
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (text: string) => {
      const lines = text
        .split("\n")
        .map(plain)
        .filter((l) => l !== "");
      this.lastStderr = lines.at(-1) ?? this.lastStderr;
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (text: string) => {
      this.buffer += text;
      let end = this.buffer.indexOf("\n");
      while (end !== -1) {
        const line = this.buffer.slice(0, end).trim();
        this.buffer = this.buffer.slice(end + 1);
        end = this.buffer.indexOf("\n");
        if (line === "") continue;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          fail(
            new AppServerError(
              `codex app-server wrote a line that is not JSON: ${line.slice(0, 120)}`,
            ),
          );
          return;
        }
        // A message with a method is a notification or a request from Codex, never an answer.
        if (isRecord(message) && message.method === undefined && typeof message.id === "number") {
          this.pending.get(message.id)?.(message);
        }
      }
    });
  }

  notify(method: string, params: unknown): void {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  /** The `result` of `method`, or an `AppServerError` on an error answer, an exit or silence. */
  async request(method: string, params: unknown): Promise<unknown> {
    if (this.failure !== null) throw this.failure;
    const id = this.nextId++;
    let timer: NodeJS.Timeout | undefined;
    const answered = new Promise<Record<string, unknown>>((resolve) =>
      this.pending.set(id, resolve),
    );
    const silent = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new AppServerError(
              `codex app-server did not answer ${method} within ${Math.round(this.timeoutMs / 1000)} s`,
            ),
          ),
        this.timeoutMs,
      );
    });
    this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    try {
      const message = await Promise.race([answered, silent, this.failed]);
      if (message.error !== undefined) {
        const reason = isRecord(message.error) ? message.error.message : message.error;
        throw new AppServerError(`codex app-server refused ${method}: ${String(reason)}`);
      }
      return message.result;
    } finally {
      clearTimeout(timer);
      this.pending.delete(id);
    }
  }

  /** Ends stdin, then SIGTERM, then SIGKILL after a second; resolves once the process is gone. */
  async close(): Promise<void> {
    if (
      this.child.exitCode !== null ||
      this.child.signalCode !== null ||
      this.child.pid === undefined
    ) {
      return;
    }
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    const killer = setTimeout(() => this.child.kill("SIGKILL"), 1000);
    await this.exited;
    clearTimeout(killer);
  }
}

/** A stderr line without terminal colour codes. */
function plain(line: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the escape character is the point
  return line.replace(/\u001b\[[0-9;]*m/g, "").trim();
}
