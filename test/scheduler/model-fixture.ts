import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { vi } from "vitest";
import { Mutex } from "../../src/core/scheduler/mutex.js";
import { promotionsMetaKey } from "../../src/core/scheduler/promotions.js";
import { SlotRecords } from "../../src/core/scheduler/slot-records.js";
import { yieldsMetaKey } from "../../src/core/scheduler/yields.js";
import {
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

/*
 * Row 011-195 (016-18, `research/model-scheduler.md`): a seeded model of
 * the scheduler of spec 011 C4 and C15. Seven events drive the real
 * scheduler and store of `catchUpSide`; a fake runner holds each run until
 * an event ends a file or the run, and the scheduler's clock stands still
 * until an event moves it. The invariants are the test's.
 */

export type Ev =
  | { e: "edit"; path: string }
  | { e: "promote"; files: string[]; ms: number }
  | { e: "end"; slot: number; file: number }
  | { e: "finish"; slot: number; crash: boolean }
  | { e: "step"; ms: number }
  | { e: "cross"; reads: number; ms: number }
  | { e: "runAll"; force: boolean };

export const SLOWS = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
export const P = "f/p.test.ts";
export const Q = "test/q.test.ts";
export const ALL = [...SLOWS, P, Q];

export interface Plan {
  readonly seed: number;
  /** `vitest` cancels and reports each file's end; `node` does neither, runs its backlog in slots and may crash. */
  readonly kind: "vitest" | "node";
  /** The last-known duration of each slow file. */
  readonly slowMs: number;
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

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
export const realSleep = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms));

/** A timer of the scheduler: it fires at its delay on the host's clock, or once the model's clock passes `due`. */
class ModelTimer {
  handle: ReturnType<typeof realSetTimeout> | null = null;
  refd = true;
  constructor(
    readonly due: number,
    readonly fn: () => void,
  ) {}
  unref() {
    this.refd = false;
    this.handle?.unref();
    return this;
  }
  ref() {
    this.refd = true;
    this.handle?.ref();
    return this;
  }
  hasRef() {
    return this.refd;
  }
  refresh() {
    return this;
  }
  [Symbol.toPrimitive]() {
    return 0;
  }
}

/**
 * The scheduler's clock (`SchedulerOptions.now`): it stands at its first
 * reading until `advance`. `cross` moves it after `reads` more readings, as
 * a host's clock that passes a deadline inside one decision does.
 */
export class ModelClock {
  #at: number | null = null;
  #left = Number.POSITIVE_INFINITY;
  #jump = 0;
  /** The armed jump came. */
  crossed = false;
  readonly #timers = new Set<ModelTimer>();
  /** The time, as the model reads it: no reading of the scheduler's. */
  raw = (): number => {
    this.#at ??= Date.now();
    return this.#at;
  };
  now = (): number => {
    if (this.#left-- === 0) {
      this.crossed = true;
      this.advance(this.#jump);
    }
    return this.raw();
  };
  cross(reads: number, ms: number): void {
    this.#left = reads;
    this.#jump = ms;
    this.crossed = false;
  }
  uncross(): void {
    this.#left = Number.POSITIVE_INFINITY;
  }
  advance(ms: number): void {
    this.#at = this.raw() + ms;
    for (const t of this.#timers)
      if (t.due <= this.#at) {
        if (t.handle !== null) realClearTimeout(t.handle);
        t.handle = realSetTimeout(() => this.#fire(t), 0);
        if (!t.refd) t.handle.unref();
      }
  }
  #fire(t: ModelTimer): void {
    if (this.#timers.delete(t)) t.fn();
  }
  /** Replaces `setTimeout` and `clearTimeout`; Vitest keeps its own. */
  install(): void {
    const g = globalThis as unknown as Record<string, unknown>;
    g.setTimeout = (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
      const t = new ModelTimer(this.raw() + Number(ms), () => fn(...args));
      t.handle = realSetTimeout(() => this.#fire(t), ms);
      this.#timers.add(t);
      return t;
    };
    g.clearTimeout = (t: unknown) => {
      if (!(t instanceof ModelTimer)) return realClearTimeout(t as never);
      this.#timers.delete(t);
      if (t.handle !== null) realClearTimeout(t.handle);
    };
  }
  uninstall(): void {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    for (const t of this.#timers) if (t.handle !== null) realClearTimeout(t.handle);
    this.#timers.clear();
  }
}

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

/**
 * The scheduler's own work in flight, seen from outside: its lock's tasks
 * (`Mutex.run`) and its slot records, which wait outside the lock first
 * (`SlotRecords.record`). Replaces the probe's 45 ms of no change (finding
 * 4, flake risk 1): a decision a loaded host slows holds the lock.
 */
function watchWork() {
  let open = 0;
  let started = 0;
  const track = <T>(work: Promise<T>): Promise<T> => {
    open += 1;
    started += 1;
    const done = () => {
      open -= 1;
    };
    work.then(done, done);
    return work;
  };
  const run = Mutex.prototype.run;
  const record = SlotRecords.prototype.record;
  const spies = [
    vi.spyOn(Mutex.prototype, "run").mockImplementation(function (this: Mutex, task) {
      return track(run.call(this, task));
    }),
    vi.spyOn(SlotRecords.prototype, "record").mockImplementation(function (
      this: SlotRecords<unknown, unknown>,
      ended,
    ) {
      return track(record.call(this, ended));
    }),
  ];
  return {
    open: () => open,
    started: () => started,
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}

/** No lock task or slot record open or started, and nothing the model reads changed, for this long. */
const QUIET_MS = 10;
/** A settle that finds no quiet point in this long fails the sequence. */
const SETTLE_LIMIT_MS = 20_000;

/** One sequence's scheduler, runner and clock. */
export interface Model {
  readonly side: CatchUpSide;
  readonly clock: ModelClock;
  readonly flights: Flight[];
  /** The edits so far, the start's included. */
  readonly edits: () => number;
  /** Called inside the decision that cancels a run, with the cancel's reason. */
  onCut: (flight: Flight, reason: unknown) => void;
  live(): Flight[];
  /** A live run holds `path` and has not ended it. */
  running(path: string): boolean;
  rows(): Map<string, { key: string | null; pending: string | null }>;
  current(path: string): boolean;
  unknown(path: string): boolean;
  passes(path: string): boolean;
  /** The daemon's published promotions (`promotions:<worktree>`, C15), in request order. */
  promotions(): { paths: string[]; until: number }[];
  /** The kinds of the published standings (`yields:<worktree>`). */
  standings(): string[];
  /** Applies one event and waits for a quiet point; a `cross` arms the next event. */
  play(ev: Ev): Promise<void>;
  /** Ends every run as it comes, moving the clock past each wait; whether the scheduler went idle. */
  drain(): Promise<boolean>;
  /** Notes of errors the scheduler had no caller for. */
  errors(): string[];
  close(): Promise<void>;
}

/**
 * The probe's fixture: four slow files in an edit's tier in flight, P
 * queued behind by its project's environment, Q beside (`heldTier` of
 * `tier-yields-named.test.ts`).
 */
export async function startModel(p: Plan): Promise<Model> {
  const files: CatchUpFile[] = [
    ...SLOWS.map((path) => ({ path, ms: p.slowMs, imports: ["src/s.ts"] })),
    { project: "f", path: P, ms: 1, imports: ["src/p.ts"] },
    { path: Q, ms: 1, imports: ["src/q.ts"] },
  ];
  const msOf = new Map(files.map((f) => [f.path, f.ms]));
  const clock = new ModelClock();
  const work = watchWork();
  clock.install();
  const repo = catchUpRepo(files);
  const node = p.kind === "node" ? { cancels: false, besideBacklog: () => true } : {};
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 8,
    policy: RUN_MISSING,
    now: clock.now,
    ...node,
  });
  const { store, worktreeId, scheduler } = side;
  const flights: Flight[] = [];
  let edits = 0;
  let drain = true;
  const rows = () => {
    const m = new Map<string, { key: string | null; pending: string | null }>();
    for (const row of store.testFileKeys.list(worktreeId)) m.set(row.testFile.path, row);
    return m;
  };
  const states = (path: string) =>
    store.knownStates.list(worktreeId).filter((s) => s.check.testPath === path);
  const complete = (f: Flight, crash: boolean) => {
    if (f.done) return;
    f.done = true;
    f.crashed = crash;
    const ran = crash ? [] : f.cancelled ? f.files.filter((x) => f.ended.has(x.path)) : f.files;
    const results = ran.map((t) => ({
      check: { kind: "test" as const, project: t.project, testPath: t.path, fullName: "runs" },
      outcome: "pass" as const,
      durationMs: msOf.get(t.path) ?? 1,
      location: null,
      errors: [],
    }));
    const failure = crash ? "model run crashed" : f.cancelled ? "cancelled" : null;
    f.resolve({
      end: crash ? "crashed" : "completed",
      durationMs: 1,
      completedFiles: ran,
      results,
      fileErrors: [],
      failure,
    });
  };
  const model: Model = {
    side,
    clock,
    flights,
    edits: () => edits,
    onCut: () => {},
    live: () => flights.filter((f) => !f.done),
    running: (path) =>
      model.live().some((f) => !f.ended.has(path) && f.files.some((x) => x.path === path)),
    rows,
    current: (path) => side.current(path),
    unknown: (path) => states(path).some((s) => s.outcome === "unknown"),
    passes: (path) => {
      const s = states(path);
      return s.length > 0 && s.every((x) => x.validity === "current" && x.outcome === "pass");
    },
    promotions: () => {
      const raw = store.meta.get(promotionsMetaKey(worktreeId));
      const list =
        raw === null
          ? []
          : ((JSON.parse(raw) as { promotions?: { files: string[]; until: number }[] })
              .promotions ?? []);
      return list.map((x) => ({
        paths: x.files.map((id) => id.split("\u0000").pop() ?? id),
        until: x.until,
      }));
    },
    standings: () => {
      const raw = store.meta.get(yieldsMetaKey(worktreeId));
      const tiers =
        raw === null
          ? {}
          : ((JSON.parse(raw) as { tiers?: Record<string, { kind: string }> }).tiers ?? {});
      return Object.values(tiers).map((t) => t.kind);
    },
    async play(ev) {
      if (ev.e === "cross") return clock.cross(ev.reads, ev.ms);
      const live = model.live();
      const f = "slot" in ev ? live[ev.slot % Math.max(1, live.length)] : undefined;
      if (ev.e === "edit") {
        edits += 1;
        await side.edit("watch", ev.path);
      } else if (ev.e === "promote") await scheduler.promote(ev.files.map(refOf), ev.ms);
      else if (ev.e === "end" && f !== undefined) {
        const left = f.files.filter((x) => !f.ended.has(x.path));
        const x = left[ev.file % Math.max(1, left.length)];
        if (x !== undefined && !f.done) {
          f.ended.add(x.path);
          if (p.kind === "vitest") f.options.fileEnded?.(x);
        }
      } else if (ev.e === "finish" && f !== undefined) complete(f, ev.crash && p.kind === "node");
      else if (ev.e === "step") {
        clock.advance(ev.ms);
        // The pump looks again each second on the host's clock; this one stood still.
        await scheduler.requestRetries();
      } else if (ev.e === "runAll")
        void scheduler.requestFullSuite({ force: ev.force }).catch(() => {});
      await settle();
      // An armed jump applies to this event and what it set off only.
      clock.uncross();
    },
    async drain() {
      drain = true;
      for (const f of model.live()) complete(f, false);
      let idle = false;
      const done = scheduler.idle().then(() => {
        idle = true;
      });
      for (let i = 0; i < 300 && !idle; i++) {
        await Promise.race([done, realSleep(20)]);
        if (idle) break;
        clock.advance(60_000);
        await scheduler.requestRetries();
        for (const f of model.live()) complete(f, false);
      }
      return idle;
    },
    errors: () => {
      const raw = store.meta.get(notesMetaKey(worktreeId));
      const notes = raw === null ? [] : (JSON.parse(raw) as { text?: string }[]);
      return notes.flatMap((n) =>
        typeof n.text === "string" && n.text.includes("Error: ") ? [n.text] : [],
      );
    },
    async close() {
      drain = true;
      for (const f of model.live()) complete(f, false);
      await Promise.race([scheduler.close(), realSleep(20_000)]);
      work.restore();
      clock.uninstall();
      side.stopBeat();
      store.close();
      rmSync(dirname(repo.main), { recursive: true, force: true });
      rmSync(dirname(repo.poolDir), { recursive: true, force: true });
    },
  };
  const signature = () =>
    JSON.stringify([
      flights.map((f) => [f.done, f.ended.size]),
      [...rows().values()],
      store.knownStates.list(worktreeId).length,
    ]);
  async function settle(): Promise<void> {
    const began = performance.now();
    let since = began;
    let mark = -1;
    let last = "";
    for (;;) {
      await realSleep(2);
      const at = performance.now();
      const sig = signature();
      if (work.open() > 0 || work.started() !== mark || sig !== last) {
        mark = work.started();
        last = sig;
        since = at;
      } else if (at - since >= QUIET_MS) return;
      if (at - began > SETTLE_LIMIT_MS)
        throw new Error(`no quiet point within ${SETTLE_LIMIT_MS} ms`);
    }
  }
  side.runner.run = (runFiles, options) =>
    new Promise<RunReport>((resolve) => {
      const keys = rows();
      const f: Flight = {
        files: [...runFiles],
        startKeys: new Map(runFiles.map((x) => [x.path, keys.get(x.path)?.key ?? null])),
        startedAt: clock.raw(),
        edits,
        ended: new Set(),
        options,
        done: false,
        cancelled: false,
        crashed: false,
        resolve,
      };
      flights.push(f);
      const listen = (signal: AbortSignal | undefined, cut: boolean) => {
        const on = () => {
          if (f.done) return;
          if (cut) model.onCut(f, signal?.reason);
          f.cancelled = true;
          complete(f, false);
        };
        if (signal?.aborted === true) on();
        else signal?.addEventListener("abort", on, { once: true });
      };
      if (p.kind === "vitest") listen(options.signal, true);
      listen(options.stop, false);
      if (drain) realSetTimeout(() => complete(f, false), 0);
    });
  try {
    await scheduler.start();
    if (!(await model.drain())) throw new Error("the baseline never went idle");
    drain = false;
    edits += 1;
    await side.edit("watch", "src/s.ts", "f.config.json");
    await settle();
  } catch (error) {
    await model.close();
    throw error;
  }
  return model;
}

export const refOf = (path: string): TestFileRef => ({ project: path === P ? "f" : "", path });
