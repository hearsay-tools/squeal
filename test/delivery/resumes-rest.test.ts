import { beforeEach, describe, expect, it } from "vitest";
import { markRest } from "../../src/core/delivery/index.js";
import { resumesRest } from "../../src/core/delivery/liveness.js";
import type { EpochMs, Store } from "../../src/core/types/index.js";
import { freshStore, WT } from "../state/helpers.js";

/*
 * Spec 011 C9 as amended 2026-10-21 (row 011-91): a daemon resumes a rest
 * when, at its start, the rest mark is later than every heartbeat its
 * worktree's row records. The daemon reads it before it registers.
 */

let store: Store;

const row = () => store.worktrees.get(WT);

/** The worktree's row with a daemon that heartbeat at `heartbeatAt`. */
function daemonAt(heartbeatAt: EpochMs): void {
  store.worktrees.setDaemon(WT, {
    socketPath: "/run/squeal.sock",
    startedAt: 1,
    heartbeatAt,
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.0.0-test",
  });
}

beforeEach(() => {
  store = freshStore();
  store.worktrees.upsert({
    id: WT,
    root: "/repo",
    commonDir: "/repo/.git",
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  daemonAt(100);
});

describe("resumesRest (row 011-91)", () => {
  it("is true after an unused stop: the mark, then the record cleared", () => {
    markRest(store, WT, 200);
    store.worktrees.setDaemon(WT, null);
    expect(resumesRest(store, row())).toBe(true);
  });

  it("is false once a daemon heartbeat after the rest", () => {
    markRest(store, WT, 200);
    store.worktrees.setDaemon(WT, null);
    daemonAt(300);
    expect(resumesRest(store, row())).toBe(false);
    store.worktrees.setDaemon(WT, null);
    expect(resumesRest(store, row())).toBe(false);
  });

  it("is false with no mark: a first start, a departure's exit, a stop", () => {
    store.worktrees.setDaemon(WT, null);
    expect(resumesRest(store, row())).toBe(false);
    expect(resumesRest(store, null)).toBe(false);
  });

  it("is true for a record the resting daemon left: its heartbeat came before the mark", () => {
    markRest(store, WT, 200);
    expect(resumesRest(store, row())).toBe(true);
  });
});
