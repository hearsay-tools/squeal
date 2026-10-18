import { testFileId } from "../keys/index.js";
import {
  checkPrecondition,
  type PreconditionRule,
  preconditionFor,
  touchesPrecondition,
} from "../slow/index.js";
import { publishSlowSkips, readSlowSkips } from "../state/index.js";
import type { RelativePath, TestFileRef } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import { classify } from "./files.js";
import type { Ledger } from "./ledger.js";
import type { Mutex } from "./mutex.js";
import { priorityOf } from "./queue.js";

/** The files one unmet precondition skipped, and why. */
interface Skip {
  readonly rule: PreconditionRule;
  readonly reason: string;
  readonly since: number;
  readonly refs: ReadonlyMap<string, TestFileRef>;
}

/**
 * Spec 004 D7 and D8 as amended 2026-10-17 (task 004-65): the slow tier's
 * preconditions. A tier about to take the slot checks its files'
 * precondition first (`gate`); unmet, every queued slow file it covers
 * leaves the queue with no result stored, "not run at this revision", and
 * its checkpoint cannot complete, so a skip never reads as a pass, a failure
 * or a full suite. The skips are kept in the store (`publishSlowSkips`),
 * where every reader counts a skipped file as not run whatever result its
 * key stored (review wave-8.1 B1), and adopted from it by the next daemon.
 * A skipped file is queued again, to be checked, by a revision that makes
 * it eligible (`revised`), `run --slow` or `run --all` (`recheck`): one with
 * a stored result at its key forced, so it becomes current only through a
 * run or a met check. A met precondition is not checked again at the same
 * revision.
 */
export class SlowSkips {
  #skips: Map<string, Skip> | null = null;
  /** By rule source: the revision and rule a check was last met at. */
  readonly #met = new Map<string, string>();

  constructor(
    private readonly lock: Mutex,
    private readonly started: () => { context: SchedulerContext; ledger: Ledger },
  ) {}

  /**
   * Whether `refs`, a tier's candidates of one runner and so of one
   * precondition, may run: `"run"` with none declared or a met one,
   * `"skipped"` once every queued file it covers left the queue, `"again"`
   * when a revision or a policy edit superseded the check while it ran
   * (review wave-8.1 B2), `"closed"` when `signal` aborted it.
   */
  async gate(
    refs: readonly TestFileRef[],
    signal: AbortSignal,
  ): Promise<"run" | "skipped" | "again" | "closed"> {
    const [first] = refs;
    if (first === undefined) return "run";
    const due = await this.lock.run(() => {
      const { context, ledger } = this.started();
      const rule = preconditionFor(context.policy, first);
      if (rule === null) return null;
      const at = metKey(rule, ledger.revision.number);
      return this.#met.get(rule.source) === at ? null : { rule, at, root: context.root };
    });
    if (due === null) return "run";
    const reason = await checkPrecondition(due.root, due.rule, { signal });
    if (signal.aborted) return "closed";
    return this.lock.run(() => {
      const { context, ledger } = this.started();
      const rule = preconditionFor(context.policy, first);
      // Checked at another revision or rule than the live one: dropped, so the pump checks again.
      if (rule?.source !== due.rule.source || metKey(rule, ledger.revision.number) !== due.at) {
        return "again";
      }
      if (reason === null) {
        this.#lift(rule.source);
        // Once the lift committed: one rolled back is checked again (review wave-8.1, fourth round).
        this.#met.set(rule.source, due.at);
        return "run";
      }
      this.#met.delete(rule.source);
      this.#skip(rule, reason);
      return "skipped";
    });
  }

  /** Under the lock: every queued slow file `rule` covers leaves the queue, unrun. */
  #skip(rule: PreconditionRule, reason: string): void {
    const { context, ledger } = this.started();
    const covered = ledger
      .orderedSlow()
      .filter((ref) => preconditionFor(context.policy, ref)?.source === rule.source);
    // One transaction: no reader sees the skip beside checks still current (review wave-8.1, third round).
    this.#atomically(covered, () => {
      const skips = this.#adopted();
      const refs = new Map(skips.get(rule.source)?.refs);
      for (const ref of covered) {
        const file = ledger.file(ref);
        if (file === undefined) continue;
        ledger.dequeue(file);
        ledger.checkpoints.failed(ref);
        refs.set(testFileId(ref), ref);
      }
      // Published first: the commit's refresh reads the skips, so its checks leave current.
      skips.set(rule.source, { rule, reason, refs, since: context.now() });
      this.#publish();
      ledger.commit();
    });
  }

  /**
   * Under the lock, `source` met: its skip ends. A skipped file not queued
   * takes what its key has, a result stored before the skip included, or is
   * queued as any miss; its checks are classified again without the skip.
   */
  #lift(source: string): void {
    const skip = this.#adopted().get(source);
    if (skip === undefined) return;
    const { ledger } = this.started();
    this.#atomically(skip.refs.values(), () => {
      this.#adopted().delete(source);
      this.#publish();
      const idle = [...skip.refs.values()].filter((ref) => ledger.file(ref)?.phase === null);
      for (const ref of idle) {
        const file = ledger.file(ref);
        if (file !== undefined) ledger.touch(file);
      }
      ledger.settle(idle, new Set());
      ledger.commit();
    });
  }

  /**
   * Whether `ref` is one a precondition covers that has not been met: D5's
   * no-artifact note gives way to the skip for it.
   */
  unmet(context: SchedulerContext, ref: TestFileRef): boolean {
    const rule = preconditionFor(context.policy, ref);
    return rule !== null && !this.#met.has(rule.source);
  }

  /**
   * Under the lock, as a revision changing `paths` is applied: the skipped
   * files it makes eligible again are queued, so the slow tier checks their
   * precondition when it is next about to take the slot. A file is eligible
   * when the revision may change what its skip's rule reads, or when the
   * policy no longer declares that rule for it, decided per file so an
   * unchanged sibling keeps no other file skipped (review wave-8.1 B4).
   * Returns whether any was queued.
   */
  revised(paths: ReadonlySet<RelativePath>): boolean {
    const { context } = this.started();
    const next = new Map<string, Skip>();
    const eligible: TestFileRef[] = [];
    for (const [source, skip] of this.#adopted()) {
      const touched = touchesPrecondition(skip.rule, paths);
      const same = JSON.stringify(skip.rule);
      const kept = new Map<string, TestFileRef>();
      for (const [id, ref] of skip.refs) {
        const declared = JSON.stringify(preconditionFor(context.policy, ref)) === same;
        if (declared && !touched) kept.set(id, ref);
        else eligible.push(ref);
      }
      if (kept.size === skip.refs.size) next.set(source, skip);
      else if (kept.size > 0) next.set(source, { ...skip, refs: kept });
    }
    return this.#requeue(eligible, paths, next);
  }

  /**
   * Under the lock, `run --slow` or `run --all`: every skipped file is queued
   * again, so the tier checks its precondition. Returns whether any was.
   */
  recheck(): boolean {
    const refs = [...this.#adopted().values()].flatMap((skip) => [...skip.refs.values()]);
    return this.#requeue(refs, new Set(), new Map());
  }

  /**
   * Queues `refs` as any miss, `next` the skips left; one whose key has a
   * stored result goes in forced, so it runs rather than reading as current
   * unchecked. Published after the commit: its refresh still reads them
   * skipped, so a queued file's checks read pending, not current, until it
   * runs.
   */
  #requeue(
    refs: readonly TestFileRef[],
    changed: ReadonlySet<RelativePath>,
    next: Map<string, Skip>,
  ): boolean {
    if (refs.length === 0) {
      this.#skips = next;
      return false;
    }
    const { ledger } = this.started();
    this.#atomically(refs, () => {
      this.#skips = next;
      ledger.settle(refs, changed);
      for (const ref of refs) {
        const file = ledger.file(ref);
        if (file === undefined || classify(file) !== "current") continue;
        ledger.enqueue(file, priorityOf(file, changed), true);
      }
      ledger.commit();
      this.#publish();
    });
    return true;
  }

  /**
   * Runs `fn`, which changes the skips and the ledger's work on `refs`, in
   * one store transaction. When it does not commit, busy at BEGIN or rolled
   * back after the ledger's commit drained it, the skips and the ledger are
   * put back as the store still has them (review wave-8.1, fourth round), so
   * a retry or a shutdown settles from there: a skip kept, its checkpoint
   * still open.
   */
  #atomically(refs: Iterable<TestFileRef>, fn: () => void): void {
    const { context, ledger } = this.started();
    const skips = new Map(this.#adopted());
    const restore = ledger.hold(refs);
    try {
      context.store.transaction(fn);
    } catch (error) {
      this.#skips = skips;
      restore();
      throw error;
    }
  }

  /** The skips, the store's at first use: a skip outlives the daemon that found it. */
  #adopted(): Map<string, Skip> {
    if (this.#skips !== null) return this.#skips;
    const { context } = this.started();
    this.#skips = new Map(
      readSlowSkips(context.store, context.worktreeId).map((record) => [
        record.source,
        {
          rule: { precondition: record.precondition, source: record.source },
          reason: record.reason,
          since: record.since,
          refs: new Map(record.testFiles.map((ref) => [testFileId(ref), ref])),
        },
      ]),
    );
    return this.#skips;
  }

  #publish(): void {
    const { context } = this.started();
    const records = [...this.#adopted().values()].map(({ rule, reason, since, refs }) => ({
      precondition: rule.precondition,
      source: rule.source,
      reason,
      since,
      testFiles: [...refs.values()],
    }));
    publishSlowSkips(context.store, context.worktreeId, records);
  }
}

function metKey(rule: PreconditionRule, revision: number): string {
  return `${revision}\0${JSON.stringify(rule.precondition)}`;
}
