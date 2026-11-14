import type { AbsolutePath } from "../core/types/common.js";
import type { CliIo } from "./main.js";
import { type NamedPrint, printNamed } from "./named-print.js";
import type { NamedSnapshotOptions, NamedWait } from "./wait/named-types.js";
import { statusWait } from "./wait/wait.js";

export type { NamedSnapshotOptions } from "./wait/named-types.js";

/**
 * `squeal status <path>...` without `--wait` (row 011-28, 005 D2 as amended
 * 2026-10-20, gh-42): the named wait's answer from one read, worded as a
 * snapshot. It asks the daemon's sync once and reads when its pass is
 * stored, or after `settleMs`, whichever comes first, so an edit the daemon
 * has not stored yet never leaves an older result current: that read has no
 * verdict and says so. A daemon that cannot sync is read at `settleMs` and
 * gives no verdict either, and one that is not validating gives none, as
 * status says of it. It promotes nothing (C15).
 */
export function readNamedSnapshot(
  cwd: AbsolutePath,
  paths: readonly string[],
  options: NamedSnapshotOptions,
): Promise<NamedWait> {
  // Row 011-331: the wait module's snapshot reads and decides.
  return statusWait({ wait: "snapshot", cwd, paths, options });
}

/** `squeal status [--json] [--full] <path>...`: `readNamedSnapshot`, then `printNamed`. */
export async function namedSnapshotCommand(
  paths: readonly string[],
  how: NamedPrint,
  io: CliIo,
  options: NamedSnapshotOptions,
): Promise<number> {
  const checks = how.checks ?? [];
  const snapshot = readNamedSnapshot(io.cwd ?? process.cwd(), paths, { ...options, checks });
  return printNamed(snapshot, how, io, options.now);
}
