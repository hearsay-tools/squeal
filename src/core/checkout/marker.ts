import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leaseProcessAlive } from "../daemon/lease-process.js";
import { isRecord } from "../fs/json.js";
import type { AbsolutePath, EpochMs } from "../types/common.js";
import type { LeaseProcess } from "../types/daemon-writes.js";

/*
 * Spec 023 D4.2, D6 (row 023-05): each temporary checkout is a folder
 * `<checkouts dir>/<id>/` with three entries. `marker.json` names its owner
 * (pid, start time, PID namespace), its commit and its repository. `tree/` is
 * the git worktree. `run/` is the run's `TMPDIR`. The marker lies beside the
 * tree, not in it, so the tree stays clean for the gate. It is written
 * before `git worktree add`, so a crash at any later point leaves a marker
 * the sweep reads.
 */

export const MARKER_VERSION = 1;

export interface CheckoutMarker {
  readonly v: typeof MARKER_VERSION;
  readonly owner: LeaseProcess;
  /** The full commit id the tree is at. */
  readonly commit: string;
  /** The common dir of the repository the tree is a worktree of. */
  readonly commonDir: AbsolutePath;
  readonly createdAt: EpochMs;
  /**
   * Row 023-16 (review wave-5 B3): the install's process group, by its
   * leader, once the install starts. Removal and the sweep stop it, so an
   * install outlives no owner a SIGKILL ended.
   */
  readonly group?: LeaseProcess;
}

/** The marker of the checkout folder `folder`. */
export function markerPath(folder: AbsolutePath): AbsolutePath {
  return join(folder, "marker.json");
}

/** The git worktree inside the checkout folder `folder`. */
export function treePath(folder: AbsolutePath): AbsolutePath {
  return join(folder, "tree");
}

/** The run folder, the run's `TMPDIR`, inside the checkout folder `folder`. */
export function runPath(folder: AbsolutePath): AbsolutePath {
  return join(folder, "run");
}

/** Writes by rename, so a reader never sees half of it. */
export function writeMarker(folder: AbsolutePath, marker: CheckoutMarker): void {
  const path = markerPath(folder);
  const temp = `${path}.${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(marker)}\n`);
  renameSync(temp, path);
}

/** The marker of `folder`; `null` when it is missing or not a marker. */
export function readMarker(folder: AbsolutePath): CheckoutMarker | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(markerPath(folder), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(value) || value.v !== MARKER_VERSION || !isRecord(value.owner)) return null;
  const { owner, commit, commonDir, createdAt, group } = value;
  if (typeof owner.pid !== "number") return null;
  if (typeof commit !== "string" || typeof commonDir !== "string") return null;
  if (typeof createdAt !== "number") return null;
  return {
    v: MARKER_VERSION,
    owner: leaseOf(owner),
    commit,
    commonDir,
    createdAt,
    ...(isRecord(group) && typeof group.pid === "number" ? { group: leaseOf(group) } : {}),
  };
}

/** Records the install's group in the marker of `folder`, which must have one. */
export function recordGroup(folder: AbsolutePath, group: LeaseProcess): void {
  const marker = readMarker(folder);
  if (marker === null) throw new Error(`squeal: ${folder} holds no checkout marker`);
  writeMarker(folder, { ...marker, group });
}

function leaseOf(value: Record<string, unknown>): LeaseProcess {
  return {
    pid: value.pid as number,
    startTime: typeof value.startTime === "number" ? value.startTime : null,
    pidNamespace: typeof value.pidNamespace === "string" ? value.pidNamespace : null,
  };
}

/** `live`, `dead` (its pid is free or reused), or `unknown` (another PID namespace, unreadable). */
export type OwnerState = "live" | "dead" | "unknown";

export function ownerState(marker: CheckoutMarker): OwnerState {
  const alive = leaseProcessAlive(marker.owner);
  return alive === null ? "unknown" : alive ? "live" : "dead";
}
