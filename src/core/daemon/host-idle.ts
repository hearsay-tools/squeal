import { totalmem } from "node:os";
import type { Leaf } from "./config-file.js";

/*
 * Spec 021 D20.4 (row 021-26): `runner.hostIdleMinutes`, in the user config
 * and in `squeal.config.json`. The human, 2026-11-12: "just a setting. Keep
 * it simple. No need to tweak it on the fly based on the host total memory
 * etc. The default could be based on that, but that's it." The user config
 * wins, since memory belongs to the machine and the project file is shared
 * by machines of every size.
 */

const GIB = 2 ** 30;

/** `runner.hostIdleMinutes`: a whole number of minutes, `0` for never. */
export const hostIdleMinutes: Leaf = (v) =>
  Number.isSafeInteger(v) && (v as number) >= 0 ? null : "a whole number of minutes >= 0";

/**
 * D20.4: one minute per 8 GiB of the machine's total memory, at least 2 and
 * at most 10, so 16 GiB gives 2, 48 GiB gives 6 and 80 GiB or more gives 10.
 * Rounded, as a machine sold with 48 GiB reports a little less.
 */
export function defaultHostIdleMinutes(totalBytes: number = totalmem()): number {
  return Math.min(10, Math.max(2, Math.round(totalBytes / (8 * GIB))));
}

/**
 * The milliseconds a local runner host stays up with no call: the user
 * config's `runner.hostIdleMinutes`, else `squeal.config.json`'s, read at
 * each use, else `fallback`, which the daemon computes once at its start.
 */
export function hostIdleMs(
  user: number | null,
  project: () => number | null,
  fallback: number,
): () => number {
  return () => (user ?? project() ?? fallback) * 60_000;
}
