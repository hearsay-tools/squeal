import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { COMMAND_HOLD_MAX_MS, processIdentity } from "../../src/core/scheduler/command-hold.js";
import {
  addCommandHold,
  type CommandHoldEntry,
  removeCommandHold,
} from "../../src/core/scheduler/hold-rows.js";
import { promotionsMetaKey } from "../../src/core/scheduler/promotions.js";
import { yieldsMetaKey } from "../../src/core/scheduler/yields.js";
import {
  DEFAULT_POLICY,
  isSlowLane,
  notesMetaKey,
  type RunOptions,
  type RunReport,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { ModelClock, realSetTimeout, realSleep, watchWork } from "./model-clock.js";

/*
 * Row 011-195 (016-18, `research/model-scheduler.md`): a seeded model of
 * the scheduler of spec 011 C4 and C15. Seven events drive the real
 * scheduler and store of `catchUpSide`; a fake runner holds each run until
 * an event ends a file or the run, and the scheduler's clock stands still
 * until an event moves it. The invariants are the test's. Row 011-221: a
 * plan with `slowLane` adds slow files of spec 004 D1 in their own lane and
 * command holds (011 C9).
 */

export type Ev =
  | { e: "edit"; path: string }
  | { e: "promote"; files: string[]; ms: number }
  | { e: "end"; slot: number; file: number }
  | { e: "finish"; slot: number; crash: boolean }
  | { e: "step"; ms: number }
  | { e: "cross"; reads: number; ms: number }
  | { e: "runAll"; force: boolean }
  /** A command hold begins, bounded by `ms`, as `squeal hold --max` writes it. */
  | { e: "hold"; ms: number }
  /** Every hold the model began ends, as its command's exit does. */
  | { e: "unhold" };

export const SLOWS = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
export const P = "f/p.test.ts";
export const Q = "test/q.test.ts";
export const ALL = [...SLOWS, P, Q];
/** Row 011-221: the slow lane's files of a plan with `slowLane`, through `src/x.ts`. */
export const E2E = ["e2e/x1.test.ts", "e2e/x2.test.ts"];

export interface Plan {
  readonly seed: number;
  /** `vitest` cancels and reports each file's end; `node` does neither, runs its backlog in slots and may crash. */
  readonly kind: "vitest" | "node";
  /** The last-known duration of each slow file. */
  readonly slowMs: number;
  /** Row 011-221: `E2E` in the slow lane, beside the files of `ALL`. */
  readonly slowLane?: boolean;
  readonly events: readonly Ev[];
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

/** The probe's sequences: seed n here is its seed n under `KIND=mixed`, or `kind`'s. */
export function plan(seed: number, len = 12, kind?: Plan["kind"]): Plan {
  const r = rng(seed);
  const k = kind ?? (r() < 0.7 ? "vitest" : "node");
  const slowMs = pick(r, [20_000, 35_000, 200_000]);
  const events: Ev[] = [];
  while (events.length < len) {
    const x = r();
    if (x < 0.08) events.push({ e: "edit", path: pick(r, ["src/s.ts", "src/p.ts", "src/q.ts"]) });
    else if (x < 0.33) {
      const files = new Set<string>();
      for (const n = r() < 0.6 ? 1 : 2; files.size < n; ) files.add(pick(r, ALL));
      events.push({
        e: "promote",
        files: [...files],
        ms: pick(r, [3_000, 30_000, 60_000, 120_000]),
      });
    } else if (x < 0.5)
      events.push({ e: "end", slot: Math.floor(r() * 4), file: Math.floor(r() * 6) });
    else if (x < 0.58) events.push({ e: "finish", slot: Math.floor(r() * 4), crash: r() < 0.4 });
    else if (x < 0.85)
      events.push({ e: "step", ms: pick(r, [1_000, 5_000, 20_000, 35_000, 60_000]) });
    else if (x < 0.94)
      events.push({ e: "cross", reads: 1 + Math.floor(r() * 4), ms: pick(r, [30_000, 60_000]) });
    else events.push({ e: "runAll", force: r() < 0.5 });
  }
  return { seed, kind: k, slowMs, events };
}

/**
 * A rarer order (recommendation 3): the start's runs end, `run --all
 * --force` queues a forced backlog, then edits and crashes come beside it.
 */
export function backlogPlan(seed: number, len = 10): Plan {
  const r = rng(seed ^ 0x9e3779b9);
  const kind = r() < 0.6 ? "node" : "vitest";
  const slowMs = pick(r, [20_000, 35_000, 200_000]);
  const events: Ev[] = [
    { e: "finish", slot: 0, crash: false },
    { e: "finish", slot: 0, crash: false },
    { e: "runAll", force: true },
    { e: "step", ms: 1_000 },
  ];
  while (events.length < len) {
    const x = r();
    if (x < 0.3) events.push({ e: "edit", path: pick(r, ["src/s.ts", "src/p.ts", "src/q.ts"]) });
    else if (x < 0.55) events.push({ e: "finish", slot: Math.floor(r() * 4), crash: r() < 0.5 });
    else if (x < 0.7)
      events.push({ e: "end", slot: Math.floor(r() * 4), file: Math.floor(r() * 6) });
    else if (x < 0.85) events.push({ e: "step", ms: pick(r, [1_000, 20_000, 35_000]) });
    else if (x < 0.95)
      events.push({ e: "promote", files: [pick(r, ALL)], ms: pick(r, [3_000, 60_000]) });
    else events.push({ e: "runAll", force: r() < 0.5 });
  }
  return { seed, kind, slowMs, events };
}

/**
 * Row 011-221: the slow lane beside. Edits reach its files through
 * `src/x.ts`, steps pass row 011-211's 60 s bound while fast work runs, and
 * holds begin and end around its runs.
 */
export function slowPlan(seed: number, len = 12): Plan {
  const r = rng(seed ^ 0x85ebca6b);
  const kind = r() < 0.6 ? "vitest" : "node";
  const slowMs = pick(r, [20_000, 35_000, 200_000]);
  const events: Ev[] = [];
  while (events.length < len) {
    const x = r();
    if (x < 0.18)
      events.push({ e: "edit", path: pick(r, ["src/s.ts", "src/p.ts", "src/q.ts", "src/x.ts"]) });
    else if (x < 0.26)
      events.push({ e: "promote", files: [pick(r, ALL)], ms: pick(r, [30_000, 120_000]) });
    else if (x < 0.42)
      events.push({ e: "end", slot: Math.floor(r() * 4), file: Math.floor(r() * 6) });
    else if (x < 0.56) events.push({ e: "finish", slot: Math.floor(r() * 4), crash: r() < 0.3 });
    else if (x < 0.8) events.push({ e: "step", ms: pick(r, [5_000, 30_000, 60_000]) });
    else if (x < 0.91)
      events.push({ e: "hold", ms: pick(r, [20_000, 90_000, COMMAND_HOLD_MAX_MS]) });
    else events.push({ e: "unhold" });
  }
  return { seed, kind, slowMs, slowLane: true, events };
}

/**
 * Row 011-221: spec 004 D1's slow files of a plan with `slowLane`, one per
 * slow tier, so fast work can come between two of a pass; no quiet window.
 */
const SLOW_POLICY = { ...DEFAULT_POLICY.slow, include: ["e2e/**"], quietMs: 0, maxParallel: 1 };

/** A run of the fake runner, held until an event ends it. */
export interface Flight {
  readonly files: readonly TestFileRef[];
  /** Each file's key row when the run started. */
  readonly startKeys: ReadonlyMap<string, string | null>;
  /** On the model's clock. */
  readonly startedAt: number;
  /** The model's edits when it started. */
  readonly edits: number;
  readonly ended: Set<string>;
  readonly options: RunOptions;
  done: boolean;
  cancelled: boolean;
  crashed: boolean;
  resolve(report: RunReport): void;
}

/** No work of the scheduler open or begun for this long is a quiet point. */
const QUIET_MS = 4;
/** A settle that finds no quiet point in this long fails the sequence. */
const SETTLE_LIMIT_MS = 20_000;

/**
 * One sequence's scheduler, runner and clock. It starts as the probe's
 * fixture: four slow files in an edit's tier in flight, P queued behind by
 * its project's environment, Q beside (`heldTier` of
 * `tier-yields-named.test.ts`).
 */
export class Model {
  readonly flights: Flight[] = [];
  /** Called inside the decision that cancels a run, with the cancel's reason. */
  onCut: (flight: Flight, reason: unknown) => void = () => {};
  /** Row 011-221: the slow lanes whose instance a run opened and no `releaseLane` closed since. */
  readonly open = new Set<string>();
  /** Each `releaseLane` that came while a run of its lane was live, by lane. */
  readonly closedUnderRun: string[] = [];
  /** The test files of the plan: `ALL`, and `E2E` with `slowLane`. */
  readonly paths: readonly string[];
  #edits = 0;
  #drain = true;
  readonly #holds: CommandHoldEntry[] = [];

  private constructor(
    readonly plan: Plan,
    readonly side: CatchUpSide,
    readonly clock: ModelClock,
    private readonly work: ReturnType<typeof watchWork>,
    private readonly dirs: readonly string[],
    private readonly msOf: ReadonlyMap<string, number>,
  ) {
    side.runner.run = (files, options) => this.#run(files, options);
    Object.assign(side.runner, { releaseLane: async (lane: string) => this.#releaseLane(lane) });
    this.paths = plan.slowLane === true ? [...ALL, ...E2E] : ALL;
  }

  static async start(p: Plan): Promise<Model> {
    const files: CatchUpFile[] = [
      ...SLOWS.map((path) => ({ path, ms: p.slowMs, imports: ["src/s.ts"] })),
      { project: "f", path: P, ms: 1, imports: ["src/p.ts"] },
      { path: Q, ms: 1, imports: ["src/q.ts"] },
      ...(p.slowLane === true ? E2E : []).map((path) => ({
        path,
        ms: p.slowMs,
        imports: ["src/x.ts"],
      })),
    ];
    const clock = new ModelClock();
    const work = watchWork();
    clock.install();
    const repo = catchUpRepo(files);
    const node = p.kind === "node" ? { cancels: false, besideBacklog: () => true } : {};
    const dirs = [dirname(repo.main), dirname(repo.poolDir)];
    // Row 011-221: node:test's slots (`backlogSlot: 1`), which no hold cuts; a slow lane's slot directory.
    const laned = () => {
      const slotDir = mkdtempSync(join(tmpdir(), "squeal-model-slot-"));
      dirs.push(slotDir);
      const slow = { slotDir, cpus: () => 8, load: () => [0] };
      const slots = p.kind === "node" ? { backlogSlot: () => 1 } : {};
      return { policy: { ...RUN_MISSING, slow: SLOW_POLICY }, scheduler: { slow }, ...slots };
    };
    const lane = p.slowLane === true ? laned() : { policy: RUN_MISSING };
    const options = { files, hostSlots: 8, now: clock.now, ...lane, ...node };
    const side = catchUpSide(repo, repo.main, options);
    const model = new Model(p, side, clock, work, dirs, new Map(files.map((f) => [f.path, f.ms])));
    try {
      await side.scheduler.start();
      if (!(await model.drain())) throw new Error("the baseline never went idle");
      model.#drain = false;
      model.#edits += 1;
      await side.edit("watch", "src/s.ts", "f.config.json");
      await model.#settle();
    } catch (error) {
      await model.close();
      throw error;
    }
    return model;
  }

  /** The edits so far, the start's included. */
  get edits(): number {
    return this.#edits;
  }

  live(): Flight[] {
    return this.flights.filter((f) => !f.done);
  }

  /** A live run holds `path` and has not ended it. */
  running(path: string): boolean {
    return this.live().some((f) => !f.ended.has(path) && f.files.some((x) => x.path === path));
  }

  rows(): Map<string, { key: string | null; pending: string | null }> {
    const { store, worktreeId } = this.side;
    return new Map(store.testFileKeys.list(worktreeId).map((row) => [row.testFile.path, row]));
  }

  current(path: string): boolean {
    return this.side.current(path);
  }

  unknown(path: string): boolean {
    return this.#states(path).some((s) => s.outcome === "unknown");
  }

  passes(path: string): boolean {
    const s = this.#states(path);
    return s.length > 0 && s.every((x) => x.validity === "current" && x.outcome === "pass");
  }

  /** The daemon's published promotions (`promotions:<worktree>`, C15), in request order. */
  promotions(): { paths: string[]; until: number }[] {
    const raw = this.side.store.meta.get(promotionsMetaKey(this.side.worktreeId));
    if (raw === null) return [];
    const { promotions = [] } = JSON.parse(raw) as {
      promotions?: { files: string[]; until: number }[];
    };
    return promotions.map(({ files, until }) => ({
      paths: files.map((id) => id.split("\u0000").pop() ?? id),
      until,
    }));
  }

  /** The kinds of the published standings (`yields:<worktree>`). */
  standings(): string[] {
    const raw = this.side.store.meta.get(yieldsMetaKey(this.side.worktreeId));
    if (raw === null) return [];
    const { tiers = {} } = JSON.parse(raw) as { tiers?: Record<string, { kind: string }> };
    return Object.values(tiers).map((t) => t.kind);
  }

  /** Applies one event and waits for a quiet point; a `cross` arms the next event. */
  async play(ev: Ev): Promise<void> {
    const { scheduler } = this.side;
    if (ev.e === "cross") return this.clock.cross(ev.reads, ev.ms);
    const live = this.live();
    const f = "slot" in ev ? live[ev.slot % Math.max(1, live.length)] : undefined;
    if (ev.e === "edit") {
      this.#edits += 1;
      await this.side.edit("watch", ev.path);
    } else if (ev.e === "promote") await scheduler.promote(ev.files.map(refOf), ev.ms);
    else if (ev.e === "end" && f !== undefined) this.#end(f, ev.file);
    else if (ev.e === "finish" && f !== undefined)
      this.#complete(f, ev.crash && this.plan.kind === "node");
    else if (ev.e === "step") {
      this.clock.advance(ev.ms);
      // The pump looks again each second on the host's clock; this one stood still.
      await scheduler.requestRetries();
    } else if (ev.e === "runAll")
      void scheduler.requestFullSuite({ force: ev.force }).catch(() => {});
    else if (ev.e === "hold") await this.#hold(ev.ms);
    else if (ev.e === "unhold") await this.unhold();
    await this.#settle();
    // An armed jump applies to this event and what it set off only.
    this.clock.uncross();
  }

  /** A hold the model began holds: its bound has not passed on the model's clock. */
  held(): boolean {
    const t = this.clock.raw();
    return this.#holds.some((h) => h.until > t);
  }

  /** Ends every hold the model began, as their commands' exits do, and tells the scheduler. */
  async unhold(): Promise<void> {
    const { store, worktreeId, scheduler } = this.side;
    for (const h of this.#holds.splice(0)) removeCommandHold(store, worktreeId, h.token);
    await scheduler.commandHold();
  }

  /** Ends every hold and every run as it comes, moving the clock past each wait; whether the scheduler went idle. */
  async drain(): Promise<boolean> {
    this.#drain = true;
    if (this.#holds.length > 0) await this.unhold();
    let idle = false;
    const done = this.side.scheduler.idle().then(() => {
      idle = true;
    });
    for (let i = 0; i < 300 && !idle; i++) {
      for (const f of this.live()) this.#complete(f, false);
      await Promise.race([done, realSleep(20)]);
      if (idle) break;
      this.clock.advance(60_000);
      await this.side.scheduler.requestRetries();
    }
    return idle;
  }

  /** Notes of errors the scheduler had no caller for. */
  errors(): string[] {
    const raw = this.side.store.meta.get(notesMetaKey(this.side.worktreeId));
    const notes = raw === null ? [] : (JSON.parse(raw) as { text?: unknown }[]);
    return notes.flatMap(({ text }) =>
      typeof text === "string" && text.includes("Error: ") ? [text] : [],
    );
  }

  async close(): Promise<void> {
    this.#drain = true;
    for (const f of this.live()) this.#complete(f, false);
    await Promise.race([this.side.scheduler.close(), realSleep(20_000)]);
    this.work.restore();
    this.clock.uninstall();
    this.side.stopBeat();
    this.side.store.close();
    for (const dir of this.dirs) rmSync(dir, { recursive: true, force: true });
  }

  /** A hold of the wrapper's own process, which lives; only `until` or `unhold` ends it. */
  async #hold(ms: number): Promise<void> {
    const since = this.clock.raw();
    const entry: CommandHoldEntry = {
      token: randomUUID(),
      since,
      until: since + ms,
      command: "npm run test:e2e",
      wrapper: processIdentity(process.pid),
      child: null,
    };
    addCommandHold(this.side.store, this.side.worktreeId, entry);
    this.#holds.push(entry);
    await this.side.scheduler.commandHold();
  }

  /** The runner's `releaseLane`: the lane's instance closes, as `withSlowInstance`'s drop does. */
  #releaseLane(lane: string): void {
    if (this.live().some((f) => f.options.lane === lane)) this.closedUnderRun.push(lane);
    this.open.delete(lane);
  }

  #states(path: string) {
    const { store, worktreeId } = this.side;
    return store.knownStates.list(worktreeId).filter((s) => s.check.testPath === path);
  }

  #run(files: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {
    if (options.lane !== undefined && isSlowLane(options.lane)) this.open.add(options.lane);
    return new Promise((resolve) => {
      const keys = this.rows();
      const f: Flight = {
        files: [...files],
        startKeys: new Map(files.map((x) => [x.path, keys.get(x.path)?.key ?? null])),
        startedAt: this.clock.raw(),
        edits: this.#edits,
        ended: new Set(),
        options,
        done: false,
        cancelled: false,
        crashed: false,
        resolve,
      };
      this.flights.push(f);
      const listen = (signal: AbortSignal | undefined, cut: boolean) => {
        const on = () => {
          if (f.done) return;
          if (cut) this.onCut(f, signal?.reason);
          f.cancelled = true;
          this.#complete(f, false);
        };
        if (signal?.aborted === true) on();
        else signal?.addEventListener("abort", on, { once: true });
      };
      if (this.plan.kind === "vitest") listen(options.signal, true);
      listen(options.stop, false);
      if (this.#drain) realSetTimeout(() => this.#complete(f, false), 0);
    });
  }

  /** The `file`th file `f` has not ended ends; a runner that reports ends says so. */
  #end(f: Flight, file: number): void {
    const left = f.files.filter((x) => !f.ended.has(x.path));
    const x = left[file % Math.max(1, left.length)];
    if (x === undefined || f.done) return;
    f.ended.add(x.path);
    if (this.plan.kind === "vitest") f.options.fileEnded?.(x);
  }

  /** A cut run reports the files it ended, as Vitest's does; a crashed one none. */
  #complete(f: Flight, crash: boolean): void {
    if (f.done) return;
    f.done = true;
    f.crashed = crash;
    const ran = crash ? [] : f.cancelled ? f.files.filter((x) => f.ended.has(x.path)) : f.files;
    const results = ran.map((t) => ({
      check: { kind: "test" as const, project: t.project, testPath: t.path, fullName: "runs" },
      outcome: "pass" as const,
      durationMs: this.msOf.get(t.path) ?? 1,
      location: null,
      errors: [],
    }));
    const failure = crash ? "model run crashed" : f.cancelled ? "cancelled" : null;
    const end = crash ? "crashed" : "completed";
    f.resolve({ end, durationMs: 1, completedFiles: ran, results, fileErrors: [], failure });
  }

  /**
   * Waits until the scheduler has done what the last event set off
   * (recommendation 4): nothing of `watchWork` in flight or begun for
   * `QUIET_MS`. The store changes only inside its lock's tasks.
   */
  async #settle(): Promise<void> {
    const began = performance.now();
    let since = began;
    let mark = -1;
    for (;;) {
      await realSleep(1);
      const at = performance.now();
      if (this.work.open() > 0 || this.work.started() !== mark) {
        mark = this.work.started();
        since = at;
      } else if (at - since >= QUIET_MS) return;
      if (at - began > SETTLE_LIMIT_MS) throw new Error(`no quiet point in ${SETTLE_LIMIT_MS} ms`);
    }
  }
}

export const refOf = (path: string): TestFileRef => ({ project: path === P ? "f" : "", path });
