import { type ChildProcess, type SpawnOptions, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import {
  PLANNED_MODEL,
  type ScriptedRequest,
  type ScriptedStep,
  SMALL_MODEL,
  startScriptedProvider,
} from "../fixtures/opencode/scripted-provider.js";
import { piBase as runBase } from "./pi.js";

/**
 * The real OpenCode with a scripted model (spec 008 Testing). Each run gets its own temp
 * directory under `runBase()` (outside any repository) holding HOME, TMPDIR, the four XDG
 * directories, `OPENCODE_CONFIG_DIR` and the project; the wave-0 isolation check
 * (`docs/specifications/008-opencode-adapter/research/wave-0-checks.md`) found no write, no read
 * of the user's files and no network connect outside it under exactly these variables. A caller
 * cannot override them. The two config directories OpenCode would npm-install
 * `@opencode-ai/plugin` into are seeded so it fetches nothing.
 * The model is `test/fixtures/opencode/scripted-provider.ts`, started in this process for the
 * run: it plays `plan` one step per request and records every request, which the run returns.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const PLUGIN_PACKAGE = join(ROOT, "node_modules/@opencode-ai/plugin");

/** The OpenCode version the isolation check ran against; another version skips until it is re-run. */
const CHECKED_VERSION = "1.18.35";

/**
 * The variables that isolate a run, and those that would point OpenCode's config, home or
 * database elsewhere; `runOpenCode` throws on a caller's override of any.
 */
const PROTECTED_ENV = [
  "HOME",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_DISABLE_MODELS_FETCH",
  "OPENCODE_DISABLE_AUTOUPDATE",
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_TEST_HOME",
  "OPENCODE_DB",
] as const;

export type OpenCodeMode = "run" | "serve";

export interface OpenCodeRunOptions {
  /** `opencode run --format json <prompt>`, or one `POST /session/:id/message` to `opencode serve`. */
  mode: OpenCodeMode;
  plan: ScriptedStep[];
  prompt: string;
  /** Plugin files under test, linked into the run's `OPENCODE_CONFIG_DIR/plugins/`. */
  plugins?: string[];
  /**
   * Plugin packages installed with `opencode plugin file:<dir> -g` into the run's isolated config
   * before OpenCode starts, so they load from OpenCode's global config as a user's install does.
   */
  install?: string[];
  /** Files written into the project before OpenCode starts, by relative path. */
  files?: Record<string, string>;
  /** Added to the run's environment; overriding one of `PROTECTED_ENV` throws before OpenCode starts. */
  env?: Record<string, string>;
  /** Called with the project after its `git init` and `files`, before OpenCode starts. */
  setup?: (cwd: string) => void | Promise<void>;
  /**
   * Called before OpenCode starts with the provider's live array of requests, title requests
   * included, so a test can act once a request is in flight (a step's `release` holds it).
   */
  onRequests?: (requests: ScriptedRequest[]) => void;
  /**
   * Under `serve`, called after the first reply and before the SIGTERM that ends the server, so
   * a test can wait for a turn OpenCode starts itself or send another message. `requests` is the
   * provider's live array, title requests included (their `model` is not `PLANNED_MODEL`).
   */
  afterReply?: (live: OpenCodeLive) => Promise<void>;
  /**
   * Under `run`, `opencode run --continue` in that earlier run's directory and project, so it
   * resumes the session the earlier run left; no `setup`, `files` or `install`, and a fresh
   * provider. The earlier run's `cleanup` removes both.
   */
  continue?: OpenCodeRun;
  timeoutMs?: number;
}

/** A `serve` run between its first reply and its end (`afterReply`). */
export interface OpenCodeLive {
  url: string;
  sessionID: string;
  requests: ScriptedRequest[];
  /** One more `POST /session/:id/message`, its reply awaited. */
  message(text: string): Promise<void>;
}

export interface OpenCodeRun {
  /** The run's temp directory; `cleanup()` removes it. */
  dir: string;
  /** The project OpenCode ran in, a fresh git repository. */
  cwd: string;
  sessionID: string | undefined;
  /** The requests to the planned model, in order; OpenCode's title requests are left out. */
  requests: ScriptedRequest[];
  /** Under `run`, the parsed `--format json` lines. */
  events: { type: string; [key: string]: unknown }[];
  stdout: string;
  stderr: string;
  /** `run`'s exit code; under `serve`, null after the SIGTERM that ends it. */
  exitCode: number | null;
  cleanup(): void;
}

/** The OpenCode binary from the platform package `opencode-ai` depends on, if installed. */
export function opencodeBinary(): string | undefined {
  const arch = process.arch === "x64" ? "x64" : process.arch;
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const base = `opencode-${platform}-${arch}`;
  for (const name of [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]) {
    const binary = join(ROOT, "node_modules", name, "bin", "opencode");
    if (existsSync(binary)) return binary;
  }
  return undefined;
}

/** Why OpenCode cannot run here, or undefined. On CI a reason is a failure, not a skip. */
export function opencodeUnavailable(): string | undefined {
  if (!opencodeBinary()) return "OpenCode is not installed under node_modules; run npm ci";
  const { version } = JSON.parse(
    readFileSync(join(ROOT, "node_modules/opencode-ai/package.json"), "utf8"),
  );
  if (version !== CHECKED_VERSION && !process.env.CI)
    return `OpenCode ${version} is not the isolation-checked ${CHECKED_VERSION}; re-run test/fixtures/opencode/isolation-check.sh`;
  if (spawnSync("git", ["--version"]).status !== 0) return "git is not on PATH";
  return undefined;
}

export async function runOpenCode(options: OpenCodeRunOptions): Promise<OpenCodeRun> {
  const overridden = PROTECTED_ENV.filter((key) => key in (options.env ?? {}));
  if (overridden.length > 0)
    throw new Error(`runOpenCode isolates ${overridden.join(", ")}; a caller cannot override them`);
  const binary = opencodeBinary();
  if (!binary) throw new Error(opencodeUnavailable());
  const earlier = options.continue;
  if (earlier !== undefined && options.mode !== "run") throw new Error("only run continues");
  const dir = earlier?.dir ?? mkdtempSync(join(runBase(), "squeal-opencode-"));
  const provider = await startScriptedProvider({ plan: options.plan });
  let child: ChildProcess | undefined;
  try {
    const cwd = join(dir, "proj");
    const env = isolate(dir, options, provider.url);
    if (earlier === undefined) {
      for (const plugin of options.install ?? []) await pluginInstall(binary, plugin, cwd, env);
      for (const [path, text] of Object.entries(options.files ?? {})) {
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), text);
      }
      await options.setup?.(cwd);
    }
    options.onRequests?.(provider.requests);
    const run = ["run", "--format", "json", "-m", `scripted/${PLANNED_MODEL}`];
    const args =
      options.mode === "run"
        ? [...run, ...(earlier === undefined ? [] : ["--continue"]), options.prompt]
        : ["serve", "--hostname", "127.0.0.1", "--port", "0"];
    // Its own process group, so a timeout or the end of `serve` reaches what OpenCode started.
    child = spawnGroup(binary, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const out = collect(child);
    const timeoutMs = options.timeoutMs ?? 60_000;
    const deadline = new Promise<never>((_, fail) => {
      const timer = setTimeout(
        () =>
          fail(
            new Error(
              `OpenCode did not finish in ${timeoutMs}ms\n${out.stderr()}\n${out.stdout()}`,
            ),
          ),
        timeoutMs,
      );
      out.exited.finally(() => clearTimeout(timer));
    });
    deadline.catch(() => undefined);
    let sessionID: string | undefined;
    if (options.mode === "serve") {
      const server = child;
      try {
        const live = await Promise.race([converse(out, cwd, options.prompt), deadline]);
        sessionID = live.sessionID;
        const { afterReply } = options;
        if (afterReply) {
          const message = (text: string) => live.post(`/session/${live.sessionID}/message`, text);
          const reply = { ...live, requests: provider.requests, message };
          await Promise.race([afterReply(reply), deadline]);
        }
      } finally {
        killGroup(server, "SIGTERM");
      }
    }
    const exitCode = await Promise.race([out.exited, deadline]);
    const events = options.mode === "run" ? out.lines().flatMap(parseEvent) : [];
    sessionID ??= events.find((event) => typeof event.sessionID === "string")?.sessionID as string;
    return {
      dir,
      cwd,
      sessionID,
      requests: provider.requests.filter((request) => request.model === PLANNED_MODEL),
      events,
      stdout: out.stdout(),
      stderr: out.stderr(),
      exitCode,
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    if (earlier === undefined) rmSync(dir, { recursive: true, force: true });
    throw error;
  } finally {
    if (child) killGroup(child, "SIGKILL");
    await provider.close();
  }
}

/**
 * The run's directories and environment. Writes the scripted provider into the run's
 * `OPENCODE_CONFIG_DIR/opencode.json`, so the project holds only what the test wrote.
 */
function isolate(dir: string, options: OpenCodeRunOptions, url: string): NodeJS.ProcessEnv {
  const configDir = join(dir, "opencode-config");
  const xdg = (name: string) => join(dir, "xdg", name);
  for (const path of ["proj", "home", "tmp", "opencode-config/plugins"])
    mkdirSync(join(dir, path), { recursive: true });
  for (const name of ["config/opencode", "data", "cache", "state"])
    mkdirSync(xdg(name), { recursive: true });
  seed(xdg("config/opencode"));
  seed(configDir);
  for (const plugin of options.plugins ?? [])
    symlinkSync(resolve(plugin), join(configDir, "plugins", basename(plugin)));
  writeFileSync(join(configDir, "opencode.json"), JSON.stringify(config(url), null, 2));
  // A repository of its own, so OpenCode's upward search for config, instructions and ignore
  // files stops at the project.
  const init = spawnSync("git", ["init", "-q"], { cwd: join(dir, "proj") });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  return {
    PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
    ...options.env,
    HOME: join(dir, "home"),
    TMPDIR: join(dir, "tmp"),
    XDG_CONFIG_HOME: xdg("config"),
    XDG_DATA_HOME: xdg("data"),
    XDG_CACHE_HOME: xdg("cache"),
    XDG_STATE_HOME: xdg("state"),
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
  };
}

/**
 * OpenCode npm-installs `@opencode-ai/plugin` into each config directory unless its
 * `node_modules` exists and its lock lists the package (`packages/core/src/npm.ts` at 1.18.35).
 * The link is this repository's pinned copy, so a plugin under test can import it.
 */
function seed(configDir: string): void {
  if (existsSync(join(configDir, "node_modules/@opencode-ai/plugin"))) return;
  const dependencies = { "@opencode-ai/plugin": CHECKED_VERSION };
  mkdirSync(join(configDir, "node_modules/@opencode-ai"), { recursive: true });
  symlinkSync(PLUGIN_PACKAGE, join(configDir, "node_modules/@opencode-ai/plugin"));
  writeFileSync(join(configDir, "package.json"), JSON.stringify({ dependencies }));
  writeFileSync(
    join(configDir, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies } } }),
  );
}

function config(url: string) {
  return {
    $schema: "https://opencode.ai/config.json",
    provider: {
      scripted: {
        // Bundled in OpenCode 1.18.35, so loading it fetches no package (wave-0 check 2).
        npm: "@ai-sdk/openai-compatible",
        name: "Scripted",
        options: { baseURL: url, apiKey: "not-a-credential" },
        models: {
          [PLANNED_MODEL]: { name: "Scripted" },
          [SMALL_MODEL]: { name: "Scripted small" },
        },
      },
    },
    model: `scripted/${PLANNED_MODEL}`,
    // Titles go to their own model, so they never take a planned step.
    small_model: `scripted/${SMALL_MODEL}`,
    permission: { edit: "allow", bash: "allow" },
    share: "disabled",
    autoupdate: false,
  };
}

/** Under `serve`: one session in the project, one message, the reply awaited. */
async function converse(
  out: ReturnType<typeof collect>,
  cwd: string,
  prompt: string,
): Promise<{ url: string; sessionID: string; post(path: string, text: string): Promise<void> }> {
  const url = await new Promise<string>((done, fail) => {
    const check = () => {
      const match = out.stdout().match(/listening on (http:\/\/\S+)/);
      if (match?.[1]) {
        stop();
        done(match[1]);
      }
    };
    const stop = out.onData(check);
    out.exited.then(() =>
      fail(new Error(`opencode serve exited before listening\n${out.stderr()}`)),
    );
    check();
  });
  const post = async (path: string, body: object) => {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-opencode-directory": cwd },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`POST ${path}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<{ id: string }>;
  };
  const session = await post("/session", {});
  const message = async (path: string, text: string) => {
    await post(path, { parts: [{ type: "text", text }] });
  };
  await message(`/session/${session.id}/message`, prompt);
  return { url, sessionID: session.id, post: message };
}

/**
 * `opencode plugin file:<dir> -g` in the run's environment, from the project before the test's
 * files are written: it writes the run's global `opencode.json` and links `dir` from the run's
 * cache (wave-0 check 3).
 */
async function pluginInstall(
  binary: string,
  dir: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const child = spawnGroup(binary, ["plugin", `file:${dir}`, "-g"], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = collect(child);
  const timer = setTimeout(() => killGroup(child, "SIGKILL"), 60_000);
  const exitCode = await out.exited.finally(() => clearTimeout(timer));
  killGroup(child, "SIGKILL");
  if (exitCode !== 0)
    throw new Error(
      `opencode plugin file:${dir} -g exited ${exitCode}\n${out.stderr()}\n${out.stdout()}`,
    );
}

/**
 * The process groups `spawnGroup` started and no `SIGKILL` has ended yet. The `finally` that
 * started one kills it; when the Vitest worker ends first (a timeout, or the SIGTERM Vitest
 * stops a fork with), its end kills them, so no `opencode serve` outlives the worker. The
 * handlers are installed once per process; each kills the groups, removes itself and re-raises
 * its signal, leaving any other listener in place. Uncovered: a SIGKILLed worker runs nothing,
 * so what it started outlives it.
 */
const liveGroups = new Set<number>();
let endHooked = false;

/** `spawn` as the leader of its own process group, which this process's end kills (`liveGroups`). */
export function spawnGroup(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  if (!endHooked) {
    endHooked = true;
    process.on("exit", killLiveGroups);
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
      process.once(signal, () => {
        killLiveGroups();
        // The signal's own effect, now this listener is gone: by default, the end of the process.
        process.kill(process.pid, signal);
      });
  }
  const child = spawn(command, args, { ...options, detached: true });
  if (child.pid !== undefined) liveGroups.add(child.pid);
  return child;
}

function killLiveGroups(): void {
  for (const pid of liveGroups) kill(pid, "SIGKILL");
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  kill(child.pid, signal);
}

function kill(group: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-group, signal);
  } catch {
    // The group is gone.
  }
  if (signal === "SIGKILL") liveGroups.delete(group);
}

/** The text of a chat message's content, string or parts. */
export function textOf(message: { content?: unknown } | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function collect(child: ChildProcess) {
  let stdout = "";
  let stderr = "";
  const listeners = new Set<() => void>();
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    for (const listener of listeners) listener();
  });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
  return {
    exited,
    stdout: () => stdout,
    stderr: () => stderr,
    lines: () => stdout.split("\n").filter(Boolean),
    onData: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function parseEvent(line: string): OpenCodeRun["events"] {
  try {
    const value = JSON.parse(line);
    return value && typeof value.type === "string" ? [value] : [];
  } catch {
    return [];
  }
}
