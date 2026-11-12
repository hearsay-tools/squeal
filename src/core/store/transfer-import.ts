import { KEY_FORMAT_VERSION } from "../keys/key-format.js";
import type { ImportCounts } from "../types/daemon-writes.js";
import type { SquealBuild } from "../types/status.js";
import type { Store } from "../types/store.js";
import { BUSY_SLICE_MS, retryWhileBusy } from "./busy.js";
import { BUSY_BOUND_MS } from "./sliced-write.js";
import { connectionOf } from "./store.js";
import type { ResultsBundle } from "./transfer-bundle.js";
import {
  emptyTally,
  type ImportOptions,
  type ImportSlice,
  type ImportTally,
  importSlices,
} from "./transfer-import-slices.js";

export type { ImportCounts } from "../types/daemon-writes.js";
export type { ImportOptions, ImportSlice } from "./transfer-import-slices.js";

/**
 * Spec 018 D3: why this Squeal refuses `bundle`, naming both key formats, or
 * `null`. A result at another format's key could never be current here.
 */
export function importRefusal(bundle: ResultsBundle): string | null {
  const theirs = otherKeyFormat(bundle);
  if (theirs === null) return null;
  return `the export's key format is ${theirs.keyFormat}; this Squeal's is ${KEY_FORMAT_VERSION}`;
}

/**
 * Spec 018 D21: the Squeal that wrote `bundle` and its key format, when that
 * format is not this Squeal's (`importRefusal`); else `null`.
 */
export function otherKeyFormat(bundle: ResultsBundle): SquealBuild | null {
  const { squealVersion, keyFormat } = bundle.header;
  return keyFormat === KEY_FORMAT_VERSION ? null : { version: squealVersion, keyFormat };
}

/**
 * Spec 018 D3: adds `bundle` to the store: the import's rows; closure lists
 * and observed entries only where the store has none; each result with the
 * import as its provenance and the import's time as its record time, so
 * running daemons read the keys as new (`StoredKeys`), at the key its file
 * has here at the export's content when `rekeying` proves one (D11,
 * `rekeyFiles`), else at the exported key; the environment descriptors. A
 * key the store holds results at keeps them. Spec 021 D3: in slices, each
 * one transaction (`importSlices`), run here one after another; a busy
 * store's error is thrown from the slice it stopped. With `dryRun` all of
 * it runs in one transaction that rolls back, and the counts stay.
 */
export function importResults(
  store: Store,
  bundle: ResultsBundle,
  options: ImportOptions,
): ImportCounts {
  const tally = emptyTally();
  for (const slice of slicesOf(store, bundle, options, tally)) slice.run();
  return { ...tally };
}

/** Runs one slice of an import, trying it again while a busy store refuses it. */
export type SliceRunner = (slice: ImportSlice) => Promise<void>;

/**
 * Spec 021 D3 (row 021-20): `importResults`, each slice given to `run`,
 * which tries it again while a busy store refuses it, so the write lock is
 * free between slices and no one wait outlasts the bound. `stopped`, asked
 * before each slice, ends the import with `ImportStopped`; what committed
 * stays, and the import's record, written last, is not among it. Default
 * `run`: `retriedSlice` within `BUSY_BOUND_MS`, which `stopped` ends too.
 */
export async function importSliced(
  store: Store,
  bundle: ResultsBundle,
  options: ImportOptions & {
    readonly run?: SliceRunner;
    readonly stopped?: () => boolean;
  },
): Promise<ImportCounts> {
  const tally = emptyTally();
  const run = options.run ?? retriedSlice(BUSY_BOUND_MS, options.stopped);
  for (const slice of slicesOf(store, bundle, options, tally)) {
    if (options.stopped?.() === true) throw new ImportStopped();
    await run(slice);
  }
  return { ...tally };
}

/** An import `stopped` ended between two slices. */
export class ImportStopped extends Error {
  constructor() {
    super("the import stopped before its last slice; the next import adds the rest");
  }
}

/**
 * A `SliceRunner` in the retried path of 001-422: each try waits at most
 * `BUSY_SLICE_MS` for a busy store, so the event loop runs between tries;
 * a slice the store refused for `boundMs` from its first try throws its
 * busy error, as does one refused once `stopping` says so.
 */
export function retriedSlice(
  boundMs: number = BUSY_BOUND_MS,
  stopping: () => boolean = () => false,
): SliceRunner {
  return (slice) => {
    const until = Date.now() + boundMs;
    return retryWhileBusy(async () => slice.run(), {
      sliceMs: BUSY_SLICE_MS,
      key: "import",
      what: slice.what,
      stopped: () => stopping() || Date.now() >= until,
    });
  };
}

/** A dry run as one slice: every slice in one transaction that rolls back. */
function slicesOf(
  store: Store,
  bundle: ResultsBundle,
  options: ImportOptions,
  tally: ImportTally,
): Iterable<ImportSlice> {
  if (options.dryRun !== true) return importSlices(store, bundle, options, tally);
  const conn = connectionOf(store);
  const dry: ImportSlice = {
    what: "an import's dry run",
    run: () => {
      const counts = emptyTally();
      try {
        conn.transaction(() => {
          for (const slice of importSlices(store, bundle, options, counts)) slice.run();
          throw new DryRun();
        });
      } catch (error) {
        if (!(error instanceof DryRun)) throw error;
      }
      Object.assign(tally, counts);
    },
  };
  return [dry];
}

/** A dry run's way out of its transaction. */
class DryRun extends Error {
  constructor() {
    super("dry run");
  }
}
