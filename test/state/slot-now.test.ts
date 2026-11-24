import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireSlowSlot, type SlowSlot } from "../../src/core/slow/slot.js";
import { slotFiles } from "../../src/core/slow/slot-files.js";
import { slotNow } from "../../src/core/state/slot-now.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import type { SlotWait } from "../../src/core/types/status.js";

/*
 * Re-review 0.1.621 B3: a slot wait reads `in use` only when every permit
 * reads held now by a lock test. A malformed permit file that no process
 * holds counts held for the slot, but is no proof of use: the words keep
 * what the daemon published (`held`: "taken at its last try").
 */

const GROUP = "browser";
let dir: AbsolutePath;
let held: SlowSlot | null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sq-slot-now-")) as AbsolutePath;
  held = null;
});

afterEach(() => {
  held?.release();
  rmSync(dir, { recursive: true, force: true });
});

/** Permit 0 held by another worktree; permit 1 `malformed` (no holder) or `free`. */
function slot(second: "malformed" | "free"): void {
  const owner = { pid: process.pid, worktreeId: "other-worktree" as WorktreeId };
  held = acquireSlowSlot({ dir, owner, permits: 2, group: GROUP });
  if (held === null) throw new Error("the test's slot permit was not taken");
  if (second === "malformed")
    writeFileSync(join(dir, slotFiles(GROUP).permit(1)), "not a database");
}

const now = (published: "held" | "turn"): SlotWait | undefined =>
  slotNow({ kind: "waiting", for: "slot", slot: published, slotAt: { dir, permits: 2 } }, GROUP)
    .slot;

describe("a slot wait with a permit no lock test reads (re-review 0.1.621 B3)", () => {
  it("keeps the published wait when one permit is held and the other is malformed", () => {
    slot("malformed");
    expect(now("held")).toBe("held");
    expect(now("turn")).toBe("turn");
  });

  it("reads a permit free when the other one is free, as before", () => {
    slot("free");
    expect(now("held")).toBe("free");
  });

  it("reads in use when a lock test finds every permit held", () => {
    slot("free");
    const owner = { pid: process.pid, worktreeId: "third-worktree" as WorktreeId };
    const second = acquireSlowSlot({ dir, owner, permits: 2, group: GROUP });
    try {
      expect(now("held")).toBe("in use");
    } finally {
      second?.release();
    }
  });
});
