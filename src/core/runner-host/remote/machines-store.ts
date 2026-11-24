import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { isRecord } from "../../fs/json.js";
import type { AbsolutePath } from "../../types/common.js";
import type { MachineRecord } from "./provider.js";

/*
 * Spec 026 D7.3, D12 (row 026-10): the machines the remote lanes acquired,
 * by `(provider, worktreeId)`, in `$XDG_STATE_HOME/squeal/remote-machines.json`
 * (default `~/.local/state/squeal/remote-machines.json`). The user's state,
 * never a repository's: `squeal remote list`, `sleep` and `prune` read it
 * with no daemon running. Each write replaces the file whole (write, then
 * rename), so a reader never sees half a file. Review 0.1.616 S1: each
 * read-change-write holds `remote-machines.json.lock`, so two daemons'
 * writes at once lose no record; a lock whose holder died, or older than
 * `STALE_LOCK_MS`, is taken over.
 */

export const MACHINES_FILE = "remote-machines.json";

/** How long a writer waits for the lock before its write fails. */
const LOCK_WAIT_MS = 10_000;
/** A lock this old is a dead writer's: no write holds it this long. */
const STALE_LOCK_MS = 30_000;
const LOCK_RETRY_MS = 5;

export interface Machines {
  readonly path: AbsolutePath;
  readonly machines: readonly MachineRecord[];
  /** The file could not be read or is not this shape; `machines` is then empty. */
  readonly problem?: string;
}

/** `$XDG_STATE_HOME/squeal/remote-machines.json`; an empty or relative `XDG_STATE_HOME` is ignored. */
export function machinesPath(env: NodeJS.ProcessEnv = process.env): AbsolutePath {
  const xdg = env.XDG_STATE_HOME;
  const base =
    xdg !== undefined && xdg !== "" && isAbsolute(xdg)
      ? xdg
      : join(env.HOME !== undefined && env.HOME !== "" ? env.HOME : homedir(), ".local", "state");
  return join(base, "squeal", MACHINES_FILE);
}

/** Reads the tracked machines; never throws; a missing file tracks none. */
export function readMachines(env: NodeJS.ProcessEnv = process.env): Machines {
  return readMachinesAt(machinesPath(env));
}

/** `readMachines` of the file at `path`, as `squeal ps` names it (row 026-20). */
export function readMachinesAt(path: AbsolutePath): Machines {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, machines: [] };
    return { path, machines: [], problem: `could not be read: ${String(error)}` };
  }
  try {
    const value: unknown = JSON.parse(text);
    if (isRecord(value) && value.v === 1 && Array.isArray(value.machines)) {
      return { path, machines: value.machines.filter(isMachineRecord) };
    }
  } catch {
    // Below.
  }
  return { path, machines: [], problem: "is not a remote machines file" };
}

/** Adds `record`, or replaces the one of its provider and worktree. */
export function recordMachine(record: MachineRecord, env: NodeJS.ProcessEnv = process.env): void {
  change(env, (machines) => [...machines.filter((m) => !same(m, record)), record]);
}

/** Changes the record of `provider` and `worktreeId`, when there is one. */
export function updateMachine(
  key: Pick<MachineRecord, "provider" | "worktreeId">,
  patch: Partial<Pick<MachineRecord, "status" | "lastUsedAt">>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  change(env, (machines) => machines.map((m) => (same(m, key) ? { ...m, ...patch } : m)));
}

/** Removes the record of `provider` and `worktreeId`. */
export function forgetMachine(
  key: Pick<MachineRecord, "provider" | "worktreeId">,
  env: NodeJS.ProcessEnv = process.env,
): void {
  change(env, (machines) => machines.filter((m) => !same(m, key)));
}

function same(
  a: Pick<MachineRecord, "provider" | "worktreeId">,
  b: Pick<MachineRecord, "provider" | "worktreeId">,
): boolean {
  return a.provider === b.provider && a.worktreeId === b.worktreeId;
}

/** Writes `edit` of the current records; a file that cannot be read is replaced. */
function change(
  env: NodeJS.ProcessEnv,
  edit: (machines: readonly MachineRecord[]) => readonly MachineRecord[],
): void {
  const path = machinesPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  locked(`${path}.lock`, () => {
    const { machines } = readMachines(env);
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ v: 1, machines: edit(machines) }, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporary, path);
  });
}

/** Runs `work` holding the lock file `lock`; throws when it stays held. */
function locked(lock: string, work: () => void): void {
  const owner = `${process.pid} ${Math.random().toString(36).slice(2)}\n`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (!acquire(lock, owner)) {
    if (takeOverStale(lock)) continue;
    if (Date.now() > deadline) throw new Error(`${lock} is held by another writer`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
  }
  try {
    work();
  } finally {
    // Only our own: a writer that took it over as stale holds it now.
    if (readText(lock) === owner) unlinkSync(lock);
  }
}

/** Creates `lock` holding `owner`, never empty; false when it exists. */
function acquire(lock: string, owner: string): boolean {
  const published = `${lock}.${owner.trim().replace(" ", ".")}`;
  writeFileSync(published, owner, { mode: 0o600 });
  try {
    linkSync(published, lock);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    if (!NO_HARD_LINKS.has(code ?? "")) throw error;
  } finally {
    unlinkSync(published);
  }
  // No hard links here: create, then write; `takeOverStale` waits out an empty lock.
  let fd: number;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeFileSync(fd, owner);
  } finally {
    closeSync(fd);
  }
  return true;
}

const NO_HARD_LINKS: ReadonlySet<string> = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]);

/** Removes `lock` when its holder died or it is older than `STALE_LOCK_MS`; true when removed. */
function takeOverStale(lock: string): boolean {
  const text = readText(lock);
  if (text === null) return true;
  if (!stale(lock, text)) return false;
  // One takeover at a time: between its check and its removal no other
  // writer removes this lock, so no lock taken after it can be removed.
  const breaker = `${lock}.break`;
  try {
    closeSync(openSync(breaker, "wx", 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // A takeover that died holding it: no takeover holds it this long.
    if (ageMs(breaker) > STALE_LOCK_MS) removeIfThere(breaker);
    return false;
  }
  try {
    if (readText(lock) !== text) return false;
    removeIfThere(lock);
    return true;
  } finally {
    removeIfThere(breaker);
  }
}

/** The holder of `text` died, or the lock is too old for any write; a lock without owner text is busy until then. */
function stale(lock: string, text: string): boolean {
  const age = ageMs(lock);
  if (age > STALE_LOCK_MS) return true;
  const holder = /^(\d+) \S+\n$/.exec(text);
  return holder !== null && !alive(Number(holder[1]));
}

/** Milliseconds since `path` changed; 0 when it is gone, so a missing file is never stale. */
function ageMs(path: string): number {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function removeIfThere(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Another writer removed it first.
  }
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function isMachineRecord(value: unknown): value is MachineRecord {
  return (
    isRecord(value) &&
    typeof value.provider === "string" &&
    typeof value.id === "string" &&
    typeof value.worktreeId === "string" &&
    typeof value.worktreeRoot === "string" &&
    typeof value.repositoryKey === "string" &&
    typeof value.destination === "string" &&
    Array.isArray(value.sshArgs) &&
    isRecord(value.places) &&
    isRecord(value.capabilities) &&
    typeof value.status === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.lastUsedAt === "number"
  );
}
