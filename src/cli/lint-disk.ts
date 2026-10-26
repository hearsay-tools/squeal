import { join } from "node:path";
import { hashFile } from "../core/hash/index.js";
import type { AbsolutePath, FileHash, RelativePath } from "../core/types/index.js";
import type { LintOutcome } from "../core/types/lint.js";
import type { LintChanged, LintDetails } from "../core/types/lint-delivery.js";

/*
 * Wave 2 rule 1, as `squeal code` does (row 015-22): the lint store says
 * which bytes a file's result is from (`blob`); `squeal lint` tests that
 * against the bytes on disk, read after the store, with the repository's
 * own file hash (`hashFile`: a symlink as git stores it, never followed).
 * A file edited since its lint, even before the daemon recorded the edit,
 * reads pending, and its old result is never shown as current; one Squeal
 * cannot read reads unknown, with why. Its findings, the revision and the
 * bytes they are from stay, as provenance.
 */

/** Why a file the store judged reads pending now. */
export const CHANGED_ON_DISK = "changed on disk since its lint";
export const GONE_FROM_DISK = "no longer a file on disk since its lint";

/** What the disk check reads of one file: its path, the bytes its result is from, and that result. */
interface Judged {
  readonly path: RelativePath;
  readonly outcome: LintOutcome | null;
  readonly blob: FileHash | null;
  readonly reason: string | null;
}

/** A git blob id names its object format by its length: 40 hex digits for SHA-1, 64 for SHA-256. */
const formatOf = (blob: FileHash) => (blob.length === 64 ? "sha256" : "sha1");

const messageOf = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code ?? String(error);

/** What the bytes on disk now say of a file's result: pending when they are others, unknown when unread. */
type Moved = { readonly outcome: "pending" | "unknown"; readonly reason: string };

/** `null` while the result is of the bytes on disk, or the file has no result to test. */
async function movedOnDisk(root: AbsolutePath, f: Judged): Promise<Moved | null> {
  if (f.blob === null || (f.outcome !== "pass" && f.outcome !== "fail")) return null;
  let now: FileHash | null;
  try {
    now = await hashFile(join(root, f.path), formatOf(f.blob));
  } catch (error) {
    return { outcome: "unknown", reason: `Squeal could not read it: ${messageOf(error)}` };
  }
  if (now === f.blob) return null;
  return { outcome: "pending", reason: now === null ? GONE_FROM_DISK : CHANGED_ON_DISK };
}

/** One file as its bytes on disk now say; the rest of it, provenance, as the store has it. */
const observed =
  (root: AbsolutePath) =>
  async <T extends Judged>(f: T): Promise<T> => {
    const moved = await movedOnDisk(root, f);
    return moved === null ? f : { ...f, ...moved };
  };

/** The files of `was` that read `outcome` in `now` only. */
const moved = (was: readonly Judged[], now: readonly Judged[], outcome: LintOutcome) =>
  now.filter((f, i) => f.outcome === outcome && was[i]?.outcome !== outcome).length;

/**
 * `details` with each judged file tested against its bytes on disk; the
 * worktree's pending and unknown counts take in the files that moved.
 */
export async function detailsOnDisk(
  root: AbsolutePath,
  details: LintDetails,
): Promise<LintDetails> {
  const files = await Promise.all(details.files.map(observed(root)));
  return {
    ...details,
    files,
    pending: details.pending + moved(details.files, files, "pending"),
    unknown: details.unknown + moved(details.files, files, "unknown"),
  };
}

/** `changed` with each file's state now tested against its bytes on disk. */
export async function changedOnDisk(
  root: AbsolutePath,
  changed: LintChanged,
): Promise<LintChanged> {
  return { ...changed, entries: await Promise.all(changed.entries.map(observed(root))) };
}
