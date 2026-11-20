import { readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { AbsolutePath } from "../types/common.js";

/*
 * Spec 023 D6 (row 023-31, round 4 R6): before Squeal removes a checkout, it
 * ends every process of this user whose working folder, or one of whose
 * command-line arguments, lies under the checkout. A test harness's server
 * and 15 headless browsers outlived a removed checkout and `squeal stop`
 * (cwd "(deleted)"), since they had left the run's process group. Never
 * signalled: another user's process, this process and its ancestors, and any
 * process whose path only shares a prefix with the checkout's. Linux only,
 * through `/proc`; where there is none (macOS), nothing is scanned and the
 * run's process-group stop is all that ends its processes.
 */

/** How long the processes get between SIGTERM and SIGKILL. */
export const LEFT_GRACE_MS = 2_000;
/** How long a SIGKILL gets before a process still there is told as still running. */
const KILL_WAIT_MS = 500;
const POLL_MS = 50;

export interface LeftProcess {
  readonly pid: number;
  /** What the report calls it: `chrome`, `cezar serve`, `agent-browser`. */
  readonly name: string;
}

export interface LeftUnder {
  /** The processes that ended. */
  readonly ended: readonly LeftProcess[];
  /** The processes still there after SIGKILL (a process in uninterruptible sleep). */
  readonly running: readonly LeftProcess[];
}

export interface EndLeftOptions {
  /** The directory `proc` lies in: `/` but in tests. */
  readonly root?: string;
  readonly graceMs?: number;
  /** The caller's pid: it and its ancestors are never signalled. */
  readonly self?: number;
  readonly uid?: number;
}

interface Found extends LeftProcess {
  readonly start: string;
}

/** Ends the processes left under `folder`; `null` where no `/proc` can be read. */
export async function endLeftUnder(
  folder: AbsolutePath,
  options: EndLeftOptions = {},
): Promise<LeftUnder | null> {
  const proc = join(options.root ?? "/", "proc");
  const uid = options.uid ?? process.getuid?.();
  const found = uid === undefined ? null : scan(proc, folder, uid, options.self ?? process.pid);
  if (found === null) return null;
  if (found.length === 0) return { ended: [], running: [] };
  for (const f of found) signal(f.pid, "SIGTERM");
  let left = await waitGone(proc, found, options.graceMs ?? LEFT_GRACE_MS);
  if (left.length > 0) {
    for (const f of left) if (startOf(proc, f.pid) === f.start) signal(f.pid, "SIGKILL");
    left = await waitGone(proc, left, KILL_WAIT_MS);
  }
  const still = new Set(left.map((f) => f.pid));
  const plain = ({ pid, name }: Found): LeftProcess => ({ pid, name });
  return {
    ended: found.filter((f) => !still.has(f.pid)).map(plain),
    running: left.map(plain),
  };
}

/** `uid`'s processes under `folder`, but `self` and its ancestors; `null` with no `/proc`. */
function scan(proc: string, folder: AbsolutePath, uid: number, self: number): Found[] | null {
  const pids = pidsIn(proc);
  if (pids === null) return null;
  const spared = ancestors(proc, self);
  const paths = pathsOf(folder);
  const found: Found[] = [];
  for (const pid of pids) {
    if (spared.has(pid) || ownerOf(proc, pid) !== uid) continue;
    const start = startOf(proc, pid);
    if (start === null) continue;
    const argv = argvOf(proc, pid);
    const cwd = cwdOf(proc, pid);
    const under =
      (cwd !== null && paths.some((p) => within(cwd, p))) ||
      argv.some((arg) => paths.some((p) => mentions(arg, p)));
    if (under) found.push({ pid, start, name: nameOf(proc, pid, argv) });
  }
  return found;
}

/** The report's line:"ended 17 processes left under the checkout (cezar serve, chrome ×15)". */
export function leftUnderText(left: LeftUnder | null): string | null {
  if (left === null) return null;
  const parts: string[] = [];
  if (left.ended.length > 0)
    parts.push(`ended ${count(left.ended)} left under the checkout (${names(left.ended)})`);
  if (left.running.length > 0)
    parts.push(
      `${count(left.running)} under the checkout still running after SIGKILL (${names(left.running)})`,
    );
  return parts.length === 0 ? null : parts.join("; ");
}

function count(processes: readonly LeftProcess[]): string {
  return `${processes.length} ${processes.length === 1 ? "process" : "processes"}`;
}

/** Each name once, in the order first seen, with `×n` when more than one process has it. */
function names(processes: readonly LeftProcess[]): string {
  const counts = new Map<string, number>();
  for (const { name } of processes) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n === 1 ? name : `${name} ×${n}`)).join(", ");
}

/** The folder as given and as `/proc` shows it, its real path. */
function pathsOf(folder: AbsolutePath): string[] {
  const paths = [folder.replace(/\/+$/, "")];
  try {
    const real = realpathSync(folder);
    if (real !== paths[0]) paths.push(real);
  } catch {
    // A folder already gone has no real path; the given one is all there is.
  }
  return paths;
}

/** `path` is `folder` or below it; a cwd removed since reads with " (deleted)". */
function within(path: string, folder: string): boolean {
  const bare = path.endsWith(" (deleted)") ? path.slice(0, -" (deleted)".length) : path;
  return bare === folder || bare.startsWith(`${folder}/`);
}

/** `arg` holds `folder` as a whole path or the start of one (`--user-data-dir=<folder>/x`). */
function mentions(arg: string, folder: string): boolean {
  for (let at = arg.indexOf(folder); at >= 0; at = arg.indexOf(folder, at + 1)) {
    const next = arg[at + folder.length];
    if (next === undefined || !/[\w.-]/.test(next)) return true;
  }
  return false;
}

async function waitGone(proc: string, found: readonly Found[], ms: number): Promise<Found[]> {
  const deadline = performance.now() + ms;
  let left = found.filter((f) => alive(proc, f));
  while (left.length > 0 && performance.now() < deadline) {
    await sleep(POLL_MS);
    left = left.filter((f) => alive(proc, f));
  }
  return left;
}

/** The same process (pid and start time) is there and not a zombie. */
function alive(proc: string, f: Found): boolean {
  const stat = read(proc, `${f.pid}/stat`);
  if (stat === null) return false;
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return fields[19] === f.start && fields[0] !== "Z";
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // Gone since the scan.
  }
}

function pidsIn(proc: string): number[] | null {
  try {
    return readdirSync(proc)
      .filter((name) => /^\d+$/.test(name))
      .map(Number);
  } catch {
    return null;
  }
}

/** `pid` and each process above it, up to init. */
function ancestors(proc: string, pid: number): Set<number> {
  const seen = new Set<number>();
  for (let at = pid; at > 0 && !seen.has(at); ) {
    seen.add(at);
    const stat = read(proc, `${at}/stat`);
    if (stat === null) break;
    at = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
  }
  return seen;
}

/** `stat` field 22, the start time in clock ticks: with the pid, the process's identity. */
function startOf(proc: string, pid: number): string | null {
  const stat = read(proc, `${pid}/stat`);
  if (stat === null) return null;
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return fields[0] === "Z" ? null : (fields[19] ?? null);
}

function ownerOf(proc: string, pid: number): number | null {
  try {
    return statSync(join(proc, String(pid))).uid;
  } catch {
    return null;
  }
}

function cwdOf(proc: string, pid: number): string | null {
  try {
    return readlinkSync(join(proc, String(pid), "cwd"));
  } catch {
    return null;
  }
}

function argvOf(proc: string, pid: number): string[] {
  const text = read(proc, `${pid}/cmdline`) ?? "";
  return text.split("\0").filter((arg) => arg !== "");
}

const INTERPRETERS = /^(node|nodejs|bun|deno|python[\d.]*|ruby|perl|sh|bash|dash|zsh)$/;
const LAUNCHERS = new Set(["index", "cli", "main", "bin", "dist", "src", "lib", "build", ".bin"]);

/**
 * The process's command name (`chrome`, `agent-browser`), from its first
 * argument; `comm` (Node 26's is `node-MainThread`) only without one. A
 * browser that rewrote its arguments into one string is cut at its first
 * option. For an interpreter it is the script's name, and its first word
 * argument when it has one: `node .../cezar/dist/index.js serve` is `cezar serve`.
 */
function nameOf(proc: string, pid: number, argv: readonly string[]): string {
  const first = (argv[0] ?? "").split(" -")[0] ?? "";
  const command = basename(first) || (read(proc, `${pid}/comm`) ?? "").trim() || `pid ${pid}`;
  if (!INTERPRETERS.test(command)) return command;
  const at = scriptAt(argv);
  const script = argv[at];
  if (at < 0 || script === undefined) return command;
  let path = script;
  let name = basename(path, extname(path));
  while (LAUNCHERS.has(name) && dirname(path) !== path) {
    path = dirname(path);
    name = basename(path);
  }
  const word = argv[at + 1];
  return word !== undefined && /^[a-z][a-z0-9-]*$/.test(word) ? `${name} ${word}` : name;
}

/** Inline code (`-e`, `-c`) names no script; a `-r`, `--import` value is not the script. */
const INLINE = new Set(["-e", "--eval", "-p", "--print", "-c"]);
const VALUED = new Set(["-r", "--require", "--import", "--loader", "-m"]);

/** Where the interpreter's script is in `argv`; -1 when there is none. */
function scriptAt(argv: readonly string[]): number {
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (INLINE.has(arg)) return -1;
    if (VALUED.has(arg)) i++;
    else if (!arg.startsWith("-")) return i;
  }
  return -1;
}

function read(proc: string, path: string): string | null {
  try {
    return readFileSync(join(proc, path), "utf8");
  } catch {
    return null;
  }
}
