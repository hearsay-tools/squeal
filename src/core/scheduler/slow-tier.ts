import { setTimeout as delay } from "node:timers/promises";
import { currentUid, userTmpDir } from "../daemon/paths.js";
import { POLICY_FILE } from "../daemon/policy.js";
import { readTurn } from "../delivery/turn.js";
import {
  acquireSlowSlot,
  inheritsAcrossWorktrees,
  SLOW_LOCK_FILE,
  type SlowSlot,
  waitForCapacity,
} from "../slow/index.js";
import {
  CONSUMER_EXPIRY_MS,
  type EpochMs,
  type RelativePath,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../types/index.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { classify } from "./files.js";
import type { Ledger } from "./ledger.js";
import type { Mutex } from "./mutex.js";
import { listPaths, persistedNoteTexts } from "./notes.js";
import type { SlowTierOptions } from "./options.js";
import { slowView } from "./slow.js";
import { startTier, type Tier } from "./tiers.js";

/** Spec 004 D2, D3: the longest a pending slow file waits before the scheduler looks again. */
export const SLOW_RECHECK_MS = 15_000;

/** After this long without the slot, a note says another daemon holds it. */
export const SLOT_HELD_NOTE_MS = 60_000;

/** What the slow tier needs from its scheduler. */
export interface SlowHost {
  readonly lock: Mutex;
  started(): { context: SchedulerContext; ledger: Ledger };
  closed(): boolean;
  pump(): void;
  /** Runner work, or a fast file, is pending: it goes first (D2). */
  fastPending(): boolean;
}

/** A one-file slow tier, selected, with the slot it holds until it is recorded. */
export interface SlowRun {
  readonly tier: Tier;
  readonly slot: SlowSlot;
}

/** `next`: a slow run, `"again"` when the pump should plan again, `null` when nothing slow starts now. */
export type SlowNext = SlowRun | "again" | null;

/**
 * Spec 004 D2 to D5: the slow tier of one worktree. Slow files wait in the
 * queue's slow class until no fast file is pending and a trigger holds: every
 * registered consumer is idle or none is (`consumersIdle`), a `run --slow`
 * request is open (`request`), or a `run --all` checkpoint requested the file.
 * Then, one file at a time, `next` takes the per-user slot, waits for the
 * load guard with what is left of the pass's `slow.maxDeferMs`, and selects a
 * one-file tier, which the pump runs and records as any tier (D4: the
 * stability check discards and re-queues). A pass ends when no slow file is
 * pending. Waiting for a trigger or the slot arms a timer that pumps again.
 */
export class SlowTier {
  /** A `run --slow` request is open until no slow file is pending. */
  #requested = false;
  /** What is left of `slow.maxDeferMs` for the pass; `null` between passes. */
  #budgetMs: number | null = null;
  #slotMissedSince: EpochMs | null = null;
  #slotNoted = false;
  #timer: NodeJS.Timeout | null = null;
  /** The load guard's wait in progress; `preempt` aborts it. */
  #wait: AbortController | null = null;
  /** Counts `preempt` calls, so one between selection and the wait is not lost. */
  #preemptions = 0;
  /** No-artifact notes written or found persisted (D5). */
  #noted: Set<string> | null = null;

  constructor(
    private readonly host: SlowHost,
    private readonly options: SlowTierOptions = {},
  ) {}

  /** `run --slow`: the pending slow files run behind fast work, whatever the turns (trigger b). */
  request(): void {
    this.#requested = true;
  }

  /** Fast work may be coming (a revision, `run --all`): a load guard wait gives way to it. */
  preempt(): void {
    this.#preemptions += 1;
    this.#wait?.abort();
  }

  close(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.preempt();
  }

  /** Called by the pump when no fast tier is left to select. */
  async next(): Promise<SlowNext> {
    const preemptions = this.#preemptions;
    const ref = await this.host.lock.run(() => this.#candidate());
    if (ref === null) return null;
    const { context } = this.host.started();
    const dir = this.options.slotDir ?? userTmpDir(currentUid());
    const slot = acquireSlowSlot({
      dir,
      owner: { pid: process.pid, worktreeId: context.worktreeId },
    });
    if (slot === null) {
      this.#slotMissed(context, dir);
      this.#arm();
      return null;
    }
    this.#slotMissedSince = null;
    this.#slotNoted = false;
    let run: SlowRun | null = null;
    try {
      if (preemptions !== this.#preemptions) return "again";
      const load = await this.#waitForCapacity(context);
      if (load === "preempted") return "again";
      const tier = await this.host.lock.run(() => this.#select(ref, load));
      if (tier === null) return "again";
      run = { tier, slot };
      return run;
    } finally {
      if (run === null) slot.release();
    }
  }

  /** Under the lock: the first slow file a trigger lets run now, or `null`. */
  #candidate(): TestFileRef | null {
    const { context, ledger } = this.host.started();
    this.#noteMissingArtifacts(context, ledger);
    const queued = ledger.orderedSlow();
    if (queued.length === 0) {
      this.#requested = false;
      this.#budgetMs = null;
      return null;
    }
    if (this.host.fastPending()) return null;
    const idle = consumersIdle(context.store, context.worktreeId, context.now());
    const runAll = ledger.checkpoints.active?.record.kind === "run-all";
    const ref = queued.find(
      (r) => idle || this.#requested || (runAll && ledger.checkpoints.idFor(r) !== null),
    );
    if (ref !== undefined) return ref;
    this.#arm();
    return null;
  }

  /** The load guard (D3) with the pass's remaining budget; the load it runs under at the bound. */
  async #waitForCapacity(context: SchedulerContext): Promise<number | null | "preempted"> {
    const { slow } = context.policy;
    const budget = this.#budgetMs ?? slow.maxDeferMs;
    const wait = new AbortController();
    this.#wait = wait;
    const started = performance.now();
    try {
      const waited = await waitForCapacity({
        maxLoadPerCpu: slow.maxLoadPerCpu,
        maxDeferMs: budget,
        recheckMs: this.#recheckMs(),
        sleep: (ms) => delay(ms, undefined, { signal: wait.signal }),
        ...(this.options.load === undefined ? {} : { load: this.options.load }),
        ...(this.options.cpus === undefined ? {} : { cpus: this.options.cpus }),
      });
      return waited.ranUnderLoad;
    } catch (error) {
      if (wait.signal.aborted) return "preempted";
      throw error;
    } finally {
      this.#wait = null;
      this.#budgetMs = Math.max(0, budget - (performance.now() - started));
    }
  }

  /**
   * Under the lock, after the slot and the guard: the one-file tier, unless
   * fast work arrived meanwhile, the file left the queue or class, or the
   * store now holds a result that may stand for it (`Ledger.lookup`).
   */
  #select(ref: TestFileRef, ranUnderLoad: number | null): Tier | null {
    const { context, ledger } = this.host.started();
    if (this.host.fastPending() || !ledger.queue.has(ref) || !ledger.queue.isSlow(ref)) return null;
    const file = ledger.file(ref);
    const key = file?.key ?? null;
    const checkpointId = ledger.checkpoints.idFor(ref);
    const forced = ledger.queue.isForced(ref);
    if (!file || key === null || file.blocked !== null) {
      ledger.queue.remove(ref);
      if (file) ledger.touch(file);
      ledger.commit();
      return null;
    }
    const hits = forced ? [] : ledger.lookup(file, key);
    if (hits.length > 0) {
      ledger.applyResults(file, key, hits, checkpointId);
      ledger.commit();
      return null;
    }
    ledger.queue.remove(ref);
    if (ranUnderLoad !== null) {
      context.note(
        `slow file ${ref.path} ran under load ${ranUnderLoad.toFixed(2)} per CPU, above ` +
          `slow.maxLoadPerCpu ${context.policy.slow.maxLoadPerCpu}, once the load guard had ` +
          `waited slow.maxDeferMs for this slow pass (spec 004 D3)`,
      );
    }
    const inputs = context.keys.stabilityPaths(ref);
    return startTier(context, ledger, [{ file, key, inputs, checkpointId, forced }], false);
  }

  #slotMissed(context: SchedulerContext, dir: string): void {
    const now = context.now();
    this.#slotMissedSince ??= now;
    if (this.#slotNoted || now - this.#slotMissedSince < SLOT_HELD_NOTE_MS) return;
    this.#slotNoted = true;
    context.note(
      `the slow slot ${dir}/${SLOW_LOCK_FILE} has been held by another daemon of this user for ` +
        "over a minute; this worktree's slow files wait for it (spec 004 D2)",
    );
  }

  /** Pumps again after `recheckMs`, once; the pump re-arms while slow work still waits. */
  #arm(): void {
    if (this.#timer !== null || this.host.closed()) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.host.pump();
    }, this.#recheckMs());
    this.#timer.unref();
  }

  #recheckMs(): number {
    return Math.min(this.options.recheckMs ?? SLOW_RECHECK_MS, SLOW_RECHECK_MS);
  }

  /** D5: one note per project naming its slow files whose declared inputs hold no artifact. */
  #noteMissingArtifacts(context: SchedulerContext, ledger: Ledger): void {
    const view = slowView(context.policy);
    if (!view.declared) return;
    const files = [...ledger.files.values()];
    const testFiles = new Set(files.map((file) => file.ref.path));
    const byProject = new Map<string, RelativePath[]>();
    for (const { ref } of files) {
      if (!view.isSlow(ref)) continue;
      const declared = context.keys.declaredFor(ref.path);
      const subject = { path: ref.path, slow: true };
      if (inheritsAcrossWorktrees(subject, declared, testFiles, view.globs)) continue;
      const paths = byProject.get(ref.project) ?? [];
      paths.push(ref.path);
      byProject.set(ref.project, paths);
    }
    if (byProject.size === 0) return;
    this.#noted ??= persistedNoteTexts(context.store, context.worktreeId);
    for (const [project, paths] of [...byProject].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const text = noArtifactNote(project, paths.sort());
      if (this.#noted.has(text)) continue;
      this.#noted.add(text);
      context.note(text);
    }
  }
}

/** The D5 note for `project`'s slow `paths`. */
export function noArtifactNote(project: string, paths: readonly RelativePath[]): string {
  const owner = project === "" ? "" : ` of project ${project}`;
  return (
    `slow files${owner} with no declared artifact: ${listPaths(paths)}. Their key holds no ` +
    "build output, so a change to the code they test does not re-run them and another " +
    `worktree's result never stands for them; declare what they test in ${POLICY_FILE} ` +
    '"inputs" (spec 004 D5, D6)'
  );
}

/**
 * Spec 004 D2 trigger (a): no registered consumer of the worktree is in a
 * turn (001 D9). A consumer not heard from or delivered to within
 * `CONSUMER_EXPIRY_MS` counts as absent, as its expiry would remove it.
 */
export function consumersIdle(store: Store, worktreeId: WorktreeId, now: EpochMs): boolean {
  for (const record of store.consumers.list(worktreeId)) {
    const heard = Math.max(record.lastSeenAt, record.lastDeliveredAt ?? 0);
    if (heard < now - CONSUMER_EXPIRY_MS) continue;
    if (readTurn(store, record.consumer).turn === "in-turn") return false;
  }
  return true;
}

/**
 * Spec 004 D2 `run --slow`: every slow file that is not current is queued,
 * as `run --all` queues every file (`queueFullSuite`), under no checkpoint.
 * Returns how many slow files are queued or running for it.
 */
export function queueSlowSuite(context: SchedulerContext, ledger: Ledger): number {
  const { isSlow } = slowView(context.policy);
  const open = [...ledger.files.values()].filter(
    (file) =>
      isSlow(file.ref) &&
      file.key !== null &&
      file.blocked === null &&
      classify(file) !== "current",
  );
  for (const file of open) file.unknownKey = null;
  const pending = open.filter((file) => file.phase !== null);
  const misses = ledger.settle(
    open.filter((file) => file.phase === null).map((file) => file.ref),
    NOTHING_CHANGED,
  );
  ledger.commit();
  return pending.length + misses.length;
}
