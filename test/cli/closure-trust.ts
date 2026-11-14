import { markClosureWrite } from "../../src/core/store/closure-writes.js";
import { claimStatesMarker } from "../../src/core/store/states-marker.js";
import { daemonIncarnation } from "../../src/core/types/daemon.js";
import type { Store } from "../../src/core/types/store.js";
import { storeClosures as putClosures } from "./source-path-fixture.js";
import { NOW } from "./status-wait-fixture.js";

/*
 * Row 011-44: the closure-write marker is trusted only while every daemon
 * registered on the store claimed its states marker (row 011-45's
 * `everyDaemonClaims`). These helpers record closures, register and claim
 * as a daemon of this release does.
 */

/** `putClosures`' rows with the marker moved after them in their transaction, as `storeClosures` writes. */
export function recordClosures(store: Store, files: readonly string[], by: string): void {
  store.transaction(() => {
    putClosures(store, files, by);
    markClosureWrite(store);
  });
}

/** Each registered daemon claims its states marker, as one of this release registers. */
export function claimAll(store: Store): void {
  for (const { id, daemon } of store.worktrees.list()) {
    if (daemon !== null) claimStatesMarker(store, id, daemonIncarnation(daemon));
  }
}

/** A daemon of an earlier release registered for worktree `id` at `root`: it claims no marker. */
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
