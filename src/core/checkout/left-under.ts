import {
  type BigIntStats,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { AbsolutePath } from "../types/common.js";

/*
 * Spec 023 D6 (row 023-31, round 4 R6): before Squeal removes a checkout, it
 * ends every process of this user whose working folder lies under the
 * checkout. A test harness's server and 15 headless browsers outlived a
 * removed checkout and `squeal stop` (cwd "(deleted)"), since they had left
 * the run's process group. Only the working folder the kernel reports counts
 * (the human, 2026-11-21, after review wave-18's re-review: "A: working
 * folder only"); no command-line argument does, since an argument is no
 * proof of where a process works. Never signalled: another user's process,
 * this process and its ancestors. Each process is checked again (start
 * time, owner, working folder) just before its SIGTERM and its SIGKILL
 * (review wave-18 note 1). Linux only, through `/proc`; where there
 * is none (macOS), nothing is scanned, the note says so once, and the run's
 * process-group stop is all that ends its processes.
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
  const scanned = scanLeftUnder(folder, options);
  return scanned === null ? null : endScanned(scanned, options);
}

/** What a scan found, and what each process is checked against again before its signal. */
export interface Scanned {
  readonly proc: string;
  readonly folder: string;
  readonly uid: number;
  readonly found: readonly Found[];
}

/** `uid`'s processes under `folder`, but `self` and its ancestors; `null` with no `/proc`. */
export function scanLeftUnder(folder: AbsolutePath, options: EndLeftOptions = {}): Scanned | null {
  const proc = join(options.root ?? "/", "proc");
  const uid = options.uid ?? process.getuid?.();
  const pids = pidsIn(proc);
  if (uid === undefined || pids === null) return null;
  const spared = ancestors(proc, options.self ?? process.pid);
  const real = realFolder(folder);
  const found: Found[] = [];
  for (const pid of pids) {
    if (spared.has(pid) || ownerOf(proc, pid) !== uid) continue;
    const start = startOf(proc, pid);
    if (start === null) continue;
    if (cwdUnder(real, cwdOf(proc, pid)))
      found.push({ pid, start, name: nameOf(proc, pid, argvOf(proc, pid)) });
  }
  return { proc, folder: real, uid, found };
}

/** SIGTERM to each found process still the same, still `uid`'s and still under; SIGKILL after the grace, checked again. */
export async function endScanned(
  scanned: Scanned,
  options: EndLeftOptions = {},
): Promise<LeftUnder> {
  const { proc, folder, uid } = scanned;
  const same = (f: Found) =>
    startOf(proc, f.pid) === f.start &&
    ownerOf(proc, f.pid) === uid &&
    cwdUnder(folder, cwdOf(proc, f.pid));
  const signalled = scanned.found.filter((f) => same(f) && signal(f.pid, "SIGTERM"));
  if (signalled.length === 0) return { ended: [], running: [] };
  let left = await waitGone(proc, signalled, options.graceMs ?? LEFT_GRACE_MS);
  if (left.length > 0) {
    for (const f of left) if (same(f)) signal(f.pid, "SIGKILL");
    left = await waitGone(proc, left, KILL_WAIT_MS);
  }
  const still = new Set(left.map((f) => f.pid));
  const plain = ({ pid, name }: Found): LeftProcess => ({ pid, name });
  return {
    ended: signalled.filter((f) => !still.has(f.pid)).map(plain),
    running: left.map(plain),
  };
}

/** The checkout folder's real path; resolved as given once it is gone. */
function realFolder(folder: AbsolutePath): string {
  try {
    return realpathSync(folder);
  } catch {
    return resolve(folder);
  }
}

/** `cwd`, the folder a process works in, is `folder` or below it, by whole components. */
function cwdUnder(folder: string, cwd: string | null): boolean {
  if (cwd === null) return false;
  return cwd === folder || cwd.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
}

let skipTold = false;

/**
 * The note for `removeTree`: the processes ended, or, once per process,
 * that no scan could run (review wave-18 note 2); `null` when there is
 * nothing to tell.
 */
export function leftUnderNote(left: LeftUnder | null | Error): string | null {
  if (left instanceof Error)
    return `could not look for processes left under the checkout: ${left.message}`;
  if (left !== null) return leftUnderText(left);
  if (skipTold) return null;
  skipTold = true;
  return `did not look for processes left under the checkout: ${process.platform} has no /proc to read; only the run's process group was stopped`;
}

/** The report's line:"ended 17 processes left under the checkout (cezar serve, chrome ×15)". */
export function leftUnderText(left: LeftUnder): string | null {
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

/** False when the process is gone since the scan. */
function signal(pid: number, name: NodeJS.Signals): boolean {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    return false;
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

const DELETED = " (deleted)";

/**
 * The folder `pid` works in. The kernel reads a removed folder as its old
 * path plus " (deleted)", and a live folder can hold that text in its name
 * (review wave-18, third and fourth looks). Which one it is comes from the
 * kernel's own stat of `/proc/<pid>/cwd`, never from the path as written:
 * a removed directory has no links left (`nlink` 0), so only then is the
 * suffix stripped; with links, the text is a live folder's real name. The
 * written path is never read, so no error there (a parent made
 * unsearchable) can make an outside folder read as the checkout. `null`
 * when the link or its stat cannot be read: never under, so never signalled.
 */
function cwdOf(proc: string, pid: number): string | null {
  const link = join(proc, String(pid), "cwd");
  let text: string;
  let own: BigIntStats;
  try {
    text = readlinkSync(link);
    own = statSync(link, { bigint: true });
  } catch {
    return null;
  }
  if (!text.endsWith(DELETED)) return text;
  return own.nlink === 0n ? text.slice(0, -DELETED.length) : text;
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
