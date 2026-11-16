import type { EpochMs } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { SchedulerContext } from "./context.js";
import type { FileState } from "./files.js";
import type { FocusEntry } from "./focused-entries.js";
import { writeFocused } from "./focused-row.js";
import type { Ledger } from "./ledger.js";
import { newTier, type Tier, type TierFile } from "./tiers.js";

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
    ledger.file(ref) !== undefined &&
    !ledger.queue.isSlow(ref) &&
    context.runner.traits.focuses(ref)
  );
}

/**
 * The file and key a waiting entry runs at now; `null` when it should go:
 * the file left the listing, is blocked, unkeyed or slow now, or has a
 * result at its current key, which answers it with no run (C4).
 */
export function runnable(
  context: SchedulerContext,
  ledger: Ledger,
  entry: FocusEntry,
): { file: FileState; key: CheckKey } | null {
  const file = ledger.file(entry.ref);
  if (file === undefined || file.blocked !== null || file.key === null) return null;
  if (!mayFocus(context, ledger, entry.ref) || file.resultKey === file.key) return null;
  return { file, key: file.key };
}

/**
 * Whether an entry `where` holds waits for a focused tier that may run: work
 * of its lane, its deadline read at `at`, a step's reading (row 011-372),
 * else now.
 */
export function focusedWaiting(
  context: SchedulerContext,
  ledger: Ledger,
  where: (ref: TestFileRef) => boolean = () => true,
  at?: EpochMs,
): boolean {
  const { focused } = ledger.queue;
  if (focused.size === 0) return false;
  return focused
    .waiting(at ?? context.now())
    .some((entry) => where(entry.ref) && runnable(context, ledger, entry) !== null);
}

/**
 * `focusedWaiting` by reads only (row 011-354, review 0.1.514 B1): its
 * answer, and `read`, whether it would have read the entries and so dropped
 * the ones past their deadline (`FocusedEntries.waiting`); the caller does.
 */
export function readFocused(
  context: SchedulerContext,
  ledger: Ledger,
  where: (ref: TestFileRef) => boolean,
): { readonly waits: boolean; readonly read: boolean } {
  const { focused } = ledger.queue;
  if (focused.size === 0) return { waits: false, read: false };
  const waits = focused
    .peekWaiting(context.now())
    .some((entry) => where(entry.ref) && runnable(context, ledger, entry) !== null);
  return { waits, read: true };
}

/**
 * Starts the focused tier of `picked`, whose files are `files` in the same
 * order (the plan's `focused` candidate, `focusedCandidate`, row 011-346):
 * it claims no key, leaves its files queued as they were, writes each
 * file's entry in the focused meta row with `endedAt` null, and counts as a
 * tier of its named wait's group, or of the first group when no wait's
 * group holds a file of it (`RunQueue.focusedSelected`, row 011-283), at
 * `at`, the step's reading (row 011-372), else now.
 */
export function startFocusedTier(
  context: SchedulerContext,
  ledger: Ledger,
  picked: readonly { entry: FocusEntry; file: FileState; key: CheckKey }[],
  files: readonly TierFile[],
  at?: EpochMs,
): Tier | null {
  const { store, worktreeId } = context;
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
  // Row 011-283 (N1): a focused tier of a named wait's group is that group's tier.
  ledger.queue.focusedSelected(
    picked.map((p) => p.entry.ref),
    at,
  );
  return tier;
}
