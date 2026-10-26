import type { WorktreeId } from "../../types/index.js";

/*
 * Rows 015-48 and 015-55: a pass that writes many states stages them, and
 * its transitions, in parts under a second id, then one transaction makes
 * them the worktree's. One staging id per worktree is enough: the passes of
 * one daemon never overlap, and one daemon serves a worktree.
 */

const SUFFIX = " recount";

/** The id a pass stages its rows under: never a worktree's, which is 16 hex characters. */
export const stagedId = (worktreeId: WorktreeId): WorktreeId => `${worktreeId}${SUFFIX}`;

/** Whether `id` is one `stagedId` made, so no worktree's own rows. */
export const isStagedId = (id: WorktreeId): boolean => id.endsWith(SUFFIX);
