import type { TestFileRef } from "../types/keys.js";
import { BacklogWall, wallEstimate } from "./backlog.js";
import type { AtGrant } from "./tier-plan.js";
import type { TierFile } from "./tiers.js";

/** The runner traits a tier's width is read from (`RunnerTraits.tierWidth`, `tierPart`). */
export interface WidthTraits {
  tierWidth(ref: TestFileRef, grant: number): number;
  tierPart(ref: TestFileRef): string;
}

/** The workers a backlog tier of `picked` asks the pool for: no more than its runner runs it with. */
export function widest(traits: WidthTraits, picked: readonly TierFile[]): number {
  const widths = picked.map((p) => traits.tierWidth(p.file.ref, picked.length));
  return Math.min(picked.length, Math.max(1, ...widths));
}

/**
 * The fewest permits a backlog tier of `picked` may hold (row 011-97): the
 * workers its runner runs it with at a grant of 1, at most one per file.
 */
export function fewest(traits: WidthTraits, picked: readonly TierFile[]): number {
  const widths = picked.map((p) => traits.tierWidth(p.file.ref, 1));
  return Math.min(picked.length, Math.max(1, ...widths));
}

/** What `fit` needs of the pick: its wall budget, the offer, the width asked, slot and trim. */
export interface PickWidth {
  /** The wall budget of a tier run that many workers wide (`Shape.budgetAt`, row 011-418). */
  readonly budgetAt: (workers: number) => number;
  readonly offer: number;
  readonly width: number;
  readonly slot: number | null;
  readonly trimmed: boolean;
  readonly batch: boolean;
  readonly backlog: boolean;
  readonly tierSize: number;
}

/**
 * The prefix of `picked` that fits `grant` and whether a batch's tier of it
 * is narrower than an edit's tier (`GrantAsk.atGrant`): granted less than
 * offered (another daemon took permits meanwhile), a backlog tier keeps the
 * prefix its wall budget holds at the grant (task 001-366), the budget of
 * the grant's share of the ceiling (row 011-418).
 */
export function grantFit(
  traits: WidthTraits,
  picked: readonly TierFile[],
  pick: PickWidth,
): (grant: number) => AtGrant {
  return (grant) => {
    let files = picked;
    let { trimmed } = pick;
    if (pick.backlog && pick.slot === null && trims(pick, grant, picked.length)) {
      const fits = new BacklogWall(pick.budgetAt(grant));
      const keep = picked.findIndex(
        (p) =>
          !fits.take(
            p.file.durationMs,
            traits.tierWidth(p.file.ref, grant),
            traits.tierPart(p.file.ref),
          ),
      );
      if (keep !== -1) {
        files = picked.slice(0, keep);
        trimmed = true;
      }
    }
    const narrower = pick.batch && narrowerThanEdit(traits, pick.tierSize, files, grant, trimmed);
    return { files, narrower };
  };
}

/**
 * Whether a grant trims the pick: one below the width it asks or the offer,
 * whichever is less, or, for a backlog tier whose budget scales with its
 * workers (row 011-418), any grant whose budget is below the offer's. A
 * runner capped below the offer asks its cap: a grant of the cap still
 * trims to the grant's share (review 0.1.576 B1).
 */
function trims(pick: PickWidth, grant: number, files: number): boolean {
  if (grant < Math.min(pick.width, pick.offer)) return true;
  return !pick.batch && grant < files && pick.budgetAt(grant) < pick.budgetAt(pick.offer);
}

/**
 * Row 011-308: a batch's tier of `picked` at `grant` runs fewer workers than
 * an edit's tier of its files: one of the first `runner.tierSize` files, or,
 * when the wall budget left files out (`trimmed`, review 0.1.413 B1), of
 * `runner.tierSize` files, as an edit's tier has no such budget.
 */
function narrowerThanEdit(
  traits: WidthTraits,
  tierSize: number,
  picked: readonly TierFile[],
  grant: number,
  trimmed: boolean,
): boolean {
  if (picked.length === 0) return trimmed;
  const files = trimmed ? Math.max(tierSize, picked.length) : picked.length;
  const edit = Math.min(
    tierSize,
    files,
    Math.max(1, ...picked.slice(0, tierSize).map((p) => traits.tierWidth(p.file.ref, tierSize))),
  );
  const leased = Math.max(1, ...picked.map((p) => traits.tierWidth(p.file.ref, grant)));
  return Math.min(picked.length, leased) < edit;
}

/** The wall estimate of `files` at `grant` workers: the sum and longest at their runner's width. */
export function estimateMs(traits: WidthTraits, files: readonly TierFile[], grant: number): number {
  const first = files[0]?.file.ref;
  if (first === undefined) return 0;
  const durations = files.map(({ file }) => file.durationMs ?? 0);
  const sum = durations.reduce((total, ms) => total + ms, 0);
  const width = Math.min(files.length, traits.tierWidth(first, grant));
  return wallEstimate(sum, Math.max(0, ...durations), width);
}
