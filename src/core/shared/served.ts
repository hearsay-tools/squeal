import { createHash } from "node:crypto";
import {
  readEnvironment,
  worktreeEnvironment,
  worktreeEnvironments,
} from "../store/environments.js";
import { type ImportRecord, importEnvironments, listImports } from "../store/imports.js";
import { rekeyedHash } from "../store/transfer-rekey.js";
import type { WorktreeId } from "../types/common.js";
import type { Store } from "../types/store.js";

/*
 * Row 018-44 (`research/live-saving.md` Q3): the worktrees of one clone
 * share one store, and an import re-keys for the worktree that makes it
 * alone (spec 018 D11). Where that worktree's environment differs from CI's
 * under D10, or it has none recorded yet, the results stay at CI's keys,
 * which no other worktree computes. So an export another worktree imported
 * holds for this one only when it serves this one as well as an import of
 * its own would; else this worktree imports it for itself, under an id of
 * its own, so each environment's keys keep their own import record (D5).
 */

/**
 * How many of `candidates`, nearest the start point first, the reader tries
 * (D14): every one nearer than the nearest held one, at `nearestHeld`, and
 * that one too when its imports do not serve `worktreeId` (`servesHere`).
 */
export function triedHere(
  store: Store,
  worktreeId: WorktreeId,
  imports: readonly ImportRecord[],
  candidates: readonly string[],
  nearestHeld: number,
): number {
  if (nearestHeld === -1) return candidates.length;
  const commit = candidates[nearestHeld];
  const held = imports.filter((i) => i.header.commit === commit);
  return servesHere(store, worktreeId, held) ? nearestHeld : nearestHeld + 1;
}

/**
 * Whether `imports`, the store's imports of one commit, serve `worktreeId`
 * as well as an import of its own would: one of them is this worktree's own
 * in its present environments (`importIdHere`), or for each project they
 * hold files of, a file went at this worktree's environment hash, or none
 * of the environments its files went at re-keys to this worktree's (D10
 * through `rekeyedHash`), or this worktree records none for the project yet.
 */
export function servesHere(
  store: Store,
  worktreeId: WorktreeId,
  imports: readonly ImportRecord[],
): boolean {
  const environments = environmentsOf(store, worktreeId);
  if (imports.some((i) => i.id === ownId(i.fileHash, environments))) return true;
  const byProject = importEnvironments(
    store,
    imports.map((i) => i.id),
  );
  for (const [project, hashes] of byProject) {
    const here = worktreeEnvironment(store, worktreeId, project);
    if (here === null || hashes.includes(here.hash)) continue;
    const rekeys = hashes.some(
      (hash) => rekeyedHash({ hash, descriptor: readEnvironment(store, hash) }, here) !== null,
    );
    if (rekeys) return false;
  }
  return true;
}

/**
 * The id of an import of the export file `fileHash`: the first 16 of its
 * hash, as `squeal import` names it, unless the store holds an import of
 * that id already; then one of the file and this worktree's environments,
 * so a worktree in equal environments takes the same id, and one whose
 * environments changed takes another.
 */
export function importIdHere(store: Store, worktreeId: WorktreeId, fileHash: string): string {
  const id = fileHash.slice(0, 16);
  if (!listImports(store).some((i) => i.id === id)) return id;
  return ownId(fileHash, environmentsOf(store, worktreeId));
}

/** `worktreeId`'s environment hash of each project, as one text. */
function environmentsOf(store: Store, worktreeId: WorktreeId): string {
  return JSON.stringify(worktreeEnvironments(store, worktreeId).map((e) => [e.project, e.hash]));
}

/** The id of a worktree's own import of `fileHash` in `environments` (`environmentsOf`). */
function ownId(fileHash: string, environments: string): string {
  return createHash("sha256").update(`${fileHash}\n${environments}`).digest("hex").slice(0, 16);
}
