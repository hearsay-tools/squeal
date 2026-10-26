import { rmSync } from "node:fs";
import { installedDependenciesFingerprint } from "../../keys/environment.js";
import type { EpochMs, Policy, RelativePath } from "../../types/index.js";
import { isLintStoreOpenFailure, lintStorePath, openLintStore } from "../store/index.js";
import type { LintStore } from "../store/types.js";
import { runLintPass } from "./run.js";
import { ProviderSession } from "./session.js";
import type { LintPassOptions } from "./types.js";

export { lintIdleIn } from "./idle.js";
export { PART_FILES } from "./parts.js";
export type * from "./provider.js";
export { failedKey, offKey } from "./records.js";
export type * from "./types.js";

/**
 * Spec 017 D7: the daemon's lint pass, beside 015's code pass. It runs in
 * the daemon process, outside the scheduler's lanes, and lints in the
 * provider's worker. Passes never overlap: a nudge during one ends it after
 * its part and runs one more.
 */
export interface LintPass {
  /** A revision may be stored: run a pass soon. */
  nudge(): void;
  /** Resolves once no pass runs or is due. */
  idle(): Promise<void>;
  /** Waits for the pass in flight, then closes the provider and the lint store. */
  close(): Promise<void>;
}

/**
 * With `lint.enabled` false a pass opens nothing and closes what was open,
 * so no `lint.sqlite` is created and no ESLint loads (goal 1). A corrupt
 * lint store is deleted and made again: every result can be made again. A
 * pass that throws is told once per message; the provider is closed, and
 * the next nudge opens a new one. One timer looks again when the pool
 * refused a part or stale files wait for idle.
 */
export function createLintPass(options: LintPassOptions): LintPass {
  const now = options.now ?? Date.now;
  const nodeMajor = options.nodeMajor ?? Number(process.versions.node.split(".")[0]);
  const installed =
    options.installed ?? (() => installedDependenciesFingerprint(options.root, options.root));
  const session = new ProviderSession(options.provider, installed);
  /** Changed program files not yet fed to the worker (D5); a new worker reads them from disk. */
  const feed = new Set<RelativePath>();
  let store: LintStore | null = null;
  let refused: string | null = null;
  let lastError: string | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let closed = false;
  let timer: NodeJS.Timeout | null = null;

  const open = (policy: Policy): LintStore | null => {
    if (store !== null) return store;
    let opened = openLintStore(options.commonDir, policy);
    if (isLintStoreOpenFailure(opened) && opened.reason === "corrupt") {
      options.log(`lint: the lint store was corrupt (${opened.error}); linting again`);
      for (const suffix of ["", "-wal", "-shm"]) {
        rmSync(`${lintStorePath(options.commonDir)}${suffix}`, { force: true });
      }
      opened = openLintStore(options.commonDir, policy);
    }
    if (!isLintStoreOpenFailure(opened)) {
      store = opened;
      return store;
    }
    const text = `lint: the lint store did not open: ${JSON.stringify(opened)}`;
    if (refused !== text) options.log(text);
    refused = text;
    return null;
  };
  const shut = async () => {
    feed.clear();
    try {
      await session.close();
    } finally {
      store?.close();
      store = null;
    }
  };
  /** One pass; when the pass should look again, or `null`. */
  const once = async (): Promise<EpochMs | null> => {
    const policy = options.policy();
    if (!policy.lint.enabled) {
      await shut();
      return null;
    }
    const opened = open(policy);
    if (opened === null) return null;
    const interrupted = () => again || closed;
    const state = { store: opened, policy, session, nodeMajor, feed, now, interrupted };
    const end = await runLintPass(options, state);
    // A report that grew the closure or the program is keyed again at once (017-04's contract).
    if (end.grew) again = true;
    return end.wakeAt;
  };
  /** The one timer, at `at`; a nudge sooner replaces it. */
  const wakeAt = (at: EpochMs | null) => {
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
      let wake: EpochMs | null = null;
      try {
        wake = await once();
        lastError = null;
      } catch (error) {
        // A failure that repeats at every pass is told once.
        const failure = error instanceof Error ? error : new Error(String(error));
        if (failure.message !== lastError) options.onError(failure);
        lastError = failure.message;
        feed.clear();
        await session.close().catch(() => {});
      }
      wakeAt(wake);
    } while (again && !closed);
    running = null;
  };

  const self: LintPass = {
    nudge() {
      if (closed) return;
      if (running !== null) again = true;
      else running = loop();
    },
    idle: () => running ?? Promise.resolve(),
    async close() {
      closed = true;
      await running;
      wakeAt(null);
      await shut();
    },
  };
  return self;
}
