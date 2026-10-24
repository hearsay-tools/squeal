import type { RelativePath, RevisionNumber, WorktreeId } from "../../types/index.js";
import type { CodeMetaRepo } from "../store/index.js";

/*
 * Spec 015 D6 as amended by 015-38: the files whose last change git
 * brought. Each edit pass records the judged paths a pull, merge, rebase,
 * cherry-pick or revert brought (`committedPaths`), with the revision; a
 * judged path git did not bring leaves the record. The delivery reads it
 * to take in by count a `PASS` or `RESOLVED` that git brought, for a
 * function the session was told by count only.
 */

/** Code meta `pulled:<worktreeId>`: `[path, revision]` pairs. */
const pulledKey = (worktreeId: WorktreeId) => `pulled:${worktreeId}`;

/** Each path whose last change git brought, and that revision; empty when none is or the record does not read. */
export function readPulled(
  meta: CodeMetaRepo,
  worktreeId: WorktreeId,
): Map<RelativePath, RevisionNumber> {
  const text = meta.get(pulledKey(worktreeId));
  if (text === null) return new Map();
  try {
    const pairs: unknown = JSON.parse(text);
    if (!Array.isArray(pairs)) return new Map();
    return new Map(
      pairs.filter(
        (p): p is [RelativePath, RevisionNumber] =>
          Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "number",
      ),
    );
  } catch {
    return new Map();
  }
}

/**
 * An edit pass at `revision` judged `paths`: those in `brought` are git's
 * at `revision`, the others the agent's. Writes only what changes.
 */
export function writePulled(
  meta: CodeMetaRepo,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
  paths: Iterable<RelativePath>,
  brought: ReadonlySet<RelativePath>,
): void {
  const pulled = readPulled(meta, worktreeId);
  let changed = false;
  for (const path of paths) {
    if (brought.has(path)) {
      changed ||= pulled.get(path) !== revision;
      pulled.set(path, revision);
    } else {
      changed = pulled.delete(path) || changed;
    }
  }
  if (!changed) return;
  if (pulled.size === 0) meta.delete(pulledKey(worktreeId));
  else meta.set(pulledKey(worktreeId), JSON.stringify([...pulled]));
}

/** A first count or a policy change rebuilt every state: the record starts again. */
export function clearPulled(meta: CodeMetaRepo, worktreeId: WorktreeId): void {
  if (meta.get(pulledKey(worktreeId)) !== null) meta.delete(pulledKey(worktreeId));
}

/**
 * The delivery's question, read once and only when asked: whether git
 * brought the last change to the file at `path` up to `revision`, so a
 * transition there is git's too.
 */
export function pulledReader(
  meta: CodeMetaRepo,
  worktreeId: WorktreeId,
): (path: RelativePath, revision: RevisionNumber) => boolean {
  let pulled: ReadonlyMap<RelativePath, RevisionNumber> | null = null;
  return (path, revision) => {
    pulled ??= readPulled(meta, worktreeId);
    const at = pulled.get(path);
    return at !== undefined && at <= revision;
  };
}
