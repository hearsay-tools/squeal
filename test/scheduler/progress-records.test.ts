import { describe, expect, it } from "vitest";
import { lastScannedBy, markScanned, scannedBy } from "../../src/core/daemon/bootstrapped.js";
import { appendNote, readDaemonNotes } from "../../src/core/notes.js";
import {
  readCheckpointProgress,
  writeCheckpointProgress,
} from "../../src/core/scheduler/checkpoint-progress.js";
import { readHeadMove, writeHeadMove } from "../../src/core/scheduler/head-move-record.js";
import {
  endInstallWait,
  readInstallWait,
  recordInstallWait,
} from "../../src/core/scheduler/install-wait.js";
import {
  isRefined,
  readRefined,
  recordRefinedApplied,
  recordRefinedFailed,
} from "../../src/core/scheduler/refined.js";
import type { CheckpointProgress } from "../../src/core/types/scheduler.js";
import { type WorktreeMetaRow, worktreeMetaKey } from "../../src/core/types/store.js";
import { freshStore, OTHER, WT } from "../state/helpers.js";

/*
 * Row 011-339: each daemon progress record at its owner's interface, writes
 * in and reads out over a real store, with a missing and an unreadable
 * value. The raw rows below stand for what an older or broken writer left.
 */

function raw(row: WorktreeMetaRow, value: string) {
  const store = freshStore();
  store.meta.set(worktreeMetaKey(row, WT), value);
  return store;
}

describe("the refined revision", () => {
  it("with none recorded, reads null and counts every revision refined", () => {
    const store = freshStore();
    expect(readRefined(store, WT)).toBeNull();
    expect(isRefined(store, WT, 0)).toBe(true);
    expect(isRefined(store, WT, 1_000)).toBe(true);
  });

  it.each(["x", "", "1.5", "NaN"])("an unreadable %j reads as none recorded", (value) => {
    const store = raw("refined", value);
    // `Number("")` is 0, a whole number: the empty value reads as revision 0, as before.
    const expected = value === "" ? 0 : null;
    expect(readRefined(store, WT)).toBe(expected);
    expect(isRefined(store, WT, 5)).toBe(expected === null);
  });

  it("counts a revision at or before it refined, and one after it pending", () => {
    const store = freshStore();
    recordRefinedApplied(store, WT, 4);
    expect(readRefined(store, WT)).toBe(4);
    expect([3, 4, 5].map((r) => isRefined(store, WT, r))).toEqual([true, true, false]);
    expect(readRefined(store, OTHER)).toBeNull();
  });

  it("an applied runner part sets it, a lower one after a higher one included", () => {
    const store = freshStore();
    recordRefinedApplied(store, WT, 7);
    recordRefinedApplied(store, WT, 3);
    expect(readRefined(store, WT)).toBe(3);
  });

  it("a failed refinement raises it and never lowers it", () => {
    const store = freshStore();
    recordRefinedFailed(store, WT, 2);
    expect(readRefined(store, WT)).toBe(2);
    recordRefinedFailed(store, WT, 7);
    recordRefinedFailed(store, WT, 3);
    expect(readRefined(store, WT)).toBe(7);
    const broken = raw("refined", "x");
    recordRefinedFailed(broken, WT, 3);
    expect(readRefined(broken, WT)).toBe(3);
  });
});

describe("the install wait and its command", () => {
  it("with none recorded, waits for nothing", () => {
    expect(readInstallWait(freshStore(), WT)).toBeNull();
  });

  it("names the root's install, or the workspaces still missing theirs, with the command", () => {
    const store = freshStore();
    recordInstallWait(store, WT, [], "npm ci");
    expect(readInstallWait(store, WT)).toEqual({ workspaces: [], command: "npm ci" });
    recordInstallWait(store, WT, ["pkg/a", "pkg/b"], "pnpm install");
    expect(readInstallWait(store, WT)).toEqual({
      workspaces: ["pkg/a", "pkg/b"],
      command: "pnpm install",
    });
    expect(readInstallWait(store, OTHER)).toBeNull();
  });

  it("an ended wait waits for nothing", () => {
    const store = freshStore();
    recordInstallWait(store, WT, ["pkg/a"], "npm ci");
    endInstallWait(store, WT);
    expect(readInstallWait(store, WT)).toBeNull();
  });

  it.each(["false", "", "[not json", "{}", '{"a":1}'])("an unreadable %j is no wait", (value) => {
    expect(readInstallWait(raw("awaitingInstall", value), WT)).toBeNull();
  });

  it("keeps the strings of a stored list and drops the rest", () => {
    const store = raw("awaitingInstall", '["pkg/a", 3, null]');
    expect(readInstallWait(store, WT)).toEqual({ workspaces: ["pkg/a"], command: null });
  });

  it("a wait without a command, or with an empty one, names none (a daemon before task 001-410)", () => {
    const store = raw("awaitingInstall", "true");
    expect(readInstallWait(store, WT)).toEqual({ workspaces: [], command: null });
    store.meta.set(worktreeMetaKey("installCommand", WT), "");
    expect(readInstallWait(store, WT)).toEqual({ workspaces: [], command: null });
  });
});

const PROGRESS: CheckpointProgress = {
  id: "cp-1",
  kind: "run-all",
  revision: 3,
  startedAt: 1_000,
  done: 2,
  total: 5,
};

describe("the checkpoint progress", () => {
  it("with none recorded, no checkpoint is open", () => {
    expect(readCheckpointProgress(freshStore(), WT)).toBeNull();
  });

  it("reads what was written, owed included, and none once it ended", () => {
    const store = freshStore();
    writeCheckpointProgress(store, WT, PROGRESS);
    expect(readCheckpointProgress(store, WT)).toEqual(PROGRESS);
    const owed = {
      ...PROGRESS,
      kind: "baseline" as const,
      owed: { ids: ["r"], remaining: [{ project: "", path: "a.test.ts" }], strict: [] },
    };
    writeCheckpointProgress(store, WT, owed);
    expect(readCheckpointProgress(store, WT)).toEqual(owed);
    writeCheckpointProgress(store, WT, null);
    expect(store.meta.get(worktreeMetaKey("checkpoint", WT))).toBe("");
    expect(readCheckpointProgress(store, WT)).toBeNull();
    expect(readCheckpointProgress(store, OTHER)).toBeNull();
  });

  it.each([
    ["not JSON", "{oops"],
    ["not an object", "[1]"],
    ["no id", JSON.stringify({ ...PROGRESS, id: 1 })],
    ["a count not a number", JSON.stringify({ ...PROGRESS, done: "2" })],
    ["an unknown kind", JSON.stringify({ ...PROGRESS, kind: "other" })],
    ["an owed list not a list", JSON.stringify({ ...PROGRESS, owed: { ids: [], remaining: 1 } })],
  ])("an unreadable value, %s, is no open checkpoint", (_, value) => {
    expect(readCheckpointProgress(raw("checkpoint", value), WT)).toBeNull();
  });
});

describe("the head move", () => {
  it("with none recorded, reads null", () => {
    expect(readHeadMove(freshStore(), WT)).toBeNull();
  });

  it("reads the last move written, an unborn HEAD included", () => {
    const store = freshStore();
    writeHeadMove(store, WT, { head: "a".repeat(40), dirty: false, revision: 2 });
    writeHeadMove(store, WT, { head: null, dirty: true, revision: 4 });
    expect(readHeadMove(store, WT)).toEqual({ head: null, dirty: true, revision: 4 });
    expect(readHeadMove(store, OTHER)).toBeNull();
  });

  it.each([
    ["not JSON", "{oops"],
    ["a head not a string", JSON.stringify({ head: 1, dirty: false, revision: 1 })],
    ["no dirty flag", JSON.stringify({ head: "a", revision: 1 })],
    ["a revision not whole", JSON.stringify({ head: "a", dirty: false, revision: 1.5 })],
  ])("an unreadable value, %s, reads null", (_, value) => {
    expect(readHeadMove(raw("headMove", value), WT)).toBeNull();
  });
});

describe("the bootstrap marker", () => {
  it("with none recorded, no daemon scanned", () => {
    const store = freshStore();
    expect(lastScannedBy(store, WT)).toBeNull();
    expect(scannedBy(store, WT, 1_000)).toBe(false);
  });

  it("names the daemon that finished its start scan last", () => {
    const store = freshStore();
    markScanned(store, WT, 1_000);
    markScanned(store, WT, 2_000);
    expect(lastScannedBy(store, WT)).toBe(2_000);
    expect(scannedBy(store, WT, 2_000)).toBe(true);
    expect(scannedBy(store, WT, 1_000)).toBe(false);
    expect(lastScannedBy(store, OTHER)).toBeNull();
  });

  it.each(["x", "Infinity"])("an unreadable %j: no daemon scanned", (value) => {
    const store = raw("daemonBootstrapped", value);
    expect(lastScannedBy(store, WT)).toBeNull();
    expect(scannedBy(store, WT, 1_000)).toBe(false);
  });
});

describe("the notes", () => {
  it("with none recorded or an unreadable value, there are none", () => {
    expect(readDaemonNotes(freshStore(), WT)).toEqual([]);
    expect(readDaemonNotes(raw("notes", "{oops"), WT)).toEqual([]);
    expect(readDaemonNotes(raw("notes", '{"a":1}'), WT)).toEqual([]);
  });

  it("reads what was appended, per worktree", () => {
    const store = freshStore();
    const note = { at: 1, revision: null, text: "runner failed" };
    appendNote(store, WT, note);
    expect(readDaemonNotes(store, WT)).toEqual([note]);
    expect(readDaemonNotes(store, OTHER)).toEqual([]);
  });
});
