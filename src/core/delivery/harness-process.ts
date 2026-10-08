import { readFileSync, readlinkSync } from "node:fs";
import { isRecord } from "../fs/index.js";
import type { Consumer, HarnessProcess, Store, WorktreeId } from "../types/index.js";
import { readAll, slot, writeSlot } from "./slots.js";

/*
 * The harness process each consumer registered from, and whether it is gone
 * (lessons, defect 24; `research/harness-process-liveness.md`). Linux only:
 * without `/proc` nothing is recorded and the consumer keeps the 12 hour
 * expiry (D10).
 */

/** The fields of `/proc/<pid>/stat` Squeal reads. */
export interface ProcStat {
  /** Field 2, the command name without its parentheses. */
  readonly comm: string;
  /** Field 3: `R`, `S`, `Z`, ... */
  readonly state: string;
  /** Field 4. */
  readonly ppid: number;
  /** Field 22, clock ticks after boot. */
  readonly startTime: number;
}

/**
 * Reads `/proc/<pid>/stat`; `null` when the process does not exist. Fields
 * are counted after the last `)`, since the command name may hold spaces and
 * parentheses. Any other failure throws.
 */
export function readProcStat(pid: number): ProcStat | null {
  let text: string;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  const rest = text.slice(close + 2).split(" ");
  const ppid = Number(rest[1]);
  const startTime = Number(rest[19]);
  if (open < 0 || close < open || !Number.isInteger(ppid) || !Number.isInteger(startTime)) {
    throw new Error(`unreadable /proc/${pid}/stat`);
  }
  return { comm: text.slice(open + 1, close), state: rest[0] ?? "", ppid, startTime };
}

/** This process's PID namespace, `pid:[4026531836]`; `null` without `/proc`. */
export function pidNamespace(): string | null {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return null;
  }
}

/**
 * True when `harness` is surely gone: its stat file is missing, its start time
 * differs (the PID was reused) or it is a zombie. A process in another PID
 * namespace than `namespace`, or one whose stat cannot be read, is not known
 * to be gone.
 */
export function harnessGone(harness: HarnessProcess, namespace: string | null): boolean {
  if (namespace === null || harness.pidNamespace !== namespace) return false;
  try {
    const stat = readProcStat(harness.pid);
    return stat === null || stat.startTime !== harness.startTime || stat.state === "Z";
  } catch {
    return false;
  }
}

/** `meta` key of a worktree's recorded harness processes. */
export function harnessMetaKey(worktreeId: WorktreeId): string {
  return `harness-process:${worktreeId}`;
}

/** Records the process `consumer` registered from; `null` forgets it. Call inside a transaction. */
export function recordHarness(
  store: Store,
  consumer: Consumer,
  harness: HarnessProcess | null,
): void {
  writeSlot(store, harnessMetaKey(consumer.worktreeId), consumer, harness);
}

/** Every recorded harness process of `worktreeId`'s consumers, by slot name. */
export function recordedHarnesses(
  store: Store,
  worktreeId: WorktreeId,
): ReadonlyMap<string, HarnessProcess> {
  const harnesses = new Map<string, HarnessProcess>();
  for (const [name, value] of Object.entries(readAll(store, harnessMetaKey(worktreeId)))) {
    const harness = toHarness(value);
    if (harness !== null) harnesses.set(name, harness);
  }
  return harnesses;
}

/** The process `consumer` registered from; `null` when none was recorded. */
export function harnessOf(store: Store, consumer: Consumer): HarnessProcess | null {
  return recordedHarnesses(store, consumer.worktreeId).get(slot(consumer)) ?? null;
}

export function sameHarness(a: HarnessProcess, b: HarnessProcess): boolean {
  return a.pid === b.pid && a.startTime === b.startTime && a.pidNamespace === b.pidNamespace;
}

function toHarness(value: unknown): HarnessProcess | null {
  if (!isRecord(value)) return null;
  const { pid, startTime, pidNamespace } = value;
  return typeof pid === "number" &&
    typeof startTime === "number" &&
    typeof pidNamespace === "string"
    ? { pid, startTime, pidNamespace }
    : null;
}
