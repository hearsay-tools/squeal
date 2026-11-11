import { type BusyWaits, retryWhileBusy } from "../store/busy.js";
import type { RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Revision } from "../types/revision.js";
import { refinedMetaKey } from "../types/scheduler.js";
import type { SchedulerContext } from "./context.js";
import { importsKeyed, importsWaiting } from "./imports-waiting.js";
import type { Ledger } from "./ledger.js";
import type { Mutex } from "./mutex.js";
import { applyRunnerPart, type RunnerPart } from "./refinement.js";

/** The daemon's busy waits, for the runner work (`ApplyHost.busy`). */
export interface RunnerWorkBusy {
  /** Each try's writes wait at most this long for a busy store. */
  readonly sliceMs?: number | undefined;
  readonly waits: BusyWaits;
}

/** What a refinement's apply needs from its runner work. */
export interface ApplyHost {
  readonly lock: Mutex;
  closed(): boolean;
  /** A runner part was applied and committed, under the lock: what it queued may cancel a backlog tier. */
  applied(): void;
  /**
   * Spec 021 D2: how a write of the runner work that a busy store refused
   * is tried again: each try's writes wait at most `sliceMs`, and the wait
   * is told to `waits`. Absent, or `undefined`: one wait as long as the
   * store's, and a refusal is thrown as any other error.
   */
  busy?(): RunnerWorkBusy | undefined;
}

/** The refinement's key in `BusyWaits`: refinements apply one at a time. */
const REFINE = "scheduler:refinement";

/**
 * The apply phase of a refinement, under the lock: what the runner said,
 * committed with the revision as refined (`refined`; `null` for a
 * runner-only refinement); `carry` takes the files whose walk changed
 * meanwhile, for the next refinement.
 *
 * Spec 021 D2 (#138, row 011-104): with the host's `busy`, a try a busy
 * store refused is tried again, with the lock released between tries so
 * batches go on, until it lands or the scheduler closes. The refused try's
 * memory went ahead of the store: the files whose key the index moved and
 * the ledger did not take are touched again, and the paths changed since
 * the runner phase stay the next try's. Once the commit landed, only the
 * imports' removal is tried again (row 018-28: the imports are removed only
 * after the commit, and each try before it takes them again).
 */
export async function applyRefinement(
  host: ApplyHost,
  context: SchedulerContext,
  ledger: Ledger,
  part: RunnerPart,
  refined: Revision["number"] | null,
  carry: (stale: readonly TestFileRef[]) => void,
): Promise<void> {
  let committed = false;
  let imports: string[] = [];
  const apply = async (n: number) => {
    const changedMeanwhile = ledger.refineChanges ?? new Set<RelativePath>();
    // Review of 0.1.428, B1: the imports marked by now have their observed paths in the regrow below.
    imports = importsWaiting(context.store, context.worktreeId);
    const tried =
      n === 0 ? part : { ...part, reresolved: [...part.reresolved, ...lagging(context, ledger)] };
    carry(await applyRunnerPart(context, ledger, tried, changedMeanwhile, refined ?? undefined));
    // Row 015-52: the listing holds the revision's test files unless the last one failed.
    const listed = ledger.listingFailed ? null : (refined ?? part.revision.number);
    ledger.commit({
      ...(refined === null ? {} : { refined }),
      ...(listed === null ? {} : { listed }),
    });
    committed = true;
    ledger.refineChanges = null;
    host.applied();
  };
  const operation = refined === null ? "applying observed paths" : `applying revision ${refined}`;
  const once = (n: number) =>
    host.lock.run(async () => {
      if (!committed) await apply(n);
      importsKeyed(context.store, context.worktreeId, imports);
    }, operation);
  const busy = host.busy?.();
  if (busy === undefined) return once(0);
  await retryWhileBusy(once, {
    sliceMs: busy.sliceMs,
    waits: busy.waits,
    key: REFINE,
    what:
      refined === null ? "the runner's observed paths" : `the runner part of revision ${refined}`,
    stopped: () => host.closed(),
  });
}

/**
 * Records `revision` as refined after its refinement threw, so no wait
 * hangs on it (D2 as amended); tried again on a busy store with the host's
 * `busy` (spec 021 D2). Throws what the write threw otherwise.
 */
export async function recordRefined(
  host: ApplyHost,
  context: SchedulerContext,
  revision: Revision["number"],
): Promise<void> {
  const { store, worktreeId } = context;
  const write = async () =>
    store.transaction(() => {
      const key = refinedMetaKey(worktreeId);
      const previous = Number(store.meta.get(key) ?? Number.NaN);
      if (!(previous >= revision)) store.meta.set(key, String(revision));
    });
  const busy = host.busy?.();
  if (busy === undefined) return write();
  await retryWhileBusy(write, {
    sliceMs: busy.sliceMs,
    waits: busy.waits,
    key: `${REFINE}:refined`,
    what: `revision ${revision} as refined`,
    stopped: () => host.closed(),
  });
}

/**
 * The ledger's files whose key the index moved and the ledger has not taken
 * (spec 021 D2): a refused apply keyed them in memory and never settled
 * them, and the runner part of its next try may not name them.
 */
export function lagging(context: SchedulerContext, ledger: Ledger): TestFileRef[] {
  const { index } = context.keys;
  return [...ledger.files.values()]
    .filter((file) => index.key(file.ref) !== file.key)
    .map((file) => file.ref);
}
