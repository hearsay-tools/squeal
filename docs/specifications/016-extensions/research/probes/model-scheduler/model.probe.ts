// Throwaway probe for 016-18: a seeded model-based test of the scheduler's
// yield and validity rules. Copied by run.sh into a scratch clone at
// test/scheduler/model-probe.test.ts and run there with Vitest. It imports
// only src/ APIs that exist at every replayed commit (0.1.224 to HEAD) and
// test/scheduler/recording-sink.ts. No pool (no `capacity`), so no read of
// the host's /proc/stat. Env: SEEDS (e.g. "1-60"), LEN (events per
// sequence), INV (invariants checked, e.g. "A,B,C,D,E"), KIND ("mixed",
// "vitest", "node"), STOP ("first" or "all"), SHRINK ("1"), OUT (JSON path).
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { createScheduler } from "../../src/core/scheduler/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type Policy,
  type RunnerAdapter,
  type RunOptions,
  type RunReport,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { RecordingSink } from "./recording-sink.js";

// ---------- seeded generator ----------
function rng(seed: number) {
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

type Ev =
  | { e: "edit"; path: string }
  | { e: "promote"; files: string[]; ms: number }
  | { e: "end"; slot: number; file: number }
  | { e: "finish"; slot: number; crash: boolean }
  | { e: "step"; ms: number }
  | { e: "cross"; reads: number; ms: number }
  | { e: "runAll"; force: boolean };

const SLOWS = ["test/s1.test.ts", "test/s2.test.ts", "test/s3.test.ts", "test/s4.test.ts"];
const P = "f/p.test.ts";
const Q = "test/q.test.ts";
const ALL = [...SLOWS, P, Q];
const PROMOTABLE = ALL;

interface Plan {
  readonly seed: number;
  readonly kind: "vitest" | "node";
  readonly slowMs: number;
  readonly events: Ev[];
}

function plan(seed: number, len: number, kindOpt: string): Plan {
  const r = rng(seed);
  const kind = kindOpt === "mixed" ? (r() < 0.7 ? "vitest" : "node") : (kindOpt as Plan["kind"]);
  const slowMs = pick(r, [20_000, 35_000, 200_000]);
  const events: Ev[] = [];
  while (events.length < len) {
    const x = r();
    if (x < 0.08) events.push({ e: "edit", path: pick(r, ["src/s.ts", "src/p.ts", "src/q.ts"]) });
    else if (x < 0.33) {
      const n = r() < 0.6 ? 1 : 2;
      const files = new Set<string>();
      while (files.size < n) files.add(pick(r, PROMOTABLE));
      events.push({ e: "promote", files: [...files], ms: pick(r, [3_000, 30_000, 60_000, 120_000]) });
    } else if (x < 0.5) events.push({ e: "end", slot: Math.floor(r() * 4), file: Math.floor(r() * 6) });
    else if (x < 0.58) events.push({ e: "finish", slot: Math.floor(r() * 4), crash: r() < 0.4 });
    else if (x < 0.85) events.push({ e: "step", ms: pick(r, [1_000, 5_000, 20_000, 35_000, 60_000]) });
    else if (x < 0.94) events.push({ e: "cross", reads: 1 + Math.floor(r() * 4), ms: pick(r, [30_000, 60_000]) });
    else events.push({ e: "runAll", force: r() < 0.5 });
  }
  return { seed, kind, slowMs, events };
}

// ---------- virtual clock and timers ----------
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realSleep = (ms: number) => new Promise((r) => realSetTimeout(r, ms));

class VTimer {
  h: ReturnType<typeof realSetTimeout> | null = null;
  refd = true;
  constructor(
    readonly due: number,
    readonly fn: () => void,
  ) {}
  unref() {
    this.refd = false;
    this.h?.unref?.();
    return this;
  }
  ref() {
    this.refd = true;
    this.h?.ref?.();
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

/** The scheduler's clock: the host's plus `offset`; `cross` moves it after N more reads. */
class Clock {
  offset = 0;
  left = Number.POSITIVE_INFINITY;
  jump = 0;
  readonly timers = new Set<VTimer>();
  raw = () => Date.now() + this.offset;
  now = () => {
    if (this.left-- === 0) this.advance(this.jump);
    return this.raw();
  };
  advance(ms: number) {
    this.offset += ms;
    const at = this.raw();
    for (const t of [...this.timers])
      if (t.due <= at) {
        if (t.h !== null) realClearTimeout(t.h);
        t.h = realSetTimeout(() => this.fire(t), 0);
        if (!t.refd) t.h.unref?.();
      }
  }
  fire(t: VTimer) {
    if (!this.timers.delete(t)) return;
    t.fn();
  }
  install() {
    const g = globalThis as unknown as Record<string, unknown>;
    g.setTimeout = (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
      const t = new VTimer(this.raw() + Number(ms), () => fn(...args));
      t.h = realSetTimeout(() => this.fire(t), ms);
      this.timers.add(t);
      return t;
    };
    g.clearTimeout = (t: unknown) => {
      if (t instanceof VTimer) {
        this.timers.delete(t);
        if (t.h !== null) realClearTimeout(t.h);
      } else realClearTimeout(t as never);
    };
  }
  uninstall() {
    const g = globalThis as unknown as Record<string, unknown>;
    g.setTimeout = realSetTimeout;
    g.clearTimeout = realClearTimeout;
    for (const t of this.timers) if (t.h !== null) realClearTimeout(t.h);
    this.timers.clear();
  }
}

// ---------- a runner held on command ----------
interface Flight {
  readonly id: number;
  readonly files: TestFileRef[];
  readonly startKeys: Map<string, string | null>;
  readonly vStart: number;
  readonly ended: Set<string>;
  readonly options: RunOptions;
  done: boolean;
  cancelled: boolean;
  crashed: boolean;
  editsAtStart: number;
  resolve: (r: RunReport) => void;
}

const MS: Record<string, number> = {};

class HeldRunner implements RunnerAdapter {
  readonly name = "model";
  readonly adapterVersion = "1";
  readonly flights: Flight[] = [];
  drain = true;
  onAbort: (f: Flight, reason: unknown) => void = () => {};
  onStart: (f: Flight) => Map<string, string | null> = () => new Map();
  edits = () => 0;
  declare readonly besideBacklog?: (t: TestFileRef) => boolean;
  constructor(
    readonly cancels: boolean,
    readonly clock: Clock,
  ) {
    if (!cancels) Object.assign(this, { besideBacklog: () => true });
  }
  invalidate = async () => ({ recreatedProjects: [] });
  affected = async (changed: readonly string[]) => {
    const direct = ALL.filter((p) => changed.includes(p) || changed.includes(importOf(p)));
    return { direct: direct.map(refOf), transitive: [] };
  };
  closure = async (testFile: TestFileRef) => ({ testFile, paths: [testFile.path, importOf(testFile.path)] });
  enumerate = async () => [];
  testFiles = async () => ALL.map(refOf);
  environment = async () =>
    ["", "f"].map((project) => ({
      project,
      runnerName: "model",
      runnerVersion: "1",
      adapterVersion: "1",
      resolvedConfig: "{}",
      files: [project === "" ? "config.json" : "f.config.json"],
    }));
  close = async () => {
    for (const f of this.flights) if (!f.done) this.complete(f, false);
  };
  run(files: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {
    return new Promise((resolve) => {
      const f: Flight = {
        id: this.flights.length,
        files: [...files],
        startKeys: new Map(),
        vStart: this.clock.raw(),
        ended: new Set(),
        options,
        done: false,
        cancelled: false,
        crashed: false,
        editsAtStart: this.edits(),
        resolve,
      };
      for (const [k, v] of this.onStart(f)) f.startKeys.set(k, v);
      this.flights.push(f);
      const abort = (signal: AbortSignal | undefined, effective: boolean, cut = true) => {
        if (signal === undefined) return;
        const on = () => {
          if (f.done) return;
          if (effective && cut) this.onAbort(f, signal.reason);
          if (effective) {
            f.cancelled = true;
            this.complete(f, false);
          }
        };
        if (signal.aborted) on();
        else signal.addEventListener("abort", on, { once: true });
      };
      abort(options.signal, this.cancels);
      abort(options.stop, true, false);
      if (this.drain) realSetTimeout(() => this.complete(f, false), 0);
    });
  }
  live(): Flight[] {
    return this.flights.filter((f) => !f.done);
  }
  endFile(f: Flight, path: string) {
    if (f.done || f.ended.has(path)) return;
    f.ended.add(path);
    if (this.cancels) f.options.fileEnded?.(refOf(path));
  }
  complete(f: Flight, crash: boolean) {
    if (f.done) return;
    f.done = true;
    f.crashed = crash;
    if (crash) {
      f.resolve({ end: "crashed", durationMs: 1, completedFiles: [], results: [], fileErrors: [], failure: "model run crashed" } as RunReport);
      return;
    }
    const completed = f.cancelled ? f.files.filter((x) => f.ended.has(x.path)) : f.files;
    f.resolve({
      end: "completed",
      durationMs: 1,
      completedFiles: completed,
      results: completed.map((t) => ({
        check: { kind: "test" as const, project: t.project, testPath: t.path, fullName: "runs" },
        outcome: "pass" as const,
        durationMs: MS[t.path] ?? 1,
        location: null,
        errors: [],
      })),
      fileErrors: [],
      failure: f.cancelled ? "cancelled" : null,
    } as RunReport);
  }
}

const importOf = (p: string) => (p === P ? "src/p.ts" : p === Q ? "src/q.ts" : "src/s.ts");
const refOf = (p: string): TestFileRef => ({ project: p === P ? "f" : "", path: p });

// ---------- one sequence ----------
interface Violation {
  readonly inv: string;
  readonly at: number;
  readonly detail: string;
}

interface Wait {
  readonly n: number;
  readonly files: string[];
  readonly deadline: number;
  readonly openAtStart: boolean;
}

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function runPlan(p: Plan, inv: Set<string>): Promise<{ violations: Violation[]; steps: number }> {
  for (const path of SLOWS) MS[path] = p.slowMs;
  MS[P] = 1;
  MS[Q] = 1;
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ms18-")));
  const root = join(dir, "main");
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const path of [...ALL, "src/s.ts", "src/p.ts", "src/q.ts", "config.json", "f.config.json"])
    write(path, `// ${path}\n`);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["-c", "user.email=m@x", "-c", "user.name=m", "commit", "-qm", "fixture"]);
  const commonDir = join(root, ".git");
  const opened = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
  const store = opened;
  const worktreeId = worktreeIdFor(root);
  store.worktrees.upsert({
    id: worktreeId,
    root,
    commonDir,
    isMain: true,
    registeredAt: Date.now(),
    daemon: {
      socketPath: `/tmp/ms18-none-${worktreeId}.sock`,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 600_000,
      squealVersion: "0.0.0-test",
    },
  } as never);
  const clock = new Clock();
  clock.install();
  const runner = new HeldRunner(p.kind === "vitest", clock);
  const violations: Violation[] = [];
  const errors: Error[] = [];
  let edits = 0;
  let step = 0;
  runner.edits = () => edits;
  const keyRows = () => {
    const m = new Map<string, { key: string | null; pending: string | null }>();
    for (const row of store.testFileKeys.list(worktreeId) as unknown as {
      testFile: TestFileRef;
      key: string | null;
      pending: string | null;
    }[])
      m.set(row.testFile.path, { key: row.key, pending: row.pending });
    return m;
  };
  const states = (path: string) =>
    (store.knownStates.list(worktreeId) as unknown as { check: { testPath: string }; validity: string; outcome: string }[]).filter(
      (s) => s.check.testPath === path,
    );
  const current = (path: string) => {
    const s = states(path);
    return s.length > 0 && s.every((x) => x.validity === "current");
  };
  runner.onStart = (f) => {
    const rows = keyRows();
    return new Map(f.files.map((x) => [x.path, rows.get(x.path)?.key ?? null]));
  };
  const waits: Wait[] = [];
  const inFlight = (path: string) => runner.live().some((f) => f.files.some((x) => x.path === path));
  // C15 Lifetime: a selected file still holds its wait open while it is queued or running,
  // a forced file at a current result included, or has no current result.
  const waiting = (path: string) => {
    const pending = keyRows().get(path)?.pending ?? null;
    return pending !== null || inFlight(path) || !current(path);
  };
  // A promoted file that could make a tier yield: queued, not in a run.
  const queuedNow = (path: string) => !inFlight(path) && (keyRows().get(path)?.pending === "queued" || !current(path));
  // The daemon's own promotions as it published them (`promotions:<worktree>`, C15), in request order.
  const published = () => {
    const raw = store.meta.get(`promotions:${worktreeId}`);
    if (raw === null) return [];
    return ((JSON.parse(raw) as { promotions?: { files: string[]; until: number }[] }).promotions ?? []).map((x) => ({
      paths: x.files.map((id) => id.split("\u0000").pop() ?? id),
      until: x.until,
    }));
  };
  const daemonRank = (path: string, t: number, slack: number) => {
    const i = published().findIndex((x) => x.until + slack > t && x.paths.includes(path));
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  const cuts = new Map<string, number>();
  let eventAt = 0;
  runner.onAbort = (f, reason) => {
    const t = clock.raw();
    const rows = keyRows();
    const unended = f.files.filter((x) => !f.ended.has(x.path)).map((x) => x.path);
 if (process.env.DEBUG === "1") process.stdout.write(`seed-trace abort ${f.id} ${String(reason)} at ${Math.round((t - f.vStart) / 1000)} s\n`);
    // A release before row 011-56 names no cause (an AbortError): with no edit since the
    // tier started, neither supersession nor a backlog cancel applies, so it is a yield.
    const isYield = reason === "yield" || (typeof reason !== "string" && edits === f.editsAtStart);
    if (!isYield) return;
    if (inv.has("C") && runner.cancels) {
      for (const path of unended) {
        const k = `${path}@${rows.get(path)?.key ?? "null"}`;
        const n = (cuts.get(k) ?? 0) + 1;
        cuts.set(k, n);
        if (n >= 2) violations.push({ inv: "C", at: step, detail: `${path} cut ${n} times at one key` });
      }
    }
    if (inv.has("A") && runner.cancels && t - f.vStart >= 31_000 && edits === f.editsAtStart) {
      // Cuts are judged at the decision's own instant (synchronous abort); a wait at its
      // deadline boundary counts as closed, so the check cannot flag falsely there.
      // A clock armed to jump inside this event's decision (`cross`) may have moved past a
      // deadline the decision read before the jump: the event's start reading is judged too.
      const judged = [t, eventAt];
      const queued = PROMOTABLE.filter(queuedNow);
      const beats = judged.some((at) => {
        const beat = Math.min(...unended.map((x) => daemonRank(x, at, -200)));
        return queued.some((x) => daemonRank(x, at, -200) < beat);
      });
      const beat = Math.min(...unended.map((x) => daemonRank(x, t, -200)));
      if (!beats)
        violations.push({
          inv: "A",
          at: step,
          detail: `tier of ${unended.join(" ")} cut at ${Math.round((t - f.vStart) / 1000)} s with no promoted file ranked before it (beat ${beat})`,
        });
    }
  };
  const scheduler = createScheduler({
    root,
    worktreeId,
    store,
    runner,
    sink: new RecordingSink(store, worktreeId),
    policy: {
      ...DEFAULT_POLICY,
      baseline: { ...DEFAULT_POLICY.baseline, onStart: "lookup-then-run-missing" },
      runner: { ...DEFAULT_POLICY.runner, tierSize: 4, backlogTierSize: 200 },
    } as Policy,
    squealVersion: "0.0.0-test",
    runsDir: storePaths(commonDir).runsDir,
    head: () => readHead(root),
    onError: (error: Error) => errors.push(error),
    now: clock.now,
  } as never);
  const hasher = createFsHasher(root, "sha1");
  const batch = async (...paths: string[]) => {
    edits += 1;
    for (const path of paths) appendFileSync(join(root, path), `// edit ${edits}\n`);
    await scheduler.handleBatch({ trigger: "watch", paths: await statCandidates(paths, hasher) } as never);
  };
  const signature = () =>
    JSON.stringify([
      runner.flights.map((f) => [f.done, f.ended.size]),
      store.meta.get(`yields:${worktreeId}`),
      [...keyRows().values()],
      store.knownStates.list(worktreeId).length,
    ]);
  const settle = async () => {
    let last = "";
    let same = 0;
    for (let i = 0; i < 400; i++) {
      await realSleep(15);
      const sig = signature();
      if (sig === last) {
        if (++same >= 3) return;
      } else {
        same = 0;
        last = sig;
      }
    }
  };
  const drainIdle = async () => {
    runner.drain = true;
    for (const f of runner.live()) runner.complete(f, false);
    let idle = false;
    const done = scheduler.idle().then(() => {
      idle = true;
    });
    for (let i = 0; i < 300 && !idle; i++) {
      await Promise.race([done, realSleep(50)]);
      if (!idle) {
        clock.advance(60_000);
        for (const f of runner.live()) runner.complete(f, false);
      }
    }
    return idle;
  };
  const was = new Map<string, string>();
  const checkSteady = () => {
    const rows = keyRows();
    if (inv.has("D")) {
      for (const path of ALL) {
        const row = rows.get(path);
        const key = row?.key ?? null;
        const s = states(path);
        const told = was.get(path);
        if (told !== undefined && told === key && s.some((x) => x.outcome === "unknown")) {
          const ownCrash = runner.flights.some(
            (f) => f.crashed && f.startKeys.get(path) === key,
          );
          if (!ownCrash) violations.push({ inv: "D", at: step, detail: `${path} was current at its key and is now unknown` });
        }
        if (key !== null && s.length > 0 && s.every((x) => x.validity === "current" && x.outcome === "pass")) was.set(path, key);
        else if (told !== key) was.delete(path);
        const holder = runner.live().find((f) => f.startKeys.get(path) === key && key !== null && !f.ended.has(path));
        if (holder !== undefined && row?.pending == null && !current(path))
          violations.push({ inv: "D", at: step, detail: `${path} runs at its key and its row is not pending` });
      }
    }
    if (inv.has("F")) {
      // C15 Lifetime: a promotion lasts until its deadline or until none of its files is queued or running.
      const t = clock.raw();
      for (const w of waits) {
        if (!w.openAtStart || w.deadline <= t + 500) continue;
        const live = w.files.filter((x) => inFlight(x) || keyRows().get(x)?.pending === "queued");
        if (live.length === 0) continue;
        const kept = published().some((x) => x.until > t && w.files.every((y) => x.paths.includes(y)));
        if (!kept)
          violations.push({ inv: "F", at: step, detail: `wait ${w.n} (${w.files.join(" ")}) is open and ${live.join(" ")} is queued or running, but its promotion is gone` });
      }
    }
    if (inv.has("B") && runner.cancels) {
      const raw = store.meta.get(`yields:${worktreeId}`);
      const tiers = raw === null ? {} : ((JSON.parse(raw) as { tiers?: Record<string, { kind: string }> }).tiers ?? {});
      const named = Object.values(tiers).filter((x) => x.kind === "named").length;
      const live = runner.live().filter((f) => !f.cancelled);
      if (named === 1 && live.length === 1) {
        const f = live[0] as Flight;
        const t = clock.raw();
        const unended = f.files.filter((x) => !f.ended.has(x.path)).map((x) => x.path);
        // A wait at its deadline boundary counts as open here, so the check cannot flag falsely.
        const beat = Math.min(...unended.map((x) => daemonRank(x, t, 200)));
        const queued = PROMOTABLE.filter(queuedNow);
        const better = queued.filter((x) => daemonRank(x, t, 200) < beat);
        if (better.length > 0 && edits === f.editsAtStart)
          violations.push({
            inv: "B",
            at: step,
            detail: `tier stands named, but ${better.join(" ")} ranks before every unended file (${unended.join(" ")})`,
          });
      }
    }
  };
  try {
    await scheduler.start();
    if (!(await drainIdle())) throw new Error("baseline never idle");
    runner.drain = false;
    // The start: an edit's tier of the four slow files in flight, P re-keyed by its environment behind it.
    await batch("src/s.ts", "f.config.json");
    await settle();
    let crossing = false;
    for (const ev of p.events) {
      step += 1;
      eventAt = clock.raw();
      const live = runner.live();
      switch (ev.e) {
        case "edit":
          await batch(ev.path);
          break;
        case "promote": {
          const openAtStart = ev.files.some((x) => inFlight(x) || keyRows().get(x)?.pending === "queued");
          waits.push({ n: waits.length, files: ev.files, deadline: clock.raw() + ev.ms, openAtStart });
          await scheduler.promote(ev.files.map(refOf), ev.ms);
          break;
        }
        case "end": {
          const f = live[ev.slot % Math.max(1, live.length)];
          if (f !== undefined) {
            const left = f.files.filter((x) => !f.ended.has(x.path));
            const x = left[ev.file % Math.max(1, left.length)];
            if (x !== undefined) runner.endFile(f, x.path);
          }
          break;
        }
        case "finish": {
          const f = live[ev.slot % Math.max(1, live.length)];
          if (f !== undefined) runner.complete(f, ev.crash && !runner.cancels);
          break;
        }
        case "step":
          clock.advance(ev.ms);
          break;
        case "cross":
          clock.left = ev.reads;
          clock.jump = ev.ms;
          crossing = true;
          break;
        case "runAll":
          void scheduler.requestFullSuite({ force: ev.force } as never).catch(() => {});
          break;
      }
      if (ev.e !== "cross") {
        if (crossing) {
          // The armed jump applies to this event's decision only.
          clock.left = Number.POSITIVE_INFINITY;
          crossing = false;
        }
        await settle();
        checkSteady();
        if (process.env.DEBUG === "1")
          process.stdout.write(
            `seed-trace ${p.seed} #${step} ${JSON.stringify(ev)} live=${JSON.stringify(runner.live().map((f) => [f.id, f.files.map((x) => x.path.replace(/^.*\//, "")), [...f.ended].length]))} yields=${store.meta.get(`yields:${worktreeId}`)?.replace(/"at":\d+,/, "")} cur=${ALL.filter(current).length} queued=${(scheduler as { queued?: () => number }).queued?.()} promos=${store.meta.get(`promotions:${worktreeId}`)?.replace(/"at":\d+,/, "").replace(/"until":\d+/g, "u")} rows=${JSON.stringify([...keyRows()].map(([k, v]) => [k.replace(/^.*\//, ""), v.pending]))}\n`,
          );
        if (violations.length > 0) break;
      }
    }
    if (violations.length === 0) {
      const idle = await drainIdle();
      if (!idle) violations.push({ inv: "E", at: step, detail: "the scheduler never became idle after every run was released" });
      else if (inv.has("E")) {
        await realSleep(30);
        // C4: a crashed run's files are `unknown` until the next revision or `run --all`.
        const rows = keyRows();
        const crashedAt = (x: string) => {
          const last = [...runner.flights].reverse().find((f) => f.files.some((y) => y.path === x));
          return last?.crashed === true && last.startKeys.get(x) === (rows.get(x)?.key ?? null);
        };
        const stale = ALL.filter((x) => !current(x) && !crashedAt(x));
        if (stale.length > 0) violations.push({ inv: "E", at: step, detail: `not current after release: ${stale.join(" ")}` });
      }
    }
    for (const e of errors) violations.push({ inv: "err", at: step, detail: String(e.message).slice(0, 200) });
  } finally {
    runner.drain = true;
    for (const f of runner.live()) runner.complete(f, false);
    await Promise.race([scheduler.close(), realSleep(20_000)]);
    clock.uninstall();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
  return { violations, steps: step };
}

// ---------- driver ----------
function seeds(spec: string): number[] {
  const out: number[] = [];
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-").map(Number);
    for (let s = a ?? 0; s <= (b ?? a ?? 0); s++) out.push(s);
  }
  return out;
}

it("model-based scheduler probe (016-18)", { timeout: 6 * 3600_000 }, async () => {
  const env = process.env;
  const inv = new Set((env.INV ?? "A,B,C,D,E,F").split(","));
  const len = Number(env.LEN ?? 12);
  const kind = env.KIND ?? "mixed";
  const out: unknown[] = [];
  let tried = 0;
  let firstFind: unknown = null;
  for (const seed of seeds(env.SEEDS ?? "1-20")) {
    tried += 1;
    // EVENTS: replay one given sequence (JSON) instead of the seed's, with KIND and SLOW_MS.
    const p = env.EVENTS
      ? { seed, kind: (env.KIND ?? "vitest") as Plan["kind"], slowMs: Number(env.SLOW_MS ?? 200_000), events: JSON.parse(env.EVENTS) as Ev[] }
      : plan(seed, len, kind);
    const t0 = performance.now();
    const { violations, steps } = await runPlan(p, inv);
    const row = { seed, kind: p.kind, slowMs: p.slowMs, steps, ms: Math.round(performance.now() - t0), violations };
    out.push(row);
    if (violations.length > 0) {
      const v = violations[0] as Violation;
      process.stdout.write(`seed ${seed} ${p.kind} FAIL ${v.inv} at event ${v.at}: ${v.detail}\n`);
      if (firstFind === null) {
        let events = p.events.slice(0, v.at);
        if (env.SHRINK === "1") {
          // Greedy one-event deletion while the same invariant still fails; bounded.
          for (let i = events.length - 1, budget = 40; i >= 0 && budget > 0; i--, budget--) {
            const fewer = events.filter((_, j) => j !== i);
            const again = await runPlan({ ...p, events: fewer }, new Set([v.inv]));
            if (again.violations.some((x) => x.inv === v.inv)) events = fewer;
          }
        }
        firstFind = { seed, tried, invariant: v.inv, detail: v.detail, kind: p.kind, slowMs: p.slowMs, prefix: v.at, shortest: events };
      }
      if ((env.STOP ?? "first") === "first") break;
    } else process.stdout.write(`seed ${seed} ${p.kind} ok (${row.ms} ms)\n`);
  }
  if (env.OUT) writeFileSync(env.OUT, JSON.stringify({ tried, firstFind, runs: out }, null, 1));
});
