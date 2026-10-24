import { focusesFile } from "../daemon/composite-runner.js";
import type { CheckKey, TestFileRef } from "../types/index.js";
import { peekClaim } from "./claims.js";
import type { SchedulerContext } from "./context.js";
import type { FileState } from "./files.js";
import type { FocusEntry } from "./focused-entries.js";
import { writeFocused } from "./focused-row.js";
import type { Ledger } from "./ledger.js";
import { quietHolds } from "./quiet.js";
import { laneOf, newTier, type Tier, type TierFile } from "./tiers.js";

/*
 * Spec 011 C4 and C15 as amended 2026-10-23 (row 011-135; code row
 * 011-145): a named wait's focused checks. Each entry asks for one run of
 * the checks of a fast test file whose full name holds one of its texts,
 * at the file's current key, until the wait's deadline. Such a tier goes
 * before every other class of its lane, promoted files included, and
 * stores nothing under a key: its outcome goes to the focused meta row
 * (`writeFocused`).
 */

/**
 * Spec 011 C15: whether `ref` may have a focused entry: a listed fast file
 * whose runner focuses, that is, honours `RunOptions.checks` (C14, row
 * 011-145). A slow file and a file whose runner runs whole files only get
 * none.
 */
export function mayFocus(context: SchedulerContext, ledger: Ledger, ref: TestFileRef): boolean {
  return (
    ledger.file(ref) !== undefined && !ledger.queue.isSlow(ref) && focusesFile(context.runner, ref)
  );
}

/**
 * The file and key a waiting entry runs at now; `null` when it should go:
 * the file left the listing, is blocked, unkeyed or slow now, or has a
 * result at its current key, which answers it with no run (C4).
 */
function runnable(
  context: SchedulerContext,
  ledger: Ledger,
  entry: FocusEntry,
): { file: FileState; key: CheckKey } | null {
  const file = ledger.file(entry.ref);
  if (file === undefined || file.blocked !== null || file.key === null) return null;
  if (!mayFocus(context, ledger, entry.ref) || file.resultKey === file.key) return null;
  return { file, key: file.key };
}

/** Whether an entry `where` holds waits for a focused tier that may run: work of its lane. */
export function focusedWaiting(
  context: SchedulerContext,
  ledger: Ledger,
  where: (ref: TestFileRef) => boolean = () => true,
): boolean {
  const { focused } = ledger.queue;
  if (focused.size === 0) return false;
  return focused
    .waiting(context.now())
    .some((entry) => where(entry.ref) && runnable(context, ledger, entry) !== null);
}

/**
 * Whether the backlog's turn after four tiers of the first group (C4 step
 * 4) goes before the focused tier: it is due and a file of the second
 * group may start in a free lane. A focused tier counts toward the four, so
 * a stream of focused waits cannot starve the backlog.
 */
function turnFirst(
  context: SchedulerContext,
  ledger: Ledger,
  busy: ReadonlySet<string>,
  turnDue: boolean,
): boolean {
  if (!turnDue) return false;
  const now = context.now();
  const { queue } = ledger;
  // Only a file that may start now takes the turn: a departure drain's paused
  // backlog does not, nor a file another worktree's claim holds or a stored
  // result stands for (review 0.1.280).
  return ledger.fastQueued((ref) => {
    const lane = laneOf(context, ref);
    if (busy.has(lane) || queue.isFirstGroup(ref)) return false;
    if (quietHolds(context, ledger, ref, lane, { backlog: true, turn: true }, now)) return false;
    const file = ledger.file(ref);
    if (!file || file.key === null || file.blocked !== null) return false;
    return peekClaim(context, ledger, ref) === "free";
  });
}

/**
 * The focused tier to start now, `null` when none: the waiting entries in
 * request order, of the lane of the first that may run there, up to
 * `runner.tierSize` files, each for its own texts (C14, `RunOptions.checks`).
 * A lane in `busy` takes none; its tier in flight may yield to the entry as
 * to a promoted file (`TierYields`). An entry that may not run goes. The
 * tier claims no key, leaves its files queued as they were, writes each
 * file's entry in the focused meta row with `endedAt` null, and counts as a
 * tier of the first group (`RunQueue.tierSelected`).
 */
export function selectFocusedTier(
  context: SchedulerContext,
  ledger: Ledger,
  busy: ReadonlySet<string>,
  turnDue: boolean,
): Tier | null {
  const { focused } = ledger.queue;
  if (focused.size === 0 || turnFirst(context, ledger, busy, turnDue)) return null;
  const picked: { entry: FocusEntry; file: FileState; key: CheckKey }[] = [];
  let lane: string | null = null;
  for (const entry of focused.waiting(context.now())) {
    if (picked.length >= context.policy.runner.tierSize) break;
    const run = runnable(context, ledger, entry);
    if (run === null) {
      focused.drop(entry);
      continue;
    }
    const at = laneOf(context, entry.ref);
    if (busy.has(at) || (lane !== null && at !== lane)) continue;
    lane = at;
    picked.push({ entry, ...run });
  }
  if (lane === null) return null;
  return startFocusedTier(context, ledger, picked);
}

function startFocusedTier(
  context: SchedulerContext,
  ledger: Ledger,
  picked: readonly { entry: FocusEntry; file: FileState; key: CheckKey }[],
): Tier | null {
  const { keys, store, worktreeId } = context;
  const files: TierFile[] = picked.map(({ file, key }) => ({
    file,
    key,
    inputs: keys.stabilityPaths(file.ref),
    checkpointId: null,
    forced: false,
  }));
  const first = files[0];
  if (first === undefined) return null;
  // The focused row's write takes the store first, as `startTier`'s
  // transaction does: a busy store gives up before the tier begins its run.
  const tier = store.transaction(() => {
    const started = {
      ...newTier(context, ledger, first, files, "focused"),
      focus: picked.map(({ entry }) => ({ testFile: entry.ref, texts: entry.texts })),
    };
    writeFocused(
      store,
      worktreeId,
      picked.map(({ entry, key }) => ({
        testFile: entry.ref,
        key,
        revision: started.revision.number,
        texts: entry.texts,
        runId: started.runId,
        logDir: started.logDir,
        startedAt: started.startedAt,
        endedAt: null,
        end: null,
        reason: null,
        collected: null,
        matched: null,
        checks: [],
        more: 0,
      })),
    );
    return started;
  });
  ledger.queue.focused.started(
    picked.map((p) => p.entry),
    tier.runId,
  );
  ledger.queue.tierSelected(false);
  return tier;
}
