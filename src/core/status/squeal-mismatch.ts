import { KEY_FORMAT_VERSION } from "../keys/key-format.js";
import { readSquealMismatch } from "../shared/refused.js";
import type { WorktreeId } from "../types/common.js";
import type { SharedStatus, SquealMismatch } from "../types/status.js";
import type { Store } from "../types/store.js";

/*
 * Spec 018 D21 (row 018-34): when the shared reader refused CI's export
 * because CI ran a Squeal with another key format, status says so once, in
 * plain words, with both Squeal versions and what happens next. The direction
 * (CI older or newer) changes only the versions. The key format numbers go to
 * `--full`. Silent when the formats are equal (principle 1).
 */

/**
 * The reader's record while it holds: this Squeal records results in the
 * refusing daemon's key format, and CI's differs. A record from a daemon of
 * another format says nothing: its successor fetches again at start.
 */
export function squealMismatchOf(
  store: Store,
  worktreeId: WorktreeId,
): { readonly squeal?: SquealMismatch } {
  const m = readSquealMismatch(store, worktreeId);
  if (m === null) return {};
  if (m.here.keyFormat !== KEY_FORMAT_VERSION || m.ci.keyFormat === KEY_FORMAT_VERSION) return {};
  return { squeal: m };
}

/** The one line, with the key format numbers when `full`; none without a refusal. */
export function squealMismatchLines(shared: SharedStatus | undefined, full: boolean): string[] {
  const m = shared?.squeal;
  if (m === undefined) return [];
  const line =
    `CI results not used: CI ran Squeal ${m.ci.version}, which records results in a different format than this Squeal (${m.here.version}). ` +
    "They are used again when CI and this machine run releases with the same format.";
  if (!full) return [line];
  return [
    `${line} CI's export of ${m.commit.slice(0, 8)} has key format ${m.ci.keyFormat}; this Squeal's is ${m.here.keyFormat}.`,
  ];
}
