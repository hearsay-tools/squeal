import { planDelta, readHeader } from "../core/delivery/index.js";
import { testFileId } from "../core/keys/index.js";
import { testFileKeyOf } from "../core/state/index.js";
import type {
  DeltaEntry,
  KnownState,
  RevisionNumber,
  StatusHeader,
  Store,
  TestFileKeyRecord,
  TestFileRef,
  ViewEntry,
  WorktreeId,
} from "../core/types/index.js";

/*
 * Task 011-42 (C6 as amended 2026-10-20): a poll of `status --wait` reads
 * only what decides whether the wait ends. The start view holds every state,
 * since the edit's files are not known then. Once the store's moves named
 * them, a poll reads their states and rows and those of the slow files it
 * holds for; it reads every state only on the fallback, which holds for every
 * check, and when the wait ends.
 */

/** The known states at the wait's start as a view, also by test file (`testFileKeyOf`). */
export interface StartView {
  readonly all: readonly ViewEntry[];
  readonly byFile: ReadonlyMap<string, readonly ViewEntry[]>;
}

export function startView(states: readonly KnownState[]): StartView {
  const all = states.map(toStartView);
  const byFile = new Map<string, ViewEntry[]>();
  for (const entry of all) {
    const id = testFileKeyOf(entry.check);
    const own = byFile.get(id);
    if (own === undefined) byFile.set(id, [entry]);
    else own.push(entry);
  }
  return { all, byFile };
}

/** One poll's read: the states and rows it read, the header, and their news since the start. */
export interface HeldRead {
  readonly header: StatusHeader;
  readonly states: readonly KnownState[];
  readonly keys: readonly TestFileKeyRecord[];
  readonly news: readonly DeltaEntry[];
}

/**
 * Reads `files`' states and rows, or every one when `null`, and their news
 * since `start` as delivery finds it (D6): a check that broke and recovered
 * between two reads is none. The header's revision and runner part are the
 * worktree's whatever `files` holds; its counts are `files`' only.
 */
export function readHeld(
  store: Store,
  worktreeId: WorktreeId,
  start: StartView,
  files: readonly TestFileRef[] | null,
): HeldRead {
  const only = files ?? undefined;
  const states = store.knownStates.list(worktreeId, only);
  const keys = store.testFileKeys.list(worktreeId, only);
  const header = readHeader(store, worktreeId, states, keys);
  const view =
    files === null
      ? start.all
      : [...new Set(files.map(testFileId))].flatMap((id) => start.byFile.get(id) ?? []);
  return { header, states, keys, news: newsOf(view, states, header.revision) };
}

function toStartView(state: KnownState): ViewEntry {
  return { check: state.check, outcome: state.outcome, fingerprint: state.fingerprint, toldAt: 0 };
}

function newsOf(
  start: readonly ViewEntry[],
  states: readonly KnownState[],
  revision: RevisionNumber,
): readonly DeltaEntry[] {
  return planDelta({
    view: start,
    states,
    isBaselineFinding: () => false,
    toldAt: 0,
    rootOf: () => null,
    revision,
  }).entries;
}
