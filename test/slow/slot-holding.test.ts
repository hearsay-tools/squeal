import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireSlowSlot, heldPermits, takePermit } from "../../src/core/slow/slot.js";
import { slotFiles } from "../../src/core/slow/slot-files.js";
import {
  partnerRuns,
  RAN_FRESH_MS,
  readRecord,
  type SlotFile,
} from "../../src/core/slow/slot-holding.js";
import type { WorktreeId } from "../../src/core/types/common.js";

/*
 * Rows 023-77, 023-78: a permit's lock file records what its holder runs
 * (`SlowSlot.holding`), stamped with the holder row, so a daemon of an
 * older release that takes the permit (it writes only the holder row, as
 * `takePermit` does) is read without the earlier holder's files, and a lock
 * file an older release wrote reads as a holder with no files.
 */

const GROUP = "browser";
const FILE: SlotFile = { project: "", path: "e2e/thread-scroll.e2e.ts", durationMs: 97_000 };
const tree = { pid: process.pid, worktreeId: "tree" as WorktreeId };
const commit = { pid: process.pid + 1, worktreeId: "commit" as WorktreeId };

let dir: string;
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "squeal-slot-holding-")), "slot");
});
afterEach(() => rmSync(join(dir, ".."), { recursive: true, force: true }));

const permitPath = () => join(dir, slotFiles(GROUP).permit(0));
const held = () => heldPermits({ dir, group: GROUP }).map((p) => p.record);

describe("the slot's holder record (rows 023-77, 023-78)", () => {
  it("names the files the holder runs while it holds the slot, and after it let go", () => {
    const slot = acquireSlowSlot({ dir, owner: tree, group: GROUP });
    slot?.holding([FILE]);
    expect(held()).toEqual([
      expect.objectContaining({ kind: "holder", worktreeId: "tree", files: [FILE] }),
    ]);
    slot?.release();
    expect(held()).toEqual([]);
    expect(readRecord(permitPath())).toEqual(
      expect.objectContaining({ worktreeId: "tree", files: [FILE] }),
    );
  });

  it("drops an earlier holder's files when an older daemon takes the permit", () => {
    const slot = acquireSlowSlot({ dir, owner: tree, group: GROUP });
    slot?.holding([FILE]);
    slot?.release();
    // An older release takes and frees the permit with the new table present.
    const older = takePermit(permitPath(), commit);
    expect(older).not.toBeNull();
    const record = held()[0];
    expect(record).toEqual(expect.objectContaining({ kind: "holder", worktreeId: "commit" }));
    expect(record).not.toHaveProperty("files");
    older?.close();
    expect(held()).toEqual([]);
    expect(readRecord(permitPath())).not.toHaveProperty("files");
    // The slot is free for this release again.
    expect(acquireSlowSlot({ dir, owner: tree, group: GROUP })).not.toBeNull();
  });

  it("reads a lock file an older release wrote, without the table, as a holder with no files", () => {
    acquireSlowSlot({ dir, owner: tree, group: GROUP })?.release();
    const older = takePermit(permitPath(), commit);
    const record = held()[0];
    expect(record).toEqual({
      kind: "holder",
      pid: commit.pid,
      worktreeId: "commit",
      since: expect.any(Number),
    });
    older?.close();
  });

  it("records nothing for a permit file that does not exist", () => {
    expect(partnerRuns(dir, GROUP, 2, tree.worktreeId)).toEqual([]);
  });

  it("keeps every file other worktrees ran, each at its first run, the first first (row 023-83)", () => {
    const a: SlotFile = { project: "", path: "e2e/a.e2e.ts", durationMs: null };
    const b: SlotFile = { project: "", path: "e2e/b.e2e.ts", durationMs: null };
    const take = (owner: typeof tree, files: SlotFile[]) => {
      const slot = acquireSlowSlot({ dir, owner, group: GROUP });
      slot?.holding(files);
      slot?.release();
    };
    take(commit, [a]);
    take(commit, [b]);
    take(tree, [b]);
    // A run again of a file keeps its first run's place.
    take(commit, [a]);
    const runs = partnerRuns(dir, GROUP, 1, tree.worktreeId);
    expect(runs.map((r) => [r.worktreeId, r.path])).toEqual([
      ["commit", a.path],
      ["commit", b.path],
    ]);
    // The commit side sees the working tree's run; a run older than a commit daemon's life counts no more.
    expect(partnerRuns(dir, GROUP, 1, commit.worktreeId).map((r) => r.path)).toEqual([b.path]);
    const later = Date.now() + RAN_FRESH_MS + 1_000;
    expect(partnerRuns(dir, GROUP, 1, tree.worktreeId, later)).toEqual([]);
  });
});
