import { testFileId } from "../keys/index.js";
import {
  checkPrecondition,
  type PreconditionRule,
  preconditionFor,
  touchesPrecondition,
} from "../slow/index.js";
import type { RelativePath, SlowTierActivity, TestFileRef } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import type { Mutex } from "./mutex.js";

/** The files one unmet precondition skipped, and why. */
interface Skip {
  readonly rule: PreconditionRule;
  readonly reason: string;
  readonly refs: ReadonlyMap<string, TestFileRef>;
}

/**
 * Spec 004 D7 and D8 as amended 2026-10-17 (task 004-65): the slow tier's
 * preconditions. A tier about to take the slot checks its files'
 * precondition first (`gate`); unmet, every queued slow file it covers
 * leaves the queue with no result stored, "not run at this revision", and
 * its checkpoint cannot complete, so a skip never reads as a pass, a failure
 * or a full suite. The skip is the tier's published activity (`activity`)
 * until a revision makes the files eligible again (`revised`): every
 * revision for a command, one touching a path an `exists` glob selects
 * otherwise; `run --slow` and `run --all` queue them as any file not current.
 * A met precondition is not checked again at the same revision.
 */
export class SlowSkips {
  readonly #skips = new Map<string, Skip & { readonly since: number }>();
  /** By rule source: the revision and rule a check was last met at. */
  readonly #met = new Map<string, string>();

  constructor(
    private readonly lock: Mutex,
    private readonly started: () => { context: SchedulerContext; ledger: Ledger },
  ) {}

  /**
   * Whether `refs`, a tier's candidates of one runner and so of one
   * precondition, may run: `"run"` with none declared or a met one,
   * `"skipped"` once every queued file it covers left the queue, `"closed"`
   * when `signal` aborted the check.
   */
  async gate(
    refs: readonly TestFileRef[],
    signal: AbortSignal,
  ): Promise<"run" | "skipped" | "closed"> {
    const { context, ledger } = this.started();
    const first = refs[0];
    const rule = first === undefined ? null : preconditionFor(context.policy, first);
    if (rule === null) return "run";
    const at = metKey(rule, ledger.revision.number);
    if (this.#met.get(rule.source) === at) return "run";
    const reason = await checkPrecondition(context.root, rule, { signal });
    if (signal.aborted) return "closed";
    if (reason === null) {
      this.#met.set(rule.source, at);
      this.#skips.delete(rule.source);
      return "run";
    }
    this.#met.delete(rule.source);
    await this.lock.run(() => this.#skip(rule, reason));
    return "skipped";
  }

  /** Under the lock: every queued slow file `rule` covers leaves the queue, unrun. */
  #skip(rule: PreconditionRule, reason: string): void {
    const { context, ledger } = this.started();
    const refs = new Map(this.#skips.get(rule.source)?.refs);
    for (const ref of ledger.orderedSlow()) {
      if (preconditionFor(context.policy, ref)?.source !== rule.source) continue;
      const file = ledger.file(ref);
      if (file === undefined) continue;
      ledger.dequeue(file);
      ledger.checkpoints.failed(ref);
      refs.set(testFileId(ref), ref);
    }
    ledger.commit();
    this.#skips.set(rule.source, { rule, reason, refs, since: context.now() });
  }

  /**
   * Whether `ref` is one a precondition covers that has not been met: D5's
   * no-artifact note gives way to the skip for it.
   */
  unmet(context: SchedulerContext, ref: TestFileRef): boolean {
    const rule = preconditionFor(context.policy, ref);
    return rule !== null && !this.#met.has(rule.source);
  }

  /** The skip as the slow tier publishes it, every reason in one; `null` with none. */
  activity(): SlowTierActivity | null {
    const skips = [...this.#skips.values()];
    const [first] = skips;
    if (first === undefined) return null;
    const reason = skips.map((skip) => skip.reason).join("; ");
    return { kind: "skipped", reason, since: first.since };
  }

  /**
   * Under the lock, as a revision changing `paths` is applied: the skipped
   * files it makes eligible again are queued, as any miss is, so the slow
   * tier checks their precondition when it is next about to take the slot.
   * A skip whose rule the policy no longer declares goes with it. Returns
   * whether any was queued.
   */
  revised(paths: ReadonlySet<RelativePath>): boolean {
    const { context, ledger } = this.started();
    const eligible: TestFileRef[] = [];
    for (const [source, skip] of this.#skips) {
      const declared = [...skip.refs.values()].some(
        (ref) => preconditionFor(context.policy, ref)?.source === source,
      );
      if (declared && !touchesPrecondition(skip.rule, paths)) continue;
      this.#skips.delete(source);
      eligible.push(...skip.refs.values());
    }
    if (eligible.length === 0) return false;
    ledger.settle(eligible, paths);
    ledger.commit();
    return true;
  }
}

function metKey(rule: PreconditionRule, revision: number): string {
  return `${revision}\0${JSON.stringify(rule.precondition)}`;
}
