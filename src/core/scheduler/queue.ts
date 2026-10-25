import { compare } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import type { RelativePath, RevisionNumber, TestFileRef } from "../types/index.js";
import type { FileState } from "./files.js";
import { FocusedEntries } from "./focused-entries.js";
import { type PromotionRank, Promotions, type PublishedPromotion } from "./promotions.js";

/**
 * Run order of queued test files, most urgent first.
 *
 * Spec 001 D5 step 4: "checks whose last known state is `fail` (including
 * inherited failures), then test files that import a changed path directly
 * according to the runner's module graph, then transitively affected files,
 * then never-run files". `edited` is a test file the revision itself added or
 * edited, ahead of the other direct importers (011 C4 as amended for gh-31,
 * task 011-17); `direct` is one the runner reported as a direct importer
 * (`AffectedTestFiles.direct`).
 */
export const Priority = { failing: 0, edited: 1, direct: 2, transitive: 3, neverRun: 4 } as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

const NO_DIRECT_IMPORTERS: ReadonlySet<string> = new Set();

/** C4 step 4's groups (as amended 2026-10-20, task 011-22): an edit's work, catch-up, the rest. */
const Group = { first: 0, catchUp: 1, second: 2 } as const;
type Group = (typeof Group)[keyof typeof Group];

/**
 * The starvation bound (task 001-107, review wave 11 N3; D5 step 4 as
 * amended): after this many tiers in a row of recent work only while the
 * backlog waited, the next tier is the backlog's. Recent work keeps at least
 * four tiers in five while edits keep coming; the backlog moves by one tier
 * in five.
 */
export const RECENT_TIERS_PER_BACKLOG_TIER = 4;

/**
 * The class of a file at a revision that changed `changed`. `direct` holds the
 * `testFileId`s of the runner's direct importers; a revision whose runner part
 * has not run yet has none, and the runner part raises them (`RunQueue.add`).
 */
export function priorityOf(
  file: FileState,
  changed: ReadonlySet<RelativePath>,
  direct: ReadonlySet<string> = NO_DIRECT_IMPORTERS,
): Priority {
  if (file.failing) return Priority.failing;
  if (changed.has(file.ref.path)) return Priority.edited;
  if (direct.has(file.id)) return Priority.direct;
  return file.resultKey === null ? Priority.neverRun : Priority.transitive;
}

/** Last known run time of a test file in milliseconds; `null` when unknown. */
export type DurationOf = (ref: TestFileRef) => number | null;

interface Entry {
  readonly ref: TestFileRef;
  priority: Priority;
  readonly seq: number;
  forced: boolean;
  /** Queued by a revision's edit: its closure changed or it was added (`Ledger.settle`). */
  recent: boolean;
  /**
   * The revisions whose edits made it recent, `null` for one with none; it
   * stays recent while one is left (`toCatchUp`, review wave 5, B1).
   */
  readonly recentBy: Set<RevisionNumber | null>;
  /**
   * Queued by a revision of `CATCH_UP_KEYED_PATHS` keyed paths or more (spec 011 C4 step 4 as
   * amended 2026-10-20, task 011-22): catch-up while it is not recent or promoted.
   */
  catchUp: boolean;
  /** Tokens that ranked a slow entry (004 D2's evidence), gathered until it leaves the queue. */
  evidence: ReadonlySet<string>;
}

const NO_EVIDENCE: ReadonlySet<string> = new Set();

const NOTHING_SLOW = (): boolean => false;

/**
 * Test files waiting for a tier, one entry each. Re-planning between tiers
 * (D5 step 5) is `ordered()` on the queue as the latest revision left it.
 *
 * Slow files (spec 004 D1) form their own class (D2): `ordered`, `hasRecent`
 * and the starvation bound see the fast entries only, `orderedSlow` the slow
 * ones. Which file is slow is read when asked (`setSlow`), so a policy reload
 * moves queued files between the classes.
 */
export class RunQueue {
  readonly #entries = new Map<string, Entry>();
  #seq = 0;
  /** Tiers in a row that took recent entries only while others waited. */
  #recentTiers = 0;
  #isSlow: (ref: TestFileRef) => boolean = NOTHING_SLOW;
  readonly #promotions = new Promotions();
  /** Named waits' focused checks (spec 011 C15, row 011-145): they go before every entry. */
  readonly focused = new FocusedEntries();
  readonly #queued = (id: string) => this.#entries.has(id);
  /** Open `settlingOnce` calls: while any is, `add` leaves the promotions as they are. */
  #settleHeld = 0;

  /** Every entry, fast and slow. */
  get size(): number {
    return this.#entries.size;
  }

  get fastSize(): number {
    return this.#fast().length;
  }

  get slowSize(): number {
    return this.#entries.size - this.fastSize;
  }

  /** Spec 004 D1's `isSlow` under the policy in force. */
  setSlow(isSlow: (ref: TestFileRef) => boolean): void {
    this.#isSlow = isSlow;
  }

  isSlow(ref: TestFileRef): boolean {
    return this.#isSlow(ref);
  }

  /**
   * The clock promotions' deadlines are on, whether a test file's run is in
   * flight, and where their changes are published (C15, task 011-13).
   */
  setPromotionClock(
    now: () => number,
    isRunning: (ref: TestFileRef) => boolean,
    publish?: (live: readonly PublishedPromotion[]) => void,
  ): void {
    this.#promotions.setClock(now, isRunning, publish);
  }

  /**
   * Spec 011 C15: a named wait promotes the test files it selected by their
   * own paths until `until`, or until none of them is queued or running
   * (their keys settled), whichever comes first. A promoted queued file is
   * work of the first group and leads it, the earlier request first; one
   * queued again while the promotion lasts (an edit during the wait) is
   * promoted too. Nothing joins a running tier; the tier may yield to it
   * (`TierYields`, C4 step 5 as amended 2026-10-21, row 011-51).
   */
  promote(refs: readonly TestFileRef[], until: number): void {
    this.#promotions.add(refs, until, this.#queued);
  }

  /**
   * Runs `fn` as one step of C15 Lifetime: its `add`s settle no promotion,
   * and the promotions settle once it returns. A record queues a file again
   * after it took it off the queue or ended its run (a cut, a re-run of a
   * grown environment, a first-seen path or a first failure); an `add` in
   * between would find it neither queued nor running and end a wait's
   * promotion of it (rows 011-193, 011-196).
   */
  settlingOnce<T>(fn: () => T): T {
    this.#settleHeld += 1;
    try {
      return fn();
    } finally {
      this.#settleHeld -= 1;
      if (this.#settleHeld === 0) this.#promotions.settle(this.#queued);
    }
  }

  /** Whether `ref`'s entry is queued and promoted now (C15). */
  isPromoted(ref: TestFileRef): boolean {
    const id = testFileId(ref);
    return this.#entries.has(id) && this.#promotions.rankOf(id) !== null;
  }

  /**
   * C15's rank of `ref`, queued or running, at `now`, a reading of the
   * promotions' clock: the request order of the earliest promotion live
   * then that holds it, and that promotion's deadline; `null` when none
   * does, which ranks after every promoted file (`TierYields`, row 011-184,
   * review `reviews/0.1.296-r2.md` B2).
   */
  rankAt(ref: TestFileRef, now: number): PromotionRank | null {
    return this.#promotions.rankAt(testFileId(ref), now);
  }

  /** `isRecent` or `isPromoted`: work of C4 step 4's first group (C15). */
  isFirstGroup(ref: TestFileRef): boolean {
    return this.isRecent(ref) || this.isPromoted(ref);
  }

  /** Catch-up (C4 step 4 as amended 2026-10-20, task 011-22): queued so, and not of the first group. */
  isCatchUp(ref: TestFileRef): boolean {
    const entry = this.#entries.get(testFileId(ref));
    return entry !== undefined && this.#groupOf(entry) === Group.catchUp;
  }

  has(ref: TestFileRef): boolean {
    return this.#entries.has(testFileId(ref));
  }

  /**
   * Queues a test file, or raises the priority of its entry. A `forced` entry
   * (`run --all --force`) runs even when its key has a result. A `recent`
   * entry stays recent until it leaves the queue, and a `catchUp` one is
   * catch-up until then unless it is recent or promoted too (C4 step 4 as
   * amended 2026-10-20, task 011-22).
   */
  add(
    ref: TestFileRef,
    priority: Priority,
    forced = false,
    recent = false,
    catchUp = false,
    by: RevisionNumber | null = null,
  ): void {
    if (this.#settleHeld === 0) this.#promotions.settle(this.#queued);
    const id = testFileId(ref);
    const entry = this.#entries.get(id);
    if (entry) {
      entry.priority = Math.min(entry.priority, priority) as Priority;
      entry.forced ||= forced;
      entry.recent ||= recent;
      if (recent) entry.recentBy.add(by);
      entry.catchUp ||= catchUp;
      return;
    }
    this.#entries.set(id, {
      ref,
      priority,
      seq: this.#seq++,
      forced,
      recent,
      recentBy: new Set(recent ? [by] : []),
      catchUp,
      evidence: NO_EVIDENCE,
    });
  }

  /**
   * Spec 004 D2 as amended (task 004-82): `tokens` a revision's changed
   * files offered that `ref`'s slow file matches. They add to the entry's
   * evidence until it leaves the queue; an absent entry takes none.
   */
  addEvidence(ref: TestFileRef, tokens: Iterable<string>): void {
    const entry = this.#entries.get(testFileId(ref));
    if (entry === undefined) return;
    const evidence = new Set([...entry.evidence, ...tokens]);
    if (evidence.size > entry.evidence.size) entry.evidence = evidence;
  }

  /** The tokens `ref`'s queued entry gathered (`addEvidence`); none when it is not queued. */
  evidenceOf(ref: TestFileRef): ReadonlySet<string> {
    return this.#entries.get(testFileId(ref))?.evidence ?? NO_EVIDENCE;
  }

  /**
   * What a store transaction that changes `refs`' entries would lose if it
   * rolled back (task 004-70): their entries as they are now, absent ones
   * included, with priority and place, and the live promotions. The returned
   * function puts them back as they were, settling nothing on the way.
   */
  hold(refs: Iterable<TestFileRef>): () => void {
    const entries = new Map<string, Entry | null>();
    for (const ref of refs) {
      const id = testFileId(ref);
      const entry = this.#entries.get(id);
      entries.set(id, entry === undefined ? null : { ...entry });
    }
    const promotions = this.#promotions.hold();
    return () => {
      for (const [id, entry] of entries) {
        if (entry === null) this.#entries.delete(id);
        else this.#entries.set(id, { ...entry });
      }
      promotions();
    };
  }

  /** Empties the queue; promotions and focused entries go with it. */
  clear(): void {
    this.#entries.clear();
    this.#recentTiers = 0;
    this.#promotions.clear();
    this.focused.clear();
  }

  /**
   * `revision` made a recent entry so and turned out catch-up once its
   * runner part listed the test files it added (review wave 5, B1): the
   * entry is catch-up unless another revision's edit, or one with none,
   * made it recent too. A promotion keeps it in the first group.
   */
  toCatchUp(ref: TestFileRef, revision: RevisionNumber): void {
    const entry = this.#entries.get(testFileId(ref));
    if (entry === undefined || !entry.recentBy.delete(revision)) return;
    entry.catchUp = true;
    if (entry.recentBy.size === 0) entry.recent = false;
  }

  remove(ref: TestFileRef): boolean {
    return this.#entries.delete(testFileId(ref));
  }

  isForced(ref: TestFileRef): boolean {
    return this.#entries.get(testFileId(ref))?.forced ?? false;
  }

  isRecent(ref: TestFileRef): boolean {
    return this.#entries.get(testFileId(ref))?.recent ?? false;
  }

  /**
   * Some entry was queued by an edit: tiers stay `runner.tierSize` (D5 step 5
   * as amended). `where` narrows the entries looked at, to free lanes or one
   * lane (task 001-140).
   */
  hasRecent(where: (ref: TestFileRef) => boolean = () => true): boolean {
    return this.#fast().some((entry) => entry.recent && where(entry.ref));
  }

  /**
   * `hasRecent`, promoted entries included (C15): the tier is an edit's.
   * Not what cancels a backlog tier outright: a promotion makes a tier
   * yield (`TierYields`, row 011-51).
   */
  hasFirstGroup(where: (ref: TestFileRef) => boolean = () => true): boolean {
    return this.#fast().some((entry) => this.#firstGroup(entry) && where(entry.ref));
  }

  /**
   * Some entry `where` holds was made recent by a revision after `revision`:
   * an edit's work that came while a tier selected at `revision` runs (C4
   * step 5 as amended 2026-10-21, row 011-51).
   */
  hasRecentAfter(revision: RevisionNumber, where: (ref: TestFileRef) => boolean): boolean {
    return this.#fast().some(
      (entry) =>
        entry.recent &&
        where(entry.ref) &&
        [...entry.recentBy].some((by) => by !== null && by > revision),
    );
  }

  /**
   * Whether a fast entry promoted at `now`, a reading of the promotions'
   * clock, that `where` holds is queued (C15; row 011-51; row 011-194: the
   * decision's one reading). `where` is asked of promoted entries only, so
   * it may read the store (row 011-55: another worktree's claim).
   */
  hasPromoted(where: (ref: TestFileRef) => boolean, now: number): boolean {
    return this.#fast().some(
      (entry) => this.#promotions.rankAt(testFileId(entry.ref), now) !== null && where(entry.ref),
    );
  }

  /** Some fast entry `where` holds is queued (task 001-140: one of a free lane). */
  hasFast(where: (ref: TestFileRef) => boolean): boolean {
    return this.#fast().some((entry) => where(entry.ref));
  }

  /**
   * A tier was selected; `tookBacklog` when it took an entry of the second
   * group. A promoted entry counts as the first group's (C15), so named
   * waits cannot starve the backlog.
   */
  tierSelected(tookBacklog: boolean): void {
    const waiting = this.#fast().some((entry) => !this.#firstGroup(entry));
    this.#recentTiers = tookBacklog || !waiting ? 0 : this.#recentTiers + 1;
  }

  /**
   * Recent entries first, then catch-up, then the rest; within a group
   * priority, then shortest last known duration with unknown ones last (an
   * `edited` entry's unknown one first, as `joinSpan` counts it 0: 011 C4 as
   * amended, gh-31), then first queued, then project and path. Spec 001 D5
   * step 4 as amended (task 001-100, defect 19): work an edit caused runs
   * ahead of the baseline, an environment change or `run --all`, "within
   * each group D5's order stands"; "within a class, shortest last known
   * duration first, so a slow integration file never delays the edited
   * module's own unit test." Catch-up (011 C4 step 4 as amended 2026-10-20,
   * task 011-22) has two classes, failing and the rest, each shortest first
   * with unknown durations last: "the edited, direct and transitive classes
   * do not divide it." After `RECENT_TIERS_PER_BACKLOG_TIER` tiers of
   * recent entries only (`tierSelected`), the second group comes first
   * once, catch-up first. A promoted entry (C15) is of the first group and
   * leads it, failing files included. Fast entries only.
   */
  ordered(durationOf: DurationOf = () => null, turn = this.backlogTurn()): TestFileRef[] {
    return sorted(this.#fast(), durationOf, turn, this.#ranks());
  }

  /** The backlog comes first once: `RECENT_TIERS_PER_BACKLOG_TIER` tiers of the first group ran. */
  backlogTurn(): boolean {
    return this.#recentTiers >= RECENT_TIERS_PER_BACKLOG_TIER;
  }

  /**
   * The slow entries in the order the slow tier runs them, one at a time
   * (spec 004 D2): `ordered`'s, where recent work comes first too and a
   * promoted file leads (C15), which does not make the slow tier eligible.
   * `ranked` (`slow.rank` `"tokens"`, D2 as amended 2026-10-18): within a
   * class, more evidence first, then the duration order.
   */
  orderedSlow(durationOf: DurationOf = () => null, ranked = false): TestFileRef[] {
    return sorted(
      [...this.#entries.values()].filter((entry) => this.#isSlow(entry.ref)),
      durationOf,
      false,
      this.#ranks(),
      ranked,
    );
  }

  #fast(): Entry[] {
    return [...this.#entries.values()].filter((entry) => !this.#isSlow(entry.ref));
  }

  #firstGroup(entry: Entry): boolean {
    return entry.recent || this.#promotions.rankOf(testFileId(entry.ref)) !== null;
  }

  #groupOf(entry: Entry): Group {
    return groupOf(entry, this.#promotions.rankOf(testFileId(entry.ref)) !== null);
  }

  /** Each promoted entry's request order, for `sorted`. */
  #ranks(): ReadonlyMap<Entry, number> {
    const ranks = new Map<Entry, number>();
    for (const [id, entry] of this.#entries) {
      const rank = this.#promotions.rankOf(id);
      if (rank !== null) ranks.set(entry, rank);
    }
    return ranks;
  }
}

/** Each group's place in the order, the second group's turn (`backlogTurn`) or not. */
const GROUP_ORDER: Readonly<Record<"edits" | "turn", readonly Group[]>> = {
  edits: [Group.first, Group.catchUp, Group.second],
  turn: [Group.catchUp, Group.second, Group.first],
};

/**
 * `RunQueue.ordered`'s sort; `turn` puts the second group first, catch-up
 * leading it. `promoted` holds each promoted entry's request order: of the
 * first group, ahead of its other classes (C15). `ranked` orders a class by
 * evidence before duration (004 D2).
 */
function sorted(
  entries: readonly Entry[],
  durationOf: DurationOf,
  turn: boolean,
  promoted: ReadonlyMap<Entry, number>,
  ranked = false,
): TestFileRef[] {
  const evidence = (entry: Entry) => (ranked ? entry.evidence.size : 0);
  const rank = (entry: Entry) => promoted.get(entry) ?? Number.POSITIVE_INFINITY;
  const order = GROUP_ORDER[turn ? "turn" : "edits"];
  const groups = new Map<Entry, number>();
  const classes = new Map<Entry, number>();
  const durations = new Map<Entry, number>();
  for (const entry of entries) {
    const group = groupOf(entry, promoted.has(entry));
    const catchUp = group === Group.catchUp;
    groups.set(entry, order.indexOf(group));
    classes.set(entry, catchUp ? Number(entry.priority !== Priority.failing) : entry.priority);
    const unknown = catchUp ? Number.POSITIVE_INFINITY : unknownDuration(entry.priority);
    durations.set(entry, durationOf(entry.ref) ?? unknown);
  }
  const group = (entry: Entry) => groups.get(entry) ?? 0;
  const classOf = (entry: Entry) => classes.get(entry) ?? 0;
  const duration = (entry: Entry) => durations.get(entry) ?? Number.POSITIVE_INFINITY;
  return [...entries]
    .sort(
      (a, b) =>
        group(a) - group(b) ||
        byDuration(rank(a), rank(b)) ||
        classOf(a) - classOf(b) ||
        evidence(b) - evidence(a) ||
        byDuration(duration(a), duration(b)) ||
        a.seq - b.seq ||
        compare(a.ref.project, b.ref.project) ||
        compare(a.ref.path, b.ref.path),
    )
    .map((entry) => entry.ref);
}

/** An entry's group: the first when recent or `promoted` (C15), else catch-up or the second. */
function groupOf(entry: Entry, promoted: boolean): Group {
  if (entry.recent || promoted) return Group.first;
  return entry.catchUp ? Group.catchUp : Group.second;
}

/**
 * Where an unknown duration sorts in its class: a test file the revision
 * added or edited is taken as the shortest, never after known long ones
 * (011 C4 as amended, gh-31); elsewhere after every known one.
 */
function unknownDuration(priority: Priority): number {
  return priority === Priority.edited ? 0 : Number.POSITIVE_INFINITY;
}

/** Ascending; two unknown (infinite) durations, or two unpromoted ranks, are equal. */
function byDuration(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}
