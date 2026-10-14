import { spawn } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { posix } from "node:path";
import { redact, secretsOf } from "../../evals/lib/index.mjs";

/*
 * The one place the real-CLI suite starts a process for the subject (row
 * 005-17). Scratch HOME variables alone are not isolation, since a harness's
 * own setup code can ignore them, so every command runs as the throwaway OS
 * user `squeal-e2e`, which cannot enter the real home (the coordinator's
 * contract of 2026-10-13):
 *
 *   sudo -n [--preserve-env=<names>] -u squeal-e2e -H env -i HOME=… PATH=… <scratch vars> <cmd>
 *
 * spawned with cwd "/", since this worktree is unreadable to that user. Inside
 * it, each case still has its own HOME, CODEX_HOME, CLAUDE_CONFIG_DIR, TMPDIR
 * and XDG_RUNTIME_DIR under `/home/squeal-e2e/runs/<id>/`. The guard below
 * runs before every spawn.
 */

export const USER = "squeal-e2e";
export const USER_HOME = "/home/squeal-e2e";
export const RUNS = `${USER_HOME}/runs`;
/** The harness CLIs installed for that user, pinned to the host's versions. */
export const CLI_BIN = `${USER_HOME}/.npm-global/bin`;

/** The Node the subject runs: `SQ_REAL_CLI_NODE`, 22 or 24, default 24. */
export function nodeMajor(env: NodeJS.ProcessEnv = process.env): "22" | "24" {
  const value = env.SQ_REAL_CLI_NODE ?? "24";
  if (value !== "22" && value !== "24") throw new Error(`SQ_REAL_CLI_NODE=${value}: 22 or 24`);
  return value;
}

export const nodeBin = (major = nodeMajor()) => `/opt/squeal-e2e/node${major}/bin`;

export interface Spawn {
  /** The case root, `/home/squeal-e2e/runs/<id>`: every scratch variable lies under it. */
  readonly root: string;
  readonly cmd: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** The scratch variables, written into the command line: never a credential. */
  readonly env: Readonly<Record<string, string>>;
  /** Directories put before the Node and system ones on PATH, each under `root`. */
  readonly path: readonly string[];
  /** Names of credentials the subject keeps, passed by `--preserve-env`, never by value. */
  readonly preserve?: readonly string[];
  readonly input?: string | Buffer;
  readonly timeoutMs?: number;
}

export interface Ran {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
}

/** The scratch variables a command may carry; anything else is refused. */
const ALLOWED = new Set([
  "HOME",
  "TMPDIR",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "XDG_RUNTIME_DIR",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "DISABLE_AUTOUPDATER",
  "SQUEAL_MARKETPLACE",
  "SQUEAL_BIN_DIR",
  "CLAUDE_PLUGIN_ROOT",
  "CLAUDE_PROJECT_DIR",
  "PLUGIN_ROOT",
  "PWD",
  "LANG",
]);

/** The variables that must be set, each to a directory under the case root. */
const SCRATCH = ["HOME", "TMPDIR", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "XDG_RUNTIME_DIR"];

const inside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);
const strictlyInside = (path: string, dir: string) => path.startsWith(`${dir}/`);

const SECRETS = secretsOf(process.env);

/**
 * Throws unless the command keeps to its case: run as another user than this
 * one; HOME and every scratch directory strictly under the case root, never
 * the real home or the user's own; PATH additions and cwd under the root; no
 * variable outside the allowed set, and no credential in a value, the command
 * or an argument, since all of them reach process argv (005-42 S1). `secrets`
 * defaults to the host's.
 */
export function guard(s: Spawn, secrets: readonly string[] = SECRETS): void {
  if (userInfo().username === USER) throw new Error(`refused: the suite itself runs as ${USER}`);
  const root = posix.normalize(s.root);
  if (!/^\/home\/squeal-e2e\/runs\/[a-z0-9-]+$/.test(root))
    throw new Error(`refused: case root ${s.root} is not ${RUNS}/<id>`);
  const real = [homedir(), userInfo().homedir, process.env.HOME ?? "/nonexistent"].map((h) =>
    posix.normalize(h),
  );
  for (const name of SCRATCH) {
    const value = s.env[name];
    if (value === undefined) throw new Error(`refused: ${name} is not set`);
    const path = posix.normalize(value);
    if (real.some((h) => inside(path, h) || inside(h, path)))
      throw new Error(`refused: ${name} resolves to the real home (${path})`);
    if (path === USER_HOME || !strictlyInside(path, root))
      throw new Error(`refused: ${name}=${path} is not under the case root ${root}`);
  }
  for (const [name, value] of Object.entries(s.env)) {
    if (!ALLOWED.has(name)) throw new Error(`refused: variable ${name} is not a scratch variable`);
    if (/[\n\0]/.test(value)) throw new Error(`refused: ${name} holds a newline`);
    if (secrets.some((secret) => value.includes(secret)))
      throw new Error(`refused: ${name} holds a credential`);
  }
  const argv = new Map([
    ["the command", s.cmd],
    ...s.args.map((arg, i) => [`argument ${i + 1}`, arg] as const),
  ]);
  for (const [what, value] of argv)
    if (secrets.some((secret) => value.includes(secret)))
      throw new Error(`refused: ${what} holds a credential`);
  for (const dir of s.path)
    if (!strictlyInside(posix.normalize(dir), root))
      throw new Error(`refused: PATH entry ${dir} is outside ${root}`);
  if (!inside(posix.normalize(s.cwd), root))
    throw new Error(`refused: cwd ${s.cwd} is outside ${root}`);
  for (const name of s.preserve ?? [])
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`refused: preserve name ${name}`);
}

/** The sudo arguments for `s`; credentials appear only as names. */
export function commandLine(s: Spawn): string[] {
  const path = [...s.path, nodeBin(), "/usr/bin", "/bin"].join(":");
  const preserve = s.preserve ?? [];
  return [
    "-n",
    ...(preserve.length > 0 ? [`--preserve-env=${preserve.join(",")}`] : []),
    "-u",
    USER,
    "-H",
    "env",
    // With credentials kept, sudo's own env_reset is the clean start: `-i` would drop them too.
    ...(preserve.length > 0 ? [] : ["-i"]),
    ...Object.entries({ ...s.env, PATH: path }).map(([k, v]) => `${k}=${v}`),
    "/bin/sh",
    "-c",
    'mkdir -p "$1" && cd "$1" || exit 125; shift; exec "$@"',
    "sh",
    s.cwd,
    s.cmd,
    ...s.args,
  ];
}

/**
 * Runs one command as the throwaway user, in its own process group so a
 * timeout reaches what it started; every output is redacted of the host's
 * credentials and provider URLs before it is returned.
 */
export function runIsolated(s: Spawn): Promise<Ran> {
  guard(s);
  const started = Date.now();
  const parentEnv: Record<string, string> = { PATH: "/usr/bin:/bin" };
  for (const name of s.preserve ?? []) {
    const value = process.env[name];
    if (value !== undefined) parentEnv[name] = value;
  }
  return new Promise((done) => {
    const child = spawn("sudo", commandLine(s), {
      cwd: "/",
      env: parentEnv,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        // The group is gone, or the other user's: the wait still ends below.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 5_000).unref();
    }, s.timeoutMs ?? 120_000);
    child.on("error", (error) => err.push(Buffer.from(`spawn sudo: ${error.message}\n`)));
    // `exit`, not `close`: a daemon the command started may hold the pipes open.
    child.on("exit", (status, signal) => {
      clearTimeout(timer);
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        done({
          status,
          signal,
          timedOut,
          stdout: redact(Buffer.concat(out).toString("utf8"), SECRETS),
          stderr: redact(Buffer.concat(err).toString("utf8"), SECRETS),
          ms: Date.now() - started,
        });
      }, 200);
    });
    child.stdin.on("error", () => {
      // The command exited before reading its input.
    });
    child.stdin.end(s.input ?? "");
  });
}
