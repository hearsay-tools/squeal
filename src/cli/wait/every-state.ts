import { readHeader } from "../../core/state/header.js";
import { statesMark } from "../../core/store/states-marker.js";
import type { RevisionNumber, WorktreeId } from "../../core/types/common.js";
import type { DeltaEntry } from "../../core/types/delivery.js";
import type { KnownState } from "../../core/types/state.js";
import type { Store } from "../../core/types/store.js";
import type { TestFileKeyRecord } from "../../core/types/store-records.js";
import { type HeldRead, newsSince, type StartView } from "../status-wait-held.js";

/*
 * Row 011-45 (C6 as amended 2026-10-20, 011-42): the edit wait's fallback
 * holds for every check, so a poll read every known state and every
 * `test_file_keys` row of the worktree. It now keeps the last ones it read
 * with the states marker they were read at (`statesMark`), and reads them
 * again only when the marker moved, or when no marker can be trusted, as
 * before. The news since the start is kept too while the revision stays
 * (`newsSince` is a function of the start, the states and the revision).
 * The header is made each poll from what it kept, so the revision, the
 * runner part and every other part read fresh.
 */

/** What a wait read every state at; kept across its polls. */
export interface EveryState {
  readonly mark: string;
  readonly states: readonly KnownState[];
  readonly keys?: readonly TestFileKeyRecord[];
  readonly news?: { readonly revision: RevisionNumber; readonly entries: readonly DeltaEntry[] };
}

/** A wait's kept read, if any. */
export interface Every {
  kept?: EveryState | undefined;
}

/**
 * Every state, as the wait's start view read them: kept for the fallback's
 * first read when the marker can be trusted, else `undefined`.
 */
export function keptAtStart(
  store: Store,
  id: WorktreeId,
  states: readonly KnownState[],
): EveryState | undefined {
  const mark = statesMark(store, id);
  return mark === null ? undefined : { mark, states };
}

/**
 * `readHeld(store, id, start, null)`, from what `every` kept while the
 * marker stands where it was read; keeps this read for the next.
 */
export function readEvery(store: Store, id: WorktreeId, start: StartView, every: Every): HeldRead {
  const mark = statesMark(store, id);
  const kept = mark !== null && every.kept?.mark === mark ? every.kept : undefined;
  const states = kept?.states ?? store.knownStates.list(id);
  const keys = kept?.keys ?? store.testFileKeys.list(id);
  const header = readHeader(store, id, states, keys);
  const news =
    kept?.news?.revision === header.revision
      ? kept.news.entries
      : newsSince(start.all, states, header.revision);
  every.kept =
    mark === null
      ? undefined
      : { mark, states, keys, news: { revision: header.revision, entries: news } };
  return { header, states, keys, news };
}
