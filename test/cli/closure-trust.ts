import { ensureWriteMarkers } from "../../src/core/store/write-markers.js";
import type { Store } from "../../src/core/types/store.js";
import { storeClosures as putClosures } from "./source-path-fixture.js";
import { NOW } from "./status-wait-fixture.js";

/*
 * Rows 011-44 and 011-45 (repaired after review 0.1.489): the database
 * moves the write markers once a daemon of this release made their
 * triggers. These helpers make them, record closures, and register a
 * daemon of an earlier release.
 */

/** `putClosures`' rows in one transaction, as `storeClosures` writes them; the triggers move the marker. */
export function recordClosures(store: Store, files: readonly string[], by: string): void {
  store.transaction(() => putClosures(store, files, by));
}

/** The store as a daemon of this release leaves it when it registers: the triggers made. */
export function armMarkers(store: Store): void {
  ensureWriteMarkers(store);
}

/** A daemon of an earlier release registered for worktree `id` at `root`. */
export function registerUnclaimed(store: Store, id: string, root: string, commonDir: string): void {
  store.worktrees.upsert({
    id,
    root,
    commonDir,
    isMain: false,
    registeredAt: 1,
    daemon: {
      socketPath: "/tmp/squeal-test-earlier.sock",
      startedAt: NOW - 30_000,
      heartbeatAt: NOW - 1_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-earlier",
      token: "earlier",
    },
  });
}
