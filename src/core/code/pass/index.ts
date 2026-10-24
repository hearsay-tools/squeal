import { rmSync } from "node:fs";
import type { ObjectFormat } from "../../hash/index.js";
import type { AbsolutePath, EpochMs, Policy, RelativePath, WorktreeId } from "../../types/index.js";
import {
  type CodeStore,
  codeStorePath,
  isCodeStoreOpenFailure,
  openCodeStore,
} from "../store/index.js";
import { nextRetry, RETRY_AFTER_MS, readUncountable, restartRetries } from "./failed.js";
import { runPass } from "./pass.js";
import type { Counter, PassReport, PassSource } from "./types.js";

export { readRecount, recountKey } from "./cursor.js";
export {
  COUNT_ATTEMPTS,
  type FailedCount,
  type FailedCounts,
  RETRY_AFTER_MS,
  readUncountable,
  uncountableKey,
} from "./failed.js";
export { headAfterMove, mainStoreSource } from "./source.js";
export type * from "./types.js";

export interface CodePassOptions {
  readonly worktreeId: WorktreeId;
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly format: ObjectFormat;
  readonly source: PassSource;
  /** The policy now: the daemon's, which a revision may reload. */
  readonly policy: () => Policy;
  /** Loaded at the first pass with the policy on, so a daemon with it off loads no grammar. */
  readonly counter: () => Promise<Counter>;
  readonly now?: () => EpochMs;
  readonly log: (text: string) => void;
  readonly onError: (error: Error) => void;
  /** Each pass that did something. */
  readonly onPass?: (report: PassReport) => void;
  /** Blobs counted per slice; default `SLICE_FILES`. */
  readonly sliceFiles?: number;
}

/**
 * Spec 015 D4: the daemon's code pass. It runs in the daemon process,
 * outside the scheduler's lanes, and takes no test permit. Passes never
 * overlap: a nudge during one runs one more after it.
 */
export interface CodePass {
  /** A revision may be stored: run a pass soon. */
  nudge(): void;
  /** Resolves once no pass runs or is due. */
  idle(): Promise<void>;
  /** Waits for the pass in flight, then closes the code store. */
  close(): Promise<void>;
}

/**
 * With `complexity.enabled` false a nudge opens nothing, so no
 * `code.sqlite` is created (goal 1), and the next pass with it on is a
 * first count. A corrupt code store is deleted and made again: every count
 * can be made again (notes 12). A newer one is left to the daemon that
 * wrote it. A failed count is tried again when its retry is due, by a
 * timer that nudges; opening the store gives each one a fresh budget (row
 * 015-18). A pass that throws, as on a busy store, keeps the timer, and a
 * retry overdue then waits 5 s, then 60 s at each pass that throws again
 * (review 0.1.293 B2). A counter that did not load is loaded again at the
 * next pass.
 */
export function createCodePass(options: CodePassOptions): CodePass {
  const now = options.now ?? Date.now;
  const retry = new Set<RelativePath>();
  let store: CodeStore | null = null;
  let counter: Promise<Counter> | null = null;
  let lastError: string | null = null;
  let wasOff = false;
  let refused: string | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let closed = false;
  let timer: NodeJS.Timeout | null = null;
  /** The failed counts of the open store have had this daemon's fresh budget. */
  let budgeted = false;
  /** Passes in a row that threw. */
  let aborted = 0;

  const shut = () => {
    store?.close();
    store = null;
    budgeted = false;
  };
  const open = (policy: Policy): CodeStore | null => {
    if (store !== null) return store;
    let opened = openCodeStore(options.commonDir, policy);
    if (isCodeStoreOpenFailure(opened) && opened.reason === "corrupt") {
      options.log(`complexity: the code store was corrupt (${opened.error}); counting again`);
      for (const suffix of ["", "-wal", "-shm"]) {
        rmSync(`${codeStorePath(options.commonDir)}${suffix}`, { force: true });
      }
      opened = openCodeStore(options.commonDir, policy);
    }
    if (!isCodeStoreOpenFailure(opened)) {
      store = opened;
      return store;
    }
    const text = `complexity: the code store did not open: ${JSON.stringify(opened)}`;
    if (refused !== text) options.log(text);
    refused = text;
    return null;
  };
  const once = async () => {
    const policy = options.policy();
    if (!policy.complexity.enabled) {
      wasOff = true;
      shut();
      return;
    }
    const opened = open(policy);
    if (opened === null) return;
    if (!budgeted) restartRetries(opened.meta, options.worktreeId, now());
    budgeted = true;
    counter ??= options.counter();
    const loaded = await counter.catch((error: unknown) => {
      counter = null;
      throw error;
    });
    const report = await runPass({
      worktreeId: options.worktreeId,
      root: options.root,
      format: options.format,
      store: opened,
      source: options.source,
      counter: loaded,
      complexity: policy.complexity,
      switchedOn: wasOff,
      retry,
      now,
      log: options.log,
      ...(options.sliceFiles === undefined ? {} : { sliceFiles: options.sliceFiles }),
    });
    wasOff = false;
    if (report !== null) options.onPass?.(report);
  };
  /**
   * The earliest failed count's retry; after `aborted` passes that threw,
   * not before a backoff, so a store that stays busy makes no tight loop.
   */
  const nextWake = (): number | null => {
    if (store === null) return null;
    const at = nextRetry(readUncountable(store.meta, options.worktreeId));
    if (at === null || aborted === 0) return at;
    const wait = RETRY_AFTER_MS[Math.min(aborted, RETRY_AFTER_MS.length) - 1] ?? 0;
    return Math.max(at, now() + wait);
  };
  /** One timer at `at`; a nudge sooner reschedules it. */
  const retryLater = (at: number | null) => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (at === null || closed) return;
    timer = setTimeout(
      () => {
        timer = null;
        self.nudge();
      },
      Math.max(0, at - now()),
    );
    timer.unref();
  };
  const loop = async () => {
    do {
      again = false;
      try {
        await once();
        lastError = null;
        aborted = 0;
      } catch (error) {
        // A failure that repeats at every pass, such as a counter that cannot load, is told once.
        const failure = error instanceof Error ? error : new Error(String(error));
        if (failure.message !== lastError) options.onError(failure);
        lastError = failure.message;
        aborted++;
      }
      try {
        retryLater(nextWake());
      } catch (error) {
        options.onError(error instanceof Error ? error : new Error(String(error)));
      }
    } while (again && !closed);
    running = null;
  };

  const self: CodePass = {
    nudge() {
      if (closed) return;
      if (running !== null) again = true;
      else running = loop();
    },
    idle: () => running ?? Promise.resolve(),
    async close() {
      closed = true;
      await running;
      retryLater(null);
      shut();
    },
  };
  return self;
}
