import { isDeepStrictEqual } from "node:util";
import { headerWith } from "../../core/state/header.js";
import { type HeaderPart, headerPart } from "../../core/state/header-part.js";
import { statesMark } from "../../core/store/write-markers.js";
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
 * with the states marker they were read at (`statesMark`, which the
 * database's triggers move on every write, whoever writes), and reads them
 * again only when the marker moved, or when it cannot be trusted, as before. The news since the start is kept too while the revision stays
 * (`newsSince` is a function of the start, the states and the revision).
 * Row 011-345: so is the header's part made from the states, the rows and
 * the policy (`headerPart`), kept while the policy and the on-request
 * files (row 011-426) read the same; the
 * revision, the runner part and every other input read fresh each poll
 * (`headerWith`).
 */

/** What a wait read every state at; kept across its polls. */
export interface EveryState {
  readonly mark: string;
  readonly states: readonly KnownState[];
  readonly keys?: readonly TestFileKeyRecord[];
  readonly news?: { readonly revision: RevisionNumber; readonly entries: readonly DeltaEntry[] };
  /** The header's part made from `states`, `keys` and the policy it names. */
  readonly part?: HeaderPart;
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
  let part: HeaderPart | undefined;
  const header = headerWith(store, id, keys, (policy, onRequest) => {
    // Row 011-426: a request or a lane's run moves the on-request files with no state write.
    part =
      kept?.part !== undefined &&
      isDeepStrictEqual(kept.part.policy, policy) &&
      isDeepStrictEqual(kept.part.onRequest, onRequest)
        ? kept.part
        : headerPart(states, keys, policy, undefined, undefined, onRequest);
    return part;
  });
  const news =
    kept?.news?.revision === header.revision
      ? kept.news.entries
      : newsSince(start.all, states, header.revision);
  every.kept =
    mark === null
      ? undefined
      : {
          mark,
          states,
          keys,
          news: { revision: header.revision, entries: news },
          ...(part === undefined ? {} : { part }),
        };
  return { header, states, keys, news };
}
