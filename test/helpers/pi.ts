import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

/**
 * The real Pi with a scripted fake model (spec 009 Testing). Each run gets its own temp
 * directory holding Pi's agent dir, HOME, TMPDIR and the project, so nothing reaches the
 * user's `~/.pi`, `~/.agents/skills` or the shared `/tmp` caches; the wave-0 isolation check
 * (`docs/specifications/009-pi-adapter/research/wave-0-checks.md`) found no write outside it.
 * The model is `test/fixtures/pi/fake-provider.ts`: it plays `plan` one step per request and
 * records every request, which the run returns.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const PI_PACKAGE = join(ROOT, "node_modules/@earendil-works/pi-coding-agent");
export const PI_CLI = join(PI_PACKAGE, "dist/bundle/cli.js");
export const FAKE_PROVIDER = join(ROOT, "test/fixtures/pi/fake-provider.ts");

/** The Pi version the isolation check ran against; another version skips until it is re-run. */
const CHECKED_VERSION = "1.0.4";
const MIN_NODE = [22, 19];

export type PiMode = "print" | "json" | "rpc";

/** One model response: text, then tool calls (`call_<request>_<index>`). */
export interface FakeStep {
  text?: string;
  tools?: { name: string; arguments: Record<string, unknown> }[];
  delayMs?: number;
  /** Hold the response until Pi aborts the request. */
  waitAbort?: boolean;
}

/** A message as the provider received it (Pi's `context.messages`). */
export interface PiMessage {
  role: string;
  content?: unknown;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  customType?: string;
  [key: string]: unknown;
}

export interface PiRequest {
  n: number;
  systemPrompt: string;
  messages: PiMessage[];
}

/** RPC `compact`: Pi summarizes the session with one model request. */
export interface RpcCompact {
  type: "compact";
}

export interface PiRunOptions {
  mode: PiMode;
  plan: FakeStep[];
  /**
   * One prompt for `print` and `json`; under `rpc` each is sent after the previous run settles,
   * and a `compact` command after the previous one answers.
   */
  prompts: (string | RpcCompact)[];
  /** Extensions under test, loaded with `-e` after the fake provider. */
  extensions?: string[];
  /**
   * An existing project directory to run Pi in instead of a fresh one in the run's directory.
   * It must be outside this repository, as the run's own is (Pi loads `AGENTS.md` up the tree).
   */
  cwd?: string;
  /** Files written into the project before Pi starts, by relative path. */
  files?: Record<string, string>;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface PiRun {
  /** The run's temp directory; `cleanup()` removes it. */
  dir: string;
  /** The project Pi ran in. */
  cwd: string;
  agentDir: string;
  requests: PiRequest[];
  /** Parsed stdout lines under `json` and `rpc`. */
  events: { type: string; [key: string]: unknown }[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  cleanup(): void;
}

/** Why Pi cannot run here, or undefined. On CI a reason is a failure, not a skip. */
export function piUnavailable(): string | undefined {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < (MIN_NODE[0] ?? 0) || (major === MIN_NODE[0] && minor < (MIN_NODE[1] ?? 0)))
    return `Pi needs Node ${MIN_NODE.join(".")}, this is ${process.versions.node}`;
  if (!existsSync(PI_CLI)) return `Pi is not installed at ${PI_CLI}; run npm ci`;
  const { version } = JSON.parse(readFileSync(join(PI_PACKAGE, "package.json"), "utf8"));
  if (version !== CHECKED_VERSION && !process.env.CI)
    return `Pi ${version} is not the isolation-checked ${CHECKED_VERSION}; re-run test/fixtures/pi/isolation-check.sh`;
  return undefined;
}

export async function runPi(options: PiRunOptions): Promise<PiRun> {
  const dir = mkdtempSync(join(tmpdir(), "squeal-pi-"));
  const cwd = options.cwd ?? join(dir, "proj");
  const agentDir = join(dir, "agent");
  for (const sub of ["proj", "agent", "home", "tmp"]) mkdirSync(join(dir, sub));
  for (const [path, text] of Object.entries(options.files ?? {})) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  const planPath = join(dir, "plan.json");
  const logPath = join(dir, "requests.jsonl");
  writeFileSync(planPath, JSON.stringify(options.plan));

  const env: NodeJS.ProcessEnv = {
    PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
    HOME: join(dir, "home"),
    TMPDIR: join(dir, "tmp"),
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_FIXTURE_PLAN: planPath,
    PI_FIXTURE_LOG: logPath,
    ...options.env,
  };
  const args = [PI_CLI, "--provider", "fake", "--model", "fake-1", "-e", FAKE_PROVIDER];
  for (const extension of options.extensions ?? []) args.push("-e", extension);
  const [first = ""] = options.prompts;
  const prompt = typeof first === "string" ? first : "";
  if (options.mode === "print") args.push("-p", prompt);
  if (options.mode === "json") args.push("--mode", "json", "-p", prompt);
  if (options.mode === "rpc") args.push("--mode", "rpc");

  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: [options.mode === "rpc" ? "pipe" : "ignore", "pipe", "pipe"],
  });
  const out = collect(child);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  try {
    if (options.mode === "rpc") await drive(child, out, options.prompts, timeoutMs);
    const exitCode = await out.exited;
    if (exitCode === null)
      throw new Error(`Pi did not finish in ${timeoutMs}ms\n${out.stderr()}\n${out.stdout()}`);
    const events = options.mode === "print" ? [] : out.lines().flatMap(parseEvent);
    return {
      dir,
      cwd,
      agentDir,
      requests: readRequests(logPath),
      events,
      stdout: out.stdout(),
      stderr: out.stderr(),
      exitCode,
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** The text parts of a message's content. */
export function textOf(message: PiMessage | undefined): string {
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

// Each prompt waits for the run it starts to settle, a compact for its response; stdin closes
// after the last, which ends Pi.
async function drive(
  child: ChildProcess,
  out: ReturnType<typeof collect>,
  prompts: (string | RpcCompact)[],
  timeoutMs: number,
): Promise<void> {
  const count = (marker: string) => out.lines().filter((line) => line.includes(marker)).length;
  for (const [index, input] of prompts.entries()) {
    const marker = typeof input === "string" ? '"type":"agent_settled"' : '"command":"compact"';
    const settled = () => count(marker);
    const before = settled();
    const command = typeof input === "string" ? { type: "prompt", message: input } : input;
    child.stdin?.write(`${JSON.stringify({ id: `p${index}`, ...command })}\n`);
    await new Promise<void>((done, fail) => {
      const check = () => {
        if (settled() > before) finish(done);
      };
      const finish = (then: () => void) => {
        stop();
        clearTimeout(timer);
        child.off("exit", exited);
        then();
      };
      const exited = () =>
        finish(() => fail(new Error(`Pi exited before prompt ${index} settled`)));
      const timer = setTimeout(
        () => finish(() => fail(new Error(`prompt ${index} did not settle in ${timeoutMs}ms`))),
        timeoutMs,
      );
      const stop = out.onData(check);
      child.on("exit", exited);
      check();
    });
  }
  child.stdin?.end();
}

function parseEvent(line: string): PiRun["events"] {
  try {
    const value = JSON.parse(line);
    return value && typeof value.type === "string" ? [value] : [];
  } catch {
    return [];
  }
}

function readRequests(path: string): PiRequest[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PiRequest);
}
