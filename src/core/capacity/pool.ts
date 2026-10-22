import { availableParallelism } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { currentUid, preparePrivateDir } from "../daemon/paths.js";
import { SLOT_WAITER_FRESH_MS, type SlowSlotOwner, takePermit } from "../slow/index.js";
import type { AbsolutePath } from "../types/index.js";
import { createTreeCpu, gatedPermits, type TreeCpu } from "./cores.js";
import { clearMark, type PoolMark, readMarks, writeMark } from "./marks.js";
import { fairShares } from "./share.js";

/** The numbers of the user-level `capacity` keys (spec 001 D11), injected by the daemon. */
export interface PoolCapacity {
  /** `capacity.hostSlots`: test processes for every daemon of the user. Default CPUs − 1, at least 1. */
  readonly hostSlots?: number;
  /** This repository's `capacity.projects` entry: `id` its root path, `slots` its daemons' cap together. */
  readonly project?: { readonly id: string; readonly slots: number };
}

export interface PermitPoolOptions extends PoolCapacity {
  /** The pool's directory, the slow slot's (`slowSlotDir`, spec 004 D2). */
  readonly dir: AbsolutePath;
  readonly owner: SlowSlotOwner;
  /** The uid the directory must belong to. Default: this process's. */
  readonly uid?: number;
  readonly now?: () => number;
  /** How often a daemon running a tier refreshes its mark and measures its tree. Default `MARK_REFRESH_MS`. */
  readonly refreshMs?: number;
  /**
   * The daemon's process tree (row 011-98). Default this process's under
   * `/proc`; `null`, as where there is none, counts processes only: no CPU
   * gate and no mark for an edit's tier.
   */
  readonly cores?: TreeCpu | null;
}

/** One backlog or checkpoint tier's grant, held until the tier ends. */
export interface PoolLease {
  /** The workers the tier may run: its permits. */
  readonly grant: number;
  readonly permits: number;
  /**
   * The tier starts `workers` wide: keeps at most that many, at least 1, and
   * returns the other permits. Its demand becomes `workers`, whatever it was
   * granted. Never throws.
   */
  shrinkTo(workers: number): void;
  /** Idempotent; never throws. The OS also returns the permits when the process dies. */
  release(): void;
}

/** Whose tier asks (task 004-61): a fast lane's waiters are served before a slow lane's. */
export type PoolLane = "fast" | "slow";

export interface PermitPool {
  /**
   * The grant for a tier of `lane` that wants `want` workers and runs no
   * fewer than `least` (default 1, row 011-97), or `null` when it may not
   * start yet: fewer than `least` permits it may take are free. The daemon
   * is then a waiter, marked, holding nothing for that tier. Never blocks;
   * the caller looks again (011 C10, row 011-96). When it throws it holds
   * nothing it took.
   */
  acquire(want: number, lane?: PoolLane, least?: number): PoolLease | null;
  /**
   * The grant `acquire(want)` would give now, taking nothing (spec 011 C4
   * step 5, task 001-366): the fair share less what this daemon's tiers
   * hold, under the project's cap. It reads the marks only, so permits taken
   * since without a mark, or left free for an older waiter, may make the
   * grant smaller. `0` when no share is left. Throws as `acquire` does when
   * the marks cannot be read.
   */
  offer(want: number, lane?: PoolLane): number;
  /**
   * A tier without a lease, an edit's, runs `workers` wide (011 C10 as
   * amended 2026-10-21, row 011-98): while it runs, the daemon's mark states
   * the CPU its tree uses, with no backlog demand of its own, so backlog
   * tiers shrink. It takes nothing and never waits. The function returned
   * ends it; idempotent, never throws.
   */
  running(workers: number): () => void;
  /** Releases every lease and clears the mark. */
  close(): void;
}

/** Half the mark's freshness, so a live holder's mark never goes stale. */
export const MARK_REFRESH_MS = SLOT_WAITER_FRESH_MS / 3;

/** Permit `i` of the pool. The slow slot's files (`slow.lock`, `slow.<i>.lock`) are its own. */
export function poolPermitFile(i: number): string {
  return `pool.${i}.lock`;
}

/** CPUs − 1, at least 1: run-mode Vitest's, Jest's and node:test's default (research/host-capacity.md 5). */
export function defaultHostSlots(): number {
  return Math.max(1, availableParallelism() - 1);
}

export function createPermitPool(options: PermitPoolOptions): PermitPool {
  return new LockFilePool(options);
}

interface Lease {
  readonly permits: DatabaseSync[];
  /** The workers its tier wants, kept above its grant while it waits (review 001-384, B1). */
  want: number;
}

/**
 * Spec 001 D11 Capacity (task 001-376): the slow slot's lock files (004 D2)
 * extended to backlog and checkpoint tiers of every lane, one pool per user
 * in the slot's directory.
 *
 * - The pool is `hostSlots` permits, each `pool.<i>.lock` taken as
 *   `takePermit` takes a slow permit: the OS returns it when its holder dies.
 *   Every backlog worker holds one: there is no free worker beside them
 *   (011 C10 as amended 2026-10-21, row 011-96).
 * - At each tier boundary a daemon reads the fresh marks (`readMarks`) and
 *   takes at most its fair share (`fairShares`), less what its other lanes'
 *   tiers hold. It leaves free what the waiters older than itself lack, the
 *   longest waiter first: it takes those permits too, to count what is free,
 *   and returns them at once.
 * - A daemon that gets less than its share, or nothing while it holds
 *   nothing, is a waiter from then until it gets it; its mark says since
 *   when. A held permit is never taken back.
 * - The mark states the daemon's demand, what its tiers want, apart from
 *   what they hold, so a waiter still counts for its whole tier (review
 *   001-384, B1).
 * - The mark is written at each boundary and each look, refreshed while a
 *   tier runs, an edit's included, and cleared when the last one ends. The
 *   waiter's age is kept across that gap between tiers, and forgotten after
 *   30 s without a lease or a look, by a refresh too while an edit's tier
 *   runs (review 0.1.255, B1).
 * - Each refresh measures the daemon's tree since the last (`TreeCpu`), and
 *   the mark states those cores; each permit taken needs the marks' cores
 *   below the slots or their grants below half of them (`gatedPermits`, 011
 *   C10 Size as amended 2026-10-21, row 011-98).
 * - A mark that cannot be written fails the acquisition, which returns what
 *   it took; after a shrink or a release the refresh writes it again
 *   (review 001-384, B2).
 */
class LockFilePool implements PermitPool {
  readonly #options: PermitPoolOptions;
  readonly #hostSlots: number;
  readonly #now: () => number;
  readonly #leases = new Set<Lease>();
  /** Tiers that run without a lease, an edit's: the workers of each (row 011-98). */
  readonly #edits = new Set<{ readonly workers: number }>();
  readonly #tree: TreeCpu | null;
  /** The cores the tree used in the last refresh window; `null` until one was measured. */
  #measured: number | null = null;
  #since: number | null = null;
  /** The want of the last look that got nothing, in the mark while it waits. */
  #pending = 0;
  /** Every acquisition waiting since `#since` was a slow lane's. */
  #slowWaiting = false;
  /** The waiting tier's fewest workers, in the mark while it waits (row 011-97). */
  #least = 1;
  #idleSince: number | null = null;
  #timer: NodeJS.Timeout | null = null;
  #mark: PoolMark | null = null;
  #closed = false;

  constructor(options: PermitPoolOptions) {
    this.#options = options;
    this.#hostSlots = Math.max(1, Math.floor(options.hostSlots ?? defaultHostSlots()));
    this.#now = options.now ?? Date.now;
    this.#tree = options.cores === undefined ? createTreeCpu() : options.cores;
  }

  acquire(want: number, lane: PoolLane = "fast", least = 1): PoolLease | null {
    if (this.#closed) return null;
    this.#prepareDir();
    const now = this.#now();
    this.#forget(now);
    this.#idleSince = null;
    const wanted = Math.max(1, Math.floor(want));
    const fewest = Math.min(wanted, Math.max(1, Math.floor(least)));
    const { others, inUse, demand, shares, entitled, target } = this.#share(
      wanted,
      lane,
      now,
      fewest,
    );
    const slow = lane === "slow";
    const rank = this.#since ?? now;
    // Task 004-61: a contended pool serves fast lanes first. A fast lane's tier leaves free only
    // what older fast waiters lack, a slow lane's also what every fast waiter lacks.
    const ahead = (o: PoolMark): boolean => {
      if (o.since === null) return false;
      // A slow waiter is ahead of a younger slow tier only; a fast one of any slow tier too.
      if (o.slow === true) return slow && o.since < rank;
      return slow || o.since < rank;
    };
    const reserve = others
      .filter(ahead)
      .reduce((sum, o) => sum + Math.max(0, (shares.get(o.id) ?? 0) - o.grant), 0);
    const allowed = Math.min(target, this.#gated(others, inUse, target));
    const permits = allowed < fewest ? [] : this.#take(allowed, reserve);
    // A tier that runs `fewest` workers on fewer permits would run more than it holds.
    if (permits.length < fewest) for (const db of permits.splice(0)) db.close();
    const grant = permits.length;
    const since = this.#since;
    const slowWaiting = this.#slowWaiting;
    const previousLeast = this.#least;
    const pending = this.#pending;
    const mark = this.#mark;
    // One that holds nothing and gets nothing waits even at a share of 0, so it is served first later.
    this.#since = grant >= Math.max(entitled, inUse === 0 ? 1 : 0) ? null : (since ?? now);
    this.#slowWaiting = this.#since !== null && slow && (since === null || slowWaiting);
    this.#least = this.#since === null ? 1 : fewest;
    this.#pending = grant === 0 ? wanted : 0;
    const lease: Lease = { permits, want: wanted };
    if (grant > 0) this.#leases.add(lease);
    try {
      this.#publish(demand, inUse + grant);
    } catch (error) {
      // Nothing is held for a tier that never gets its lease.
      this.#leases.delete(lease);
      for (const db of permits.splice(0)) db.close();
      this.#since = since;
      this.#slowWaiting = slowWaiting;
      this.#least = previousLeast;
      this.#pending = pending;
      this.#mark = mark;
      throw error;
    }
    if (grant === 0) {
      // A look counts as a lease for the waiter's age: one that stops looking forgets it after 30 s.
      if (this.#leases.size === 0) this.#idleSince = now;
      return null;
    }
    this.#activate();
    return this.#handle(lease);
  }

  offer(want: number, lane: PoolLane = "fast"): number {
    if (this.#closed) return 0;
    const { others, inUse, target } = this.#share(Math.max(1, Math.floor(want)), lane, this.#now());
    return Math.min(target, this.#gated(others, inUse, target));
  }

  running(workers: number): () => void {
    if (this.#closed || this.#tree === null) return () => {};
    const edit = { workers: Math.max(1, Math.floor(workers)) };
    this.#edits.add(edit);
    this.#activate();
    try {
      // It may be the pool's first user (review 0.1.255, B2).
      this.#prepareDir();
      this.#republish();
    } catch {
      // A directory `acquire` refuses: the edit's tier runs on without a mark of its own.
    }
    return () => {
      if (!this.#edits.delete(edit) || this.#closed) return;
      if (this.#active()) this.#republish();
      else this.#deactivate();
    };
  }

  close(): void {
    this.#closed = true;
    for (const lease of this.#leases) for (const db of lease.permits.splice(0)) db.close();
    this.#leases.clear();
    this.#edits.clear();
    this.#deactivate();
  }

  /** Creates the pool's directory if it is missing; throws unless it is the user's alone. */
  #prepareDir(): void {
    preparePrivateDir(
      this.#options.dir,
      this.#options.uid ?? currentUid(),
      "capacity pool directory",
    );
  }

  /** What a tier of `wanted` workers, `least` at the fewest, is entitled to now, and what it may take. */
  #share(wanted: number, lane: PoolLane, now: number, least = 1) {
    const { dir, owner, project } = this.#options;
    const others = readMarks(dir, owner.worktreeId, now);
    const inUse = this.#inUse();
    const demand = this.#demand() + wanted;
    const me = {
      id: owner.worktreeId,
      want: demand,
      since: this.#since,
      ...(lane === "slow" ? { slow: true } : {}),
      ...(least > 1 ? { least } : {}),
      ...(project === undefined ? {} : { project }),
    };
    // An edit's mark, `want` 0, states CPU and no backlog demand (row 011-98).
    const shares = fairShares(this.#hostSlots, [me, ...others.filter((o) => o.want > 0)]);
    const entitled = Math.min(wanted, Math.max(0, (shares.get(me.id) ?? 0) - inUse));
    let target = entitled;
    if (project !== undefined) {
      // No preemption: what the project's other daemons hold now stays theirs.
      const theirs = others.filter((o) => o.project?.id === project.id);
      const held = theirs.reduce((sum, o) => sum + o.grant, 0);
      target = Math.min(target, Math.max(0, project.slots - held - inUse));
    }
    return { others, inUse, demand, shares, entitled, target };
  }

  /**
   * Up to `count` free permits, after leaving `reserve` for older waiters.
   * Takes up to both, so what is free is counted, then returns the excess.
   */
  #take(count: number, reserve: number): DatabaseSync[] {
    if (count === 0) return [];
    const { dir, owner } = this.#options;
    const held: DatabaseSync[] = [];
    try {
      for (let i = 0; i < this.#hostSlots && held.length < count + reserve; i++) {
        const db = takePermit(join(dir, poolPermitFile(i)), owner);
        if (db !== null) held.push(db);
      }
    } catch (error) {
      for (const db of held) db.close();
      throw error;
    }
    const keep = Math.min(count, Math.max(0, held.length - reserve));
    for (const db of held.splice(keep)) db.close();
    return held;
  }

  #handle(lease: Lease): PoolLease {
    const pool = this;
    return {
      get grant() {
        return grantOf(lease);
      },
      get permits() {
        return lease.permits.length;
      },
      shrinkTo(workers) {
        const wanted = Math.max(1, Math.floor(workers));
        const returned = lease.permits.splice(wanted);
        for (const db of returned) db.close();
        // A tier's tail calls this at each file's end (row 011-97): no change writes no mark.
        if (returned.length === 0 && lease.want === wanted) return;
        lease.want = wanted;
        pool.#republish();
      },
      release() {
        pool.#release(lease);
      },
    };
  }

  #release(lease: Lease): void {
    if (!this.#leases.delete(lease)) return;
    for (const db of lease.permits.splice(0)) db.close();
    if (this.#leases.size === 0) this.#idleSince = this.#now();
    if (this.#active()) this.#republish();
    else this.#deactivate();
  }

  #active(): boolean {
    return this.#leases.size > 0 || this.#edits.size > 0;
  }

  /** A tier starts: the mark is refreshed from now on, and if none ran, the tree's window begins. */
  #activate(): void {
    if (this.#timer !== null) return;
    this.#measured = null;
    this.#tree?.reset();
    this.#tree?.read();
    this.#startRefresh();
  }

  /** The last tier ended: no refresh and no mark until the next. */
  #deactivate(): void {
    this.#stopRefresh();
    this.#measured = null;
    this.#clear();
  }

  /** A waiter that has neither held a lease nor looked for 30 s is no longer one. True when one was. */
  #forget(now: number): boolean {
    if (this.#leases.size > 0 || this.#idleSince === null) return false;
    if (now - this.#idleSince < SLOT_WAITER_FRESH_MS) return false;
    const waited = this.#since !== null || this.#pending > 0;
    this.#since = null;
    this.#pending = 0;
    return waited;
  }

  /** The cores this daemon's tiers use: as measured, else one per worker; `null` without a tree. */
  #cores(): number | null {
    if (this.#tree === null) return null;
    let workers = this.#inUse();
    for (const edit of this.#edits) workers += edit.workers;
    return this.#measured ?? workers;
  }

  /** How many of `want` permits the CPU gate lets this daemon take now (row 011-98). */
  #gated(others: readonly PoolMark[], inUse: number, want: number): number {
    const cores = this.#cores();
    if (cores === null) return want;
    return gatedPermits(others, { cores, grant: inUse }, this.#hostSlots, want);
  }

  #inUse(): number {
    let sum = 0;
    for (const lease of this.#leases) sum += grantOf(lease);
    return sum;
  }

  /** What the held leases' tiers want, each at least what it holds. */
  #demand(): number {
    let sum = 0;
    for (const lease of this.#leases) sum += Math.max(lease.want, grantOf(lease));
    return sum;
  }

  #publish(want: number, grant: number): void {
    const { dir, owner, project } = this.#options;
    const cores = this.#cores();
    this.#mark = {
      id: owner.worktreeId,
      want,
      grant,
      since: this.#since,
      ...(this.#since !== null && this.#slowWaiting ? { slow: true } : {}),
      ...(this.#since !== null && this.#least > 1 ? { least: this.#least } : {}),
      ...(cores === null ? {} : { cores }),
      ...(project === undefined ? {} : { project }),
    };
    writeMark(dir, this.#mark);
  }

  /**
   * After a lease shrank or went, or an edit's tier started or ended: the
   * mark states what the tiers still held want and hold, and a waiter's
   * want. Never throws: a mark that cannot be written now is the refresh's
   * to write.
   */
  #republish(): void {
    this.#forget(this.#now());
    try {
      this.#publish(this.#demand() + this.#pending, this.#inUse());
    } catch {
      // `#mark` is set before the write, so the refresh writes this one.
    }
  }

  #clear(): void {
    this.#mark = null;
    try {
      clearMark(this.#options.dir, this.#options.owner.worktreeId);
    } catch {
      // The runtime directory went: there is nothing to clear.
    }
  }

  #startRefresh(): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      if (this.#mark === null) return;
      this.#measured = this.#tree?.read() ?? this.#measured;
      // A waiter whose edit runs on 30 s after its last look leaves the mark; its cores stay (B1).
      if (this.#forget(this.#now())) {
        this.#republish();
        return;
      }
      const cores = this.#cores();
      if (cores !== null) this.#mark = { ...this.#mark, cores };
      try {
        writeMark(this.#options.dir, this.#mark);
      } catch {
        // The next boundary writes it again; until then the mark may go stale.
      }
    }, this.#options.refreshMs ?? MARK_REFRESH_MS);
    this.#timer.unref();
  }

  #stopRefresh(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }
}

function grantOf(lease: Lease): number {
  return lease.permits.length;
}
