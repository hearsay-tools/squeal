import { setTimeout as delay } from "node:timers/promises";
import { POLICY_FILE } from "../daemon/policy.js";
import { readTurn } from "../delivery/turn.js";
import {
  acquireSlowSlot,
  clearSlotWaiter,
  inheritsAcrossWorktrees,
  markSlotWaiter,
  othersWaitingForSlot,
  SLOW_LOCK_FILE,
  type SlowSlot,
  slowSlotDir,
  waitForCapacity,
} from "../slow/index.js";
import {
  forgetSlowArtifacts,
  publishSlowActivity,
  readSlowActivity,
  recordSlowArtifacts,
} from "../slow/state.js";
import { slowPolicyView } from "../state/index.js";
import {
  type AbsolutePath,
  type CheckKey,
  CONSUMER_EXPIRY_MS,
  type EpochMs,
  type RelativePath,
  type SlowTierActivity,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../types/index.js";
import { claimOf } from "./claims.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { classify } from "./files.js";
import type { Ledger } from "./ledger.js";
import type { Mutex } from "./mutex.js";
import { listPaths, persistedNoteTexts } from "./notes.js";
import type { SlowTierOptions } from "./options.js";
import { slowView } from "./slow.js";
import { laneOf, startTier, type Tier, type TierFile } from "./tiers.js";

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
  /**
   * An edit's fast work is pending or running: runner work, a recent fast
   * file queued, or an edit's tier in flight. It goes first (D2 as amended
   * 2026-10-09); background fast work does not hold the slow tier back.
   */
  editPending(): boolean;
  /** No fast work at all is pending or running: an idle slow tier may take several files (D2). */
  fastIdle(): boolean;
}

/**
 * A slow tier, selected, with the slot permits it holds until it is recorded
 * (one per file) and, by test file id, the artifact globs each file was
 * declared to test when it was selected (D5; review wave 4, B1).
 */
export interface SlowRun {
  readonly tier: Tier;
  readonly slot: SlowSlot;
  readonly artifacts: ReadonlyMap<string, readonly string[]>;
}

/** `next`: a slow run, `"again"` when the pump should plan again, `null` when nothing slow starts now. */
export type SlowNext = SlowRun | "again" | null;

/**
 * Spec 004 D2 to D5: the slow tier of one worktree. Slow files wait in the
 * queue's slow class until no edit's fast work is pending or running (D2 as
 * amended 2026-10-09: background fast work runs beside them) and a trigger
 * holds: every registered consumer is idle or none is (`consumersIdle`), a
 * `run --slow` request is open (`request`), or a `run --all` checkpoint
 * requested the file. Then `next` waits for the load guard with what is left
 * of the pass's `slow.maxDeferMs`, takes the per-user slot, and selects a
 * tier: one file, or up to `slow.maxParallel` files of one lane when the
 * machine is idle (no fast work at all and the load below the guard's
 * threshold), holding a permit per file. The pump runs and records it as any
 * tier (D4: the stability check discards and re-queues). A pass ends when no
 * slow file is pending. Waiting for a trigger or the slot arms a timer that
 * pumps again.
 */
export class SlowTier {
  /** A `run --slow` request is open until no slow file is pending. */
  #requested = false;
  /** What is left of `slow.maxDeferMs` for the pass; `null` between passes. */
  #budgetMs: number | null = null;
  #slotMissedSince: EpochMs | null = null;
  /** This worktree's waiter's mark is in the slot's directory. */
  #marked = false;
  /** The last pass took the slot: its next skips one turn for another worktree's mark. */
  #tookLast = false;
  #slotNoted = false;
  #timer: NodeJS.Timeout | null = null;
  /** The load guard's wait in progress; `preempt` aborts it. */
  #wait: AbortController | null = null;
  /** Counts `preempt` calls, so one between selection and the wait is not lost. */
  #preemptions = 0;
  /** No-artifact notes written or found persisted (D5). */
  #noted: Set<string> | null = null;
  /** What this tier last published, as stored, so `close` clears only its own. */
  #published: string | null = null;

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

  /**
   * Called by the pump when no fast tier is left to select. The load guard
   * waits before the slot is taken, so a wait never holds it, and the slot is
   * handed over between files (D2, lessons defect 2): a worktree that misses
   * it leaves a waiter's mark, and one that finds another's mark skips one turn.
   */
  async next(): Promise<SlowNext> {
    const preemptions = this.#preemptions;
    const refs = await this.host.lock.run(() => this.#candidates());
    const { context } = this.host.started();
    const dir = this.options.slotDir ?? slowSlotDir();
    if (refs.length === 0) {
      this.#unmark(dir, context.worktreeId);
      return null;
    }
    if (preemptions !== this.#preemptions) return "again";
    const load = await this.#waitForCapacity(context);
    if (load === "preempted" || preemptions !== this.#preemptions) return "again";
    const { maxParallel } = context.policy.slow;
    const want = load === null && this.host.fastIdle() ? Math.min(maxParallel, refs.length) : 1;
    const yieldTurn = this.#tookLast && othersWaitingForSlot(dir, context.worktreeId);
    const owner = { pid: process.pid, worktreeId: context.worktreeId };
    const slot = yieldTurn ? null : acquireSlowSlot({ dir, owner, permits: maxParallel, want });
    if (slot === null) {
      this.#tookLast = false;
      markSlotWaiter(dir, context.worktreeId);
      this.#marked = true;
      this.#publish({ kind: "waiting", for: "slot" });
      if (!yieldTurn) this.#slotMissed(context, dir);
      this.#arm();
      return null;
    }
    this.#tookLast = true;
    this.#unmark(dir, context.worktreeId);
    this.#slotMissedSince = null;
    this.#slotNoted = false;
    let run: SlowRun | null = null;
    try {
      const selected = await this.host.lock.run(() => this.#select(refs, load, slot));
      // Every file another worktree runs: the pump waits on the claims, not the slot (task 001-205).
      if (selected === "claimed") return null;
      if (selected === null) return "again";
      run = { ...selected, slot };
      return run;
    } finally {
      if (run === null) slot.release();
    }
  }

  #unmark(dir: AbsolutePath, worktreeId: WorktreeId): void {
    if (!this.#marked) return;
    this.#marked = false;
    clearSlotWaiter(dir, worktreeId);
  }

  /**
   * Under the lock: the slow files a trigger lets run now, in order, all of
   * the first one's lane and runner (`runnerOf`); none when none may. A file
   * whose key another worktree runs is none (`claimOf`, task 001-205): the
   * pump waits on the claim without taking the slot, and a result that
   * landed is applied here, so a drain before exit (004-29) ends with it.
   */
  #candidates(): TestFileRef[] {
    const { context, ledger } = this.host.started();
    this.#noteMissingArtifacts(context, ledger);
    const queued = ledger.orderedSlow();
    if (queued.length === 0) {
      this.#requested = false;
      this.#budgetMs = null;
      this.#publish(null);
      return [];
    }
    if (this.host.editPending()) {
      this.#publish({ kind: "waiting", for: "fast" });
      return [];
    }
    const triggered = queued.filter(this.#trigger(context, ledger));
    const claims = new Map(triggered.map((ref) => [ref, claimOf(ledger, ref)]));
    const free = triggered.filter((ref) => claims.get(ref) === "free");
    const first = free[0];
    if (first !== undefined) {
      const runner = runnerOf(context, first);
      return free.filter((ref) => runnerOf(context, ref) === runner);
    }
    // A result applied left the queue: what is left decides.
    if ([...claims.values()].includes("settled")) return this.#candidates();
    if ([...claims.values()].includes("waits")) return [];
    this.#publish({ kind: "waiting", for: "idle" });
    this.#arm();
    return [];
  }

  /**
   * Under the lock: whether a trigger lets a slow file run now. Idle or absent
   * consumers, an open `run --slow` request, or the file's open `run --all`
   * checkpoint.
   */
  #trigger(context: SchedulerContext, ledger: Ledger): (ref: TestFileRef) => boolean {
    const idle = consumersIdle(context.store, context.worktreeId, context.now());
    const runAll = ledger.checkpoints.active?.record.kind === "run-all";
    return (ref) => idle || this.#requested || (runAll && ledger.checkpoints.idFor(ref) !== null);
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
        sleep: (ms) => {
          this.#publish({ kind: "waiting", for: "load" });
          return delay(ms, undefined, { signal: wait.signal });
        },
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
   * Under the lock, after the guard and the slot: the tier, of `refs` in
   * order, as many as `slot` has permits while the machine is still idle,
   * else one; the permits it does not use go. Nothing when an edit's fast
   * work arrived meanwhile. A file is passed over when it left the queue or
   * class, its trigger is gone (a consumer entered a turn during the wait;
   * the file stays queued and the pass keeps its budget), or the store now
   * holds a result that may stand for it (`Ledger.lookup`). `"claimed"` when
   * no file runs because other worktrees run their keys (task 001-205).
   */
  #select(
    refs: readonly TestFileRef[],
    ranUnderLoad: number | null,
    slot: SlowSlot,
  ): { tier: Tier; artifacts: ReadonlyMap<string, readonly string[]> } | "claimed" | null {
    const { context, ledger } = this.host.started();
    if (this.host.editPending()) return null;
    const width = this.host.fastIdle() ? slot.permits : 1;
    const triggered = this.#trigger(context, ledger);
    const picked: TierFile[] = [];
    for (const ref of refs) {
      if (picked.length >= width) break;
      if (!ledger.queue.has(ref) || !ledger.queue.isSlow(ref) || !triggered(ref)) continue;
      const tierFile = this.#pick(ref, context, ledger);
      if (tierFile !== null) picked.push(tierFile);
    }
    if (picked.length === 0) return ledger.claims.waiting ? "claimed" : null;
    slot.shrinkTo(picked.length);
    for (const { file } of picked) {
      if (ranUnderLoad === null) continue;
      context.note(
        `slow file ${file.ref.path} ran under load ${ranUnderLoad.toFixed(2)} per CPU, above ` +
          `slow.maxLoadPerCpu ${context.policy.slow.maxLoadPerCpu}, once the load guard had ` +
          `waited slow.maxDeferMs for this slow pass (spec 004 D3)`,
      );
    }
    const since = context.now();
    const view = slowPolicyView(context.policy);
    const artifacts = new Map(
      picked.map(({ file }) => [file.id, view?.artifactFor(file.ref.path) ?? []] as const),
    );
    // The activity names the files in the transaction that marks them running (review wave 2, B1; 004-35).
    const started = context.store.transaction(() => {
      const tier = startTier(context, ledger, picked, false);
      const first = tier?.files[0];
      if (tier === null || first === undefined) return null;
      const lastDurationMs = longest(tier.files.map(({ file }) => file.durationMs));
      const paths = tier.files.map(({ file }) => file.ref.path);
      this.#publish({
        kind: "running",
        path: first.file.ref.path,
        ...(paths.length > 1 ? { paths } : {}),
        since,
        lastDurationMs,
      });
      return { tier, artifacts };
    });
    return started ?? "claimed";
  }

  /**
   * Under the lock: `ref` as a file of the tier, or `null` when it has no key
   * or is blocked (it leaves the queue), when another worktree's result
   * stands for it (applied), or when another worktree runs its key and its
   * result could stand for it (it stays queued, task 001-205).
   */
  #pick(ref: TestFileRef, context: SchedulerContext, ledger: Ledger): TierFile | null {
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
    const { hits, mayWait } = forced ? { hits: [], mayWait: false } : ledger.probe(file, key);
    if (hits.length > 0) {
      ledger.applyResults(file, key, hits, checkpointId);
      ledger.commit();
      return null;
    }
    const waits = mayWait && !ledger.queue.isRecent(ref);
    if (waits && ledger.claims.holds(key)) return null;
    const inputs = context.keys.stabilityPaths(ref);
    return { file, key, inputs, checkpointId, forced, waits };
  }

  /**
   * Under the lock, in the transaction that records `run` (D5, D8, review
   * wave 2 B1 and B2): the keys each file ran under were declared to test
   * that file's artifact (review wave 4, B1), and its activity goes with it
   * (`ended`).
   */
  recorded(run: SlowRun, ledger: Ledger): void {
    const { context } = this.host.started();
    const runs = new Map<CheckKey, readonly string[]>();
    for (const tierFile of run.tier.files) {
      const artifact = run.artifacts.get(tierFile.file.id) ?? [];
      for (const key of fileKeys(tierFile, ledger)) runs.set(key, artifact);
    }
    recordSlowArtifacts(context.store, context.worktreeId, runs);
    this.ended();
  }

  /**
   * Under the lock, as a slow run ends, recorded, discarded or put back: its
   * "running" activity goes in favour of what the remaining slow files wait
   * for, without starting one (review wave 2, B1). An edit's fast work in
   * flight or pending, or the agent not pausing; when a trigger already
   * holds, nothing until `next` decides.
   */
  ended(): void {
    const { context, ledger } = this.host.started();
    const queued = ledger.orderedSlow();
    if (queued.length === 0) this.#publish(null);
    else if (this.host.editPending()) this.#publish({ kind: "waiting", for: "fast" });
    else if (queued.some(this.#trigger(context, ledger))) this.#publish(null);
    else this.#publish({ kind: "waiting", for: "idle" });
  }

  /** At close: clears the activity unless another daemon published since (a handover), and the waiter's mark. */
  retire(): void {
    const { context } = this.host.started();
    this.#unmark(this.options.slotDir ?? slowSlotDir(), context.worktreeId);
    const now = readSlowActivity(context.store, context.worktreeId);
    if (now !== null && JSON.stringify(now) === this.#published) this.#publish(null);
  }

  /** Spec 004 D8: what headers and status say the slow tier is doing (`src/core/slow/state.ts`). */
  #publish(activity: SlowTierActivity | null): null {
    const { context } = this.host.started();
    publishSlowActivity(context.store, context.worktreeId, activity);
    this.#published = activity === null ? null : JSON.stringify(activity);
    return null;
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

/**
 * What runs `ref`: its lane, since a tier runs in one, and for a node:test
 * project the project, as each is a runner of its own that the composite
 * runs after the previous one (spec 003 D7). A slow tier starts all its files
 * at once, so none starts after an edit or a close (review wave 4, B2).
 */
function runnerOf(context: SchedulerContext, ref: TestFileRef): string {
  const lane = laneOf(context, ref);
  const nodeTest = context.policy.nodeTest.some((project) => project.name === ref.project);
  return nodeTest ? `${lane}\0${ref.project}` : lane;
}

/** The longest of the files' last known run times, `null` when none is known: a tier lasts its longest file. */
function longest(durations: readonly (number | null)[]): number | null {
  const known = durations.filter((ms): ms is number => ms !== null);
  return known.length === 0 ? null : Math.max(...known);
}

/**
 * The keys `tier`'s results may be stored under: each file's run key and,
 * after recording, its current key (a run whose observed growth re-keyed the
 * file stores under that).
 */
export function tierKeys(tier: Tier, ledger: Ledger): CheckKey[] {
  return [...new Set(tier.files.flatMap((tierFile) => fileKeys(tierFile, ledger)))];
}

/** `tierKeys` of one file of a tier. */
function fileKeys({ file, key }: TierFile, ledger: Ledger): CheckKey[] {
  const current = ledger.files.get(file.id)?.key ?? null;
  return current === null || current === key ? [key] : [key, current];
}

/** A fast run of `tier`: the records of its keys' slow runs go (D8, review wave 2 B2). */
export function forgetSlowRuns(context: SchedulerContext, ledger: Ledger, tier: Tier): void {
  forgetSlowArtifacts(context.store, context.worktreeId, tierKeys(tier, ledger));
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
