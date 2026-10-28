import { appendFileSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { it, vi } from "vitest";

import { testFileId } from "../../../../../../src/core/keys/index.js";
import { Ledger } from "../../../../../../src/core/scheduler/ledger.js";
import { RunQueue } from "../../../../../../src/core/scheduler/queue.js";
import type { RunOptions, RunReport, TestFileRef } from "../../../../../../src/core/types/index.js";
import { RUN_MISSING } from "../../../../../../test/helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "../../../../../../test/scheduler/catch-up-fixture.js";
import { ModelClock, realSetTimeout, realSleep, watchWork } from "../../../../../../test/scheduler/model-clock.js";

/*
 * Throwaway research probe, row 011-208 (gh-79 widened by gh-121). The real
 * scheduler and store of `catchUpSide`, a fake runner whose runs take model
 * time, and an agent that repeats named waits. Options B and C are patches
 * of this probe only, never of product code:
 * - B: a tier that only promoted files would make an edit's tier is chosen
 *   as the backlog's is (wall budget, grant), and holds promoted files only.
 * - C: a running file keeps the rank of the earliest wait that ever
 *   selected it after that wait ends (no edit in these plans moves a key).
 */

const mode = vi.hoisted(() => ({ b: false, c: false, selecting: false }));

vi.mock("../../../../../../src/core/scheduler/tiers.js", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../../../../../src/core/scheduler/tiers.js")>();
  return {
    ...m,
    selectTier: (...args: Parameters<typeof m.selectTier>) => {
      mode.selecting = true;
      try {
        return m.selectTier(...args);
      } finally {
        mode.selecting = false;
      }
    },
  };
});

// Option B: while a selection runs, promoted-only work reads as no first group, and the order holds promoted files only.
const q = RunQueue.prototype;
const hasFirstGroup = q.hasFirstGroup;
q.hasFirstGroup = function (this: RunQueue, where = () => true) {
  if (mode.b && mode.selecting) return this.hasRecent(where);
  return hasFirstGroup.call(this, where);
};
const ordered = Ledger.prototype.ordered;
Ledger.prototype.ordered = function (this: Ledger, turn?: boolean) {
  const all = ordered.call(this, turn);
  if (!(mode.b && mode.selecting) || this.queue.hasRecent()) return all;
  const promoted = all.filter((ref) => this.queue.isPromoted(ref));
  return promoted.length > 0 ? promoted : all;
};

// Option C: the least request order that ever promoted a file, kept while it is not queued (running).
const kept = new WeakMap<RunQueue, Map<string, number>>();
let clockNow: () => number = Date.now;
const promote = q.promote;
q.promote = function (this: RunQueue, refs: readonly TestFileRef[], until: number) {
  promote.call(this, refs, until);
  const now = clockNow();
  const map = kept.get(this) ?? new Map<string, number>();
  kept.set(this, map);
  for (const ref of refs) {
    const rank = this.rankAt(ref, now)?.rank;
    const id = testFileId(ref);
    if (rank !== undefined && rank < (map.get(id) ?? Number.POSITIVE_INFINITY)) map.set(id, rank);
  }
};
const rankAt = q.rankAt;
q.rankAt = function (this: RunQueue, ref: TestFileRef, now: number) {
  const live = rankAt.call(this, ref, now);
  if (live !== null || !mode.c || this.has(ref)) return live;
  const rank = kept.get(this)?.get(testFileId(ref));
  return rank === undefined ? null : { rank, until: now + 2 ** 30 };
};

// ---------------------------------------------------------------------------------------------
// Inputs: cezar's median passing durations since 2026-10-21 (`extract.mjs`).

interface Dur {
  project: string;
  path: string;
  ms: number;
  parity: boolean;
}
const here = new URL(".", import.meta.url);
const all = (
  JSON.parse(readFileSync(new URL("durations.json", here), "utf8")) as { files: Dur[] }
).files;
const VITEST = new Set(["server", "web", "contract", "api-client"]);
const PARITY = all.filter((f) => f.parity);
const GUARD = [
  "packages/cezar/src/file-length.test.ts",
  "packages/cezar/src/workflows/stopped-composer.test.ts",
  "packages/cezar/src/workflows/worker-destroy.test.ts",
];
/** A seeded choice of 537 other Vitest files, the guard files among them (#79's backlog size). */
function backlog(): Dur[] {
  const pool = all.filter((f) => VITEST.has(f.project) && !f.parity && !GUARD.includes(f.path));
  let seed = 79;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const shuffled = pool
    .map((f) => ({ f, k: rnd() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.f);
  const guard = GUARD.map((p) => all.find((f) => f.path === p && f.project === "server"));
  return [...guard.filter((f) => f !== undefined), ...shuffled].slice(0, 537);
}
const BACKLOG = backlog();
const FILES: CatchUpFile[] = [...PARITY, ...BACKLOG].map((f) => ({
  path: f.path,
  ms: Math.max(1, f.ms),
  imports: ["src/shared.ts"],
}));
const MS = new Map(FILES.map((f) => [f.path, f.ms]));
const refOf = (path: string): TestFileRef => ({ project: "", path });
const parityPaths = PARITY.map((f) => f.path);
const core = parityPaths.filter((p) => p.includes("/src/core/"));
const workflows = parityPaths.filter((p) => p.includes("/src/workflows/"));

/** A run's fixed cost before its files start (spec 011 C4 tier sharing: 110 to 350 ms at idle; more under load). */
const RUN_OVERHEAD_MS = 1_000;
const WAIT_MS = 60_000;
/** The agent's turn between two waits: it reads the output and starts the next. */
const GAP_MS = Number(process.env.GATE_GAP_S ?? 15) * 1000;
const FIRST_WAIT_MS = 5_000;
const LIMIT_MS = 3 * 3600_000;

// ---------------------------------------------------------------------------------------------

interface Flight {
  files: TestFileRef[];
  starts: number[];
  ends: number[];
  startedAt: number;
  workers: number | undefined;
  ended: Set<string>;
  options: RunOptions;
  done: boolean;
  cancelled: boolean;
  cutAt: number | null;
  /** Agent-named files neither current nor running when the cut came. */
  waitingAtCut: string[];
  resolve(report: RunReport): void;
}

type Agent = (i: number, current: (p: string) => boolean) => string[] | null;

const AGENTS: Record<string, Agent> = {
  /** The recommended wait repeated: the same 56 files each time. */
  whole: (_i, cur) => (parityPaths.every(cur) ? null : parityPaths),
  /** The two globs as two waits, in turn (a selection that omits running files, #121 F2). */
  halves: (i, cur) => {
    const pick = i % 2 === 0 ? [core, workflows] : [workflows, core];
    return pick.find((list) => !list.every(cur)) ?? null;
  },
  /** Control: no wait at all, so nothing is promoted; time to verdict counts from the first wait's time. */
  none: () => null,
  /** #79's later comment: the parity wait, then a guard wait of three other files, then parity again. */
  guard: (i, cur) => {
    if (i === 1 && !GUARD.every(cur)) return GUARD;
    return parityPaths.every(cur) ? null : parityPaths;
  },
};

interface Sim {
  option: string;
  agent: string;
  workers: number;
  /** S4: at this offset from t0 a wait names one queued file of about 2 s; the parity wait is not repeated. */
  smallAt?: number;
}

const OUT = process.env.GATE_OUT ?? "results";
const results = new URL(`${OUT}.jsonl`, here);
const traces = new URL(`${OUT}-traces.jsonl`, here);

async function simulate(sim: Sim): Promise<Record<string, unknown>> {
  mode.b = sim.option.includes("B");
  mode.c = sim.option.includes("C");
  const loadBefore = loadavg();
  const realStart = performance.now();
  const clock = new ModelClock();
  clockNow = clock.raw;
  const work = watchWork();
  clock.install();
  const flights: Flight[] = [];
  let draining = true;
  const repo = catchUpRepo(FILES);
  const side: CatchUpSide = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: sim.workers,
    timeoutMs: 900_000,
    policy: RUN_MISSING,
    now: clock.now,
  });
  let open: { files: string[]; until: number; at: number } | null = null;
  const complete = (f: Flight) => {
    if (f.done) return;
    f.done = true;
    const ran = f.cancelled ? f.files.filter((x) => f.ended.has(x.path)) : f.files;
    f.resolve({
      end: "completed",
      durationMs: 1,
      completedFiles: ran,
      results: ran.map((t) => ({
        check: { kind: "test" as const, project: t.project, testPath: t.path, fullName: "runs" },
        outcome: "pass" as const,
        durationMs: MS.get(t.path) ?? 1,
        location: null,
        errors: [],
      })),
      fileErrors: [],
      failure: f.cancelled ? "cancelled" : null,
    });
  };
  let currentSet = new Set<string>();
  const running = () => new Set(flights.filter((f) => !f.done).flatMap((f) => f.files.map((x) => x.path)));
  side.runner.run = (files, options) =>
    new Promise<RunReport>((resolve) => {
      const t = clock.raw();
      const width = Math.max(1, options.workers ?? files.length);
      const free = Array.from({ length: width }, () => t + RUN_OVERHEAD_MS);
      const starts: number[] = [];
      const ends: number[] = [];
      for (const file of files) {
        const at = Math.min(...free);
        const i = free.indexOf(at);
        starts.push(at);
        free[i] = at + (MS.get(file.path) ?? 1);
        ends.push(free[i] ?? at);
      }
      const f: Flight = {
        files: [...files],
        starts,
        ends,
        startedAt: t,
        workers: options.workers,
        ended: new Set(),
        options,
        done: false,
        cancelled: false,
        cutAt: null,
        waitingAtCut: [],
        resolve,
      };
      flights.push(f);
      options.signal?.addEventListener(
        "abort",
        () => {
          if (f.done) return;
          f.cancelled = true;
          f.cutAt = clock.raw();
          const busy = running();
          f.waitingAtCut = (open?.files ?? []).filter((p) => !currentSet.has(p) && !busy.has(p));
          complete(f);
        },
        { once: true },
      );
      if (draining) realSetTimeout(() => complete(f), 0);
    });

  const settle = async () => {
    const began = performance.now();
    let since = began;
    let mark = -1;
    for (;;) {
      await realSleep(1);
      const at = performance.now();
      if (work.open() > 0 || work.started() !== mark) {
        mark = work.started();
        since = at;
      } else if (at - since >= 4) return;
      if (at - began > 60_000) throw new Error("no quiet point in 60 s");
    }
  };
  const readCurrent = () => {
    const bad = new Set<string>();
    const seen = new Set<string>();
    for (const s of side.store.knownStates.list(side.worktreeId)) {
      seen.add(s.check.testPath);
      if (s.validity !== "current") bad.add(s.check.testPath);
    }
    currentSet = new Set([...seen].filter((p) => !bad.has(p)));
  };

  try {
    await side.scheduler.start();
    let idle = false;
    const done = side.scheduler.idle().then(() => {
      idle = true;
    });
    for (let i = 0; i < 300 && !idle; i++) {
      for (const f of flights) complete(f);
      await Promise.race([done, realSleep(20)]);
      if (idle) break;
      clock.advance(60_000);
      await side.scheduler.requestRetries();
    }
    if (!idle) throw new Error("baseline never went idle");
    draining = false;
    const baseRuns = flights.length;
    // An environment edit re-keys every file: the 593 are queued again, none of them an edit's work.
    await side.edit("watch", "config.json");
    await settle();
    const t0 = clock.raw();
    readCurrent();
    const agent = AGENTS[sim.agent] as Agent;
    let i = 0;
    let nextAt = t0 + FIRST_WAIT_MS;
    let firstParityAt: number | null = sim.agent === "none" ? t0 + FIRST_WAIT_MS : null;
    let parityDoneAt: number | null = null;
    let backlogDoneAt: number | null = null;
    let parityWaits = 0;
    let small: { path: string; at: number; doneAt: number | null } | null = null;
    let noSmall = false;
    const allPaths = FILES.map((f) => f.path);

    const agentTick = async (now: number) => {
      if (open !== null && (now >= open.until || open.files.every((p) => currentSet.has(p)))) {
        open = null;
        nextAt = now + GAP_MS;
      }
      if (open !== null || now < nextAt) return;
      // S4: from `smallAt` the agent waits on no parity file; its next wait names one queued file.
      if (sim.smallAt !== undefined && now >= t0 + sim.smallAt) {
        if (small === null) {
          const busy = running();
          // The shortest queued file then: the backlog runs its short files first, so by then
          // none of 2 s may be left. Its extra wait (`smallExtraS`) does not depend on its duration.
          const pick = BACKLOG.filter((f) => !currentSet.has(f.path) && !busy.has(f.path)).sort(
            (a, b) => a.ms - b.ms,
          )[0];
          if (pick === undefined) {
            nextAt = Number.POSITIVE_INFINITY;
            noSmall = true;
            return;
          }
          small = { path: pick.path, at: now, doneAt: null };
        }
        open = { files: [small.path], until: now + WAIT_MS, at: now };
        await side.scheduler.promote([refOf(small.path)], WAIT_MS);
        return;
      }
      const files = agent(i, (p) => currentSet.has(p));
      i += 1;
      if (files === null) {
        nextAt = Number.POSITIVE_INFINITY;
        return;
      }
      if (files === parityPaths || files === core || files === workflows) parityWaits += 1;
      firstParityAt ??= now;
      open = { files, until: now + WAIT_MS, at: now };
      await side.scheduler.promote(files.map(refOf), WAIT_MS);
    };

    await agentTick(clock.raw());
    await settle();
    while (clock.raw() - t0 < LIMIT_MS) {
      const now = clock.raw();
      let next = now + 1_000;
      for (const f of flights)
        if (!f.done)
          for (let k = 0; k < f.files.length; k++) {
            const end = f.ends[k] ?? now;
            if (!f.ended.has(f.files[k]?.path ?? "") && end > now && end < next) next = end;
          }
      if (nextAt > now && nextAt < next) next = nextAt;
      if (open !== null && open.until > now && open.until < next) next = open.until;
      clock.advance(next - now);
      for (const f of flights) {
        if (f.done) continue;
        f.files.forEach((ref, k) => {
          if (!f.ended.has(ref.path) && (f.ends[k] ?? 0) <= next) {
            f.ended.add(ref.path);
            f.options.fileEnded?.(ref);
          }
        });
        if (f.ended.size === f.files.length) complete(f);
      }
      await side.scheduler.requestRetries();
      await settle();
      readCurrent();
      if (parityDoneAt === null && parityPaths.every((p) => currentSet.has(p))) parityDoneAt = next;
      if (backlogDoneAt === null && allPaths.every((p) => currentSet.has(p))) backlogDoneAt = next;
      const s = small as { path: string; at: number; doneAt: number | null } | null;
      if (s !== null && s.doneAt === null && currentSet.has(s.path)) s.doneAt = next;
      if (s?.doneAt != null || noSmall) break;
      if (backlogDoneAt !== null) break;
      await agentTick(next);
      await settle();
    }

    const runs = flights.slice(baseRuns);
    const cuts = runs.filter((f) => f.cancelled);
    let discardedFileMs = 0;
    let discardedWallMs = 0;
    let useless = 0;
    for (const f of cuts) {
      const cutAt = f.cutAt ?? f.startedAt;
      discardedWallMs += cutAt - f.startedAt;
      const cutFiles: string[] = [];
      f.files.forEach((ref, k) => {
        if (f.ended.has(ref.path)) return;
        cutFiles.push(ref.path);
        discardedFileMs += Math.max(0, Math.min(cutAt, f.ends[k] ?? 0) - (f.starts[k] ?? 0));
      });
      // #121 F3 (row 011-263): the next run after the cut holds none of the files that waited then.
      const next = runs.find((r) => r.startedAt >= cutAt && r !== f);
      if (next !== undefined && !next.files.some((x) => f.waitingAtCut.includes(x.path))) useless += 1;
    }
    const s = small as { path: string; at: number; doneAt: number | null } | null;
    const row = {
      option: sim.option,
      agent: sim.smallAt === undefined ? sim.agent : "small",
      workers: sim.workers,
      gapS: GAP_MS / 1000,
      ...(sim.smallAt === undefined ? {} : { smallAt: sim.smallAt / 1000 }),
      timeToVerdictS:
        parityDoneAt === null || firstParityAt === null ? null : (parityDoneAt - firstParityAt) / 1000,
      parityWaits,
      backlogDoneS: backlogDoneAt === null ? null : (backlogDoneAt - t0) / 1000,
      cuts: cuts.length,
      uselessCuts: useless,
      cutFiles: cuts.reduce((n, f) => n + f.files.length - f.ended.size, 0),
      discardedFileS: Math.round(discardedFileMs / 1000),
      discardedWallS: Math.round(discardedWallMs / 1000),
      ...(s === null
        ? {}
        : {
            small: s.path,
            smallMs: MS.get(s.path),
            smallDelayS: s.doneAt === null ? null : (s.doneAt - s.at) / 1000,
            smallExtraS:
              s.doneAt === null
                ? null
                : (s.doneAt - s.at - (MS.get(s.path) ?? 0) - RUN_OVERHEAD_MS) / 1000,
          }),
      ...(noSmall ? { small: null } : {}),
      runs: runs.length,
      load: { before: loadBefore.map((x) => +x.toFixed(2)), after: loadavg().map((x) => +x.toFixed(2)) },
      realS: Math.round((performance.now() - realStart) / 1000),
    };
    appendFileSync(results, `${JSON.stringify(row)}\n`);
    appendFileSync(
      traces,
      `${JSON.stringify({
        option: sim.option,
        agent: row.agent,
        workers: sim.workers,
        gapS: GAP_MS / 1000,
        smallAt: sim.smallAt,
        runs: runs.map((f) => ({
          at: (f.startedAt - t0) / 1000,
          end: f.done ? ((f.cutAt ?? Math.max(...f.ends)) - t0) / 1000 : null,
          files: f.files.length,
          parity: f.files.filter((x) => parityPaths.includes(x.path)).length,
          workers: f.workers ?? null,
          cut: f.cancelled ? f.files.length - f.ended.size : 0,
        })),
      })}\n`,
    );
    console.log(JSON.stringify(row));
    return row;
  } finally {
    draining = true;
    for (const f of flights) complete(f);
    await Promise.race([side.scheduler.close(), realSleep(20_000)]);
    work.restore();
    clock.uninstall();
    side.stopBeat();
  }
}

const OPTIONS = (process.env.GATE_OPTIONS ?? "today,B,C,B+C").split(",");
const AGENT_LIST = (process.env.GATE_AGENTS ?? "whole,halves,guard").split(",").filter(Boolean);
const WORKERS = (process.env.GATE_WORKERS ?? "23").split(",").map(Number);
const SMALL_AT = (process.env.GATE_SMALL_AT ?? "").split(",").filter(Boolean).map((s) => Number(s) * 1000);

for (const workers of WORKERS)
  for (const option of OPTIONS) {
    for (const agent of AGENT_LIST)
      it(`${option} ${agent} W=${workers}`, async () => {
        await simulate({ option, agent, workers });
      }, 900_000);
    for (const smallAt of SMALL_AT)
      it(`${option} small at ${smallAt / 1000}s W=${workers}`, async () => {
        await simulate({ option, agent: "whole", workers, smallAt });
      }, 900_000);
  }
