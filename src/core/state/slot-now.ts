import { heldPermits } from "../slow/slot.js";
import type { AbsolutePath } from "../types/common.js";
import type { SlotWait, SlowTierActivity } from "../types/status.js";

/*
 * Review 0.1.621 B2: a lane publishes `slot: "held"` when it found every
 * permit taken at its last try. The holder can release its permit before
 * the lane tries again (up to its recheck, 15 s by default), or exit, and
 * the waiting daemon stays live, so a reader that said "in use" from the
 * published wait alone could call a free slot in use. The lane publishes
 * where its slot is (`slotAt`); a reader tests the permits then.
 */

type Waiting = Extract<SlowTierActivity, { kind: "waiting" }>;

/**
 * A published wait of `group`'s lane as true now, without its `slotAt`.
 * A `held` or `turn` slot wait whose permits read every one held reads
 * `in use`; a `held` one with a permit free reads `free`; a `turn` one with
 * a permit free stays `turn`. A wait whose slot cannot be read keeps what
 * its daemon published: `held` then means taken at its last try. So does
 * one whose every permit counts held only with some whose lock could not be
 * tested (re-review 0.1.621 B3): a malformed permit file is no proof that a
 * process holds it.
 */
export function slotNow(activity: Waiting, group: string): Waiting {
  const { slotAt, ...shown } = activity;
  const published = shown.slot;
  if (shown.for !== "slot" || slotAt === undefined) return shown;
  if (published !== "held" && published !== "turn") return shown;
  const now = permitsNow(slotAt.dir as AbsolutePath, slotAt.permits, group, published);
  return { ...shown, slot: now };
}

/**
 * `in use` when each of `permits` is held now; `free` for `held`, `turn`
 * for `turn`, when one is free now; what was published when it is not known.
 */
function permitsNow(
  dir: AbsolutePath,
  permits: number,
  group: string,
  published: "held" | "turn",
): SlotWait {
  let held: ReturnType<typeof heldPermits>;
  try {
    held = heldPermits({ dir, permits, group });
  } catch {
    return published;
  }
  if (held.length < permits) return published === "held" ? "free" : "turn";
  const proved = held.filter((permit) => permit.unknown !== true).length;
  return proved >= permits ? "in use" : published;
}
