import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { isRecord } from "../../fs/json.js";
import type { AbsolutePath } from "../../types/common.js";
import type { MachineRecord } from "./provider.js";
import { LOCK_WAIT_MS, locked, tryLocked } from "./registry-lock.js";

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

/**
 * Removes the record of `provider` and `worktreeId`. Review 0.1.658 B3:
 * with `only.id`, only while that record still names machine `id`, checked
 * inside the lock, so a replacement written meanwhile stays.
 */
export function forgetMachine(
  key: Pick<MachineRecord, "provider" | "worktreeId">,
  env: NodeJS.ProcessEnv = process.env,
  only?: { readonly id: string },
): void {
  change(env, forgetting(key, only));
}

/** The edit that drops `key`'s record, or only its record of machine `only.id`. */
export function forgetting(
  key: Pick<MachineRecord, "provider" | "worktreeId">,
  only?: { readonly id: string },
): (machines: readonly MachineRecord[]) => readonly MachineRecord[] {
  return (machines) =>
    machines.filter((m) => !same(m, key) || (only !== undefined && m.id !== only.id));
}

/**
 * Review 0.1.658 B4: `edit` of the records, for a caller on the daemon's
 * event loop. It tries the lock once and, while another writer holds it,
 * tries again on a timer, never blocking the thread. Rejects when
 * `signal` aborts or the lock stays held `LOCK_WAIT_MS`; nothing is
 * written then.
 */
export async function changeMachinesSoon(
  env: NodeJS.ProcessEnv,
  edit: (machines: readonly MachineRecord[]) => readonly MachineRecord[],
  signal?: AbortSignal,
  retryMs = 20,
): Promise<void> {
  const path = machinesPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    signal?.throwIfAborted();
    if (tryLocked(`${path}.lock`, () => write(env, path, edit))) return;
    if (Date.now() > deadline) throw new Error(`${path}.lock is held by another writer`);
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, retryMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
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
  locked(`${path}.lock`, () => write(env, path, edit));
}

/** Writes `edit` of the current records to `path`; the caller holds the lock. */
function write(
  env: NodeJS.ProcessEnv,
  path: AbsolutePath,
  edit: (machines: readonly MachineRecord[]) => readonly MachineRecord[],
): void {
  const { machines } = readMachines(env);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ v: 1, machines: edit(machines) }, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, path);
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
