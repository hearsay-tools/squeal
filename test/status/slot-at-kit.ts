import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { slotFiles } from "../../src/core/slow/slot-files.js";
import { acquireSlowSlot } from "../../src/core/slow/slot.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import type { SlotAt, SlowTierActivity } from "../../src/core/types/status.js";

/*
 * Review 0.1.621 B2: a lane's slot wait as this release's daemon publishes
 * it, with where its slot is (`slotAt`), and the slot's one permit held by
 * another worktree or free, as a reader finds it. Re-review 0.1.621 B3:
 * or its permit file malformed, as no permit should read, and held by no
 * process, so a reader cannot tell whether a process holds it.
 */

/**
 * How the published wait's slot reads now: its permit `held`, `free`,
 * `malformed` (not a database, no holder), or no `slotAt` published.
 */
export type SlotThen = "held" | "free" | "malformed" | "unread";

/**
 * A `held` slot wait of `group`'s lane, published with a private slot
 * directory whose one permit `then` holds or leaves free; removed after the test.
 */
export function slotWait(
  group: string,
  then: SlotThen,
  slot: "held" | "turn" = "held",
): Extract<SlowTierActivity, { kind: "waiting" }> {
  const wait = { kind: "waiting", for: "slot", slot } as const;
  if (then === "unread") return wait;
  const dir = mkdtempSync(join(tmpdir(), "sq-slot-at-")) as AbsolutePath;
  const owner = { pid: process.pid, worktreeId: "other-worktree" as WorktreeId };
  const held = then === "held" ? acquireSlowSlot({ dir, owner, permits: 1, group }) : null;
  if (then === "held" && held === null) throw new Error("the test's slot permit was not taken");
  if (then === "malformed") writeFileSync(join(dir, slotFiles(group).permit(0)), "not a database");
  onTestFinished(() => {
    held?.release();
    rmSync(dir, { recursive: true, force: true });
  });
  const slotAt: SlotAt = { dir, permits: 1 };
  return { ...wait, slotAt };
}
