import type { RelativePath, RevisionNumber, WorktreeId } from "../../types/index.js";
import type { LintMetaRepo } from "../store/types.js";

/*
 * The lint pass's own facts per worktree, in the lint store's `meta` table
 * (017-03's notes: the schema stays v1), each under a `lint-` prefix. Each is JSON; one that does not
 * parse reads as absent, so the next pass keys again.
 */

/** D7 step 2: the revision the pass last keyed at, and the environment it keyed with. */
export interface LintCursor {
  readonly revision: RevisionNumber;
  readonly environment: string;
}

/** D5: the program segment whole-program files were keyed at, and those files. */
export interface LintProgram {
  readonly segment: string;
  readonly files: readonly RelativePath[];
  /** The extensions ESLint lints beside the module ones: the segment holds their files' blobs. */
  readonly extensions: readonly string[];
}

export const cursorKey = (worktreeId: WorktreeId) => `lint-cursor:${worktreeId}`;
/** Paths a first or config keying left pending: linted with no transition (D2's last row). */
export const quietKey = (worktreeId: WorktreeId) => `lint-quiet:${worktreeId}`;
export const programKey = (worktreeId: WorktreeId) => `lint-program:${worktreeId}`;
/** D9: why the provider is off, for status (wave 2); absent while it is on. */
export const offKey = (worktreeId: WorktreeId) => `lint-off:${worktreeId}`;
/** D9: why the last keying failed, as a config that does not load; absent once one keys. */
export const failedKey = (worktreeId: WorktreeId) => `lint-failed:${worktreeId}`;

function parse(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function readCursor(meta: LintMetaRepo, worktreeId: WorktreeId): LintCursor | null {
  const raw = parse(meta.get(cursorKey(worktreeId))) as Partial<LintCursor> | null;
  if (typeof raw?.revision !== "number" || typeof raw.environment !== "string") return null;
  return { revision: raw.revision, environment: raw.environment };
}

export function writeCursor(meta: LintMetaRepo, worktreeId: WorktreeId, cursor: LintCursor) {
  meta.set(cursorKey(worktreeId), JSON.stringify(cursor));
}

export function readQuiet(meta: LintMetaRepo, worktreeId: WorktreeId): Set<RelativePath> {
  const raw = parse(meta.get(quietKey(worktreeId)));
  return new Set(Array.isArray(raw) ? raw.filter((p) => typeof p === "string") : []);
}

export function writeQuiet(
  meta: LintMetaRepo,
  worktreeId: WorktreeId,
  quiet: ReadonlySet<RelativePath>,
) {
  if (quiet.size === 0) meta.delete(quietKey(worktreeId));
  else meta.set(quietKey(worktreeId), JSON.stringify([...quiet].sort()));
}

export function readProgram(meta: LintMetaRepo, worktreeId: WorktreeId): LintProgram {
  const raw = parse(meta.get(programKey(worktreeId))) as Partial<LintProgram> | null;
  if (typeof raw?.segment !== "string" || !Array.isArray(raw.files)) {
    return { segment: "", files: [], extensions: [] };
  }
  const strings = (list: unknown) =>
    Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  return { segment: raw.segment, files: strings(raw.files), extensions: strings(raw.extensions) };
}

export function writeProgram(meta: LintMetaRepo, worktreeId: WorktreeId, program: LintProgram) {
  meta.set(
    programKey(worktreeId),
    JSON.stringify({
      ...program,
      files: [...program.files].sort(),
      extensions: [...program.extensions].sort(),
    }),
  );
}

/** Writes a reason under `key`, or deletes it with `null`. */
export function writeReason(meta: LintMetaRepo, key: string, reason: string | null) {
  if (reason === null) meta.delete(key);
  else if (meta.get(key) !== reason) meta.set(key, reason);
}
