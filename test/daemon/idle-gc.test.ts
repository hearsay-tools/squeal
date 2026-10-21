import { describe, expect, it, vi } from "vitest";
import {
  type GcFunction,
  IDLE_GC_AFTER_MS,
  IdleGc,
  type IdleGcOptions,
  idleGcDue,
} from "../../src/core/daemon/idle-gc.js";
import type { RunnerAdapter, RunReport } from "../../src/core/types/index.js";

/*
 * Spec 011 C9 (row 011-69, research `daemon-memory.md` 2 and 4): a daemon
 * that has run no tier in any lane for 60 s runs one last-resort GC, and no
 * other until a tier has run and ended since. Driven with a test clock and
 * a recording `gc`.
 */

const LAST_RESORT = { type: "major", execution: "sync", flavor: "last-resort" };
const MIB = 2 ** 20;

describe("idleGcDue", () => {
  const quiet = { now: 1_000 + IDLE_GC_AFTER_MS, quietSince: 1_000, tierRunning: false };

  it("is due 60 s after the last tier ended, not before", () => {
    expect(IDLE_GC_AFTER_MS).toBe(60_000);
    expect(idleGcDue({ ...quiet, collected: false })).toBe(true);
    expect(idleGcDue({ ...quiet, now: quiet.now - 1, collected: false })).toBe(false);
  });

  it("is never due while a tier runs, after a GC since, or before the daemon is ready", () => {
    expect(idleGcDue({ ...quiet, tierRunning: true, collected: false })).toBe(false);
    expect(idleGcDue({ ...quiet, collected: true })).toBe(false);
    expect(idleGcDue({ ...quiet, quietSince: null, collected: false })).toBe(false);
  });
});

interface Subject {
  readonly idle: IdleGc;
  readonly gc: ReturnType<typeof vi.fn<GcFunction>>;
  readonly notes: string[];
  readonly lines: string[];
  advance(ms: number): void;
}

function subject(options: Partial<IdleGcOptions> = {}): Subject {
  let clock = 1_000_000;
  const gc = vi.fn<GcFunction>();
  const notes: string[] = [];
  const lines: string[] = [];
  let reading = 0;
  const idle = new IdleGc({
    now: () => clock,
    note: (text) => notes.push(text),
    log: (line) => lines.push(line),
    lookup: () => gc,
    // 900 MiB before each GC, 500 MiB after it.
    memory: () => ({ kind: "private", bytes: (reading++ % 2 === 0 ? 900 : 500) * MIB }),
    ...options,
  });
  return {
    idle,
    gc,
    notes,
    lines,
    advance: (ms) => {
      clock += ms;
    },
  };
}

/** A tier that runs `ms` on the test clock. */
function tier(t: Subject, ms = 1_000): void {
  t.idle.started();
  t.advance(ms);
  t.idle.ended();
}

describe("the idle GC (row 011-69)", () => {
  it("runs one last-resort GC 60 s after the daemon is ready when no tier ran", () => {
    const t = subject();
    t.idle.check();
    t.advance(IDLE_GC_AFTER_MS);
    t.idle.check();
    expect(t.gc).not.toHaveBeenCalled();
    t.idle.ready();
    t.advance(IDLE_GC_AFTER_MS - 1);
    t.idle.check();
    expect(t.gc).not.toHaveBeenCalled();
    t.advance(1);
    t.idle.check();
    expect(t.gc.mock.calls).toEqual([[LAST_RESORT]]);
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toMatch(
      /^no tier for 60 s: a last-resort GC took private memory from 900 to 500 MiB in a \d+ ms pause$/,
    );
    expect(t.notes).toEqual([]);
  });

  it("counts the quiet from the last tier's end and runs none while a tier runs", () => {
    const t = subject();
    t.idle.ready();
    t.idle.started();
    t.advance(10 * IDLE_GC_AFTER_MS);
    t.idle.check();
    expect(t.gc).not.toHaveBeenCalled();
    t.idle.ended();
    t.advance(IDLE_GC_AFTER_MS - 1);
    t.idle.check();
    expect(t.gc).not.toHaveBeenCalled();
    t.advance(1);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(1);
  });

  it("waits for every tier in flight, of any lane", () => {
    const t = subject();
    t.idle.ready();
    t.idle.started();
    t.idle.started();
    t.advance(1_000);
    t.idle.ended();
    t.advance(IDLE_GC_AFTER_MS);
    t.idle.check();
    expect(t.gc).not.toHaveBeenCalled();
    t.idle.ended();
    t.advance(IDLE_GC_AFTER_MS);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(1);
  });

  it("runs no second GC until a tier has run and ended, then one more 60 s after it", () => {
    const t = subject();
    t.idle.ready();
    tier(t);
    t.advance(IDLE_GC_AFTER_MS);
    t.idle.check();
    for (let i = 0; i < 10; i++) {
      t.advance(IDLE_GC_AFTER_MS);
      t.idle.check();
    }
    expect(t.gc).toHaveBeenCalledTimes(1);
    tier(t);
    t.advance(IDLE_GC_AFTER_MS - 1);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(1);
    t.advance(1);
    t.idle.check();
    t.advance(IDLE_GC_AFTER_MS);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(2);
    expect(t.lines).toHaveLength(2);
  });

  it("does not move the quiet when the daemon is ready while a tier runs", () => {
    const t = subject();
    t.idle.started();
    t.idle.ready();
    t.advance(IDLE_GC_AFTER_MS);
    t.idle.ended();
    t.advance(IDLE_GC_AFTER_MS - 1);
    t.idle.check();
    expect(t.gc).not.toHaveBeenCalled();
    t.advance(1);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(1);
  });

  it("without gc, persists one note and keeps running", () => {
    const lookup = vi.fn(() => null);
    const t = subject({ lookup });
    t.idle.ready();
    t.advance(IDLE_GC_AFTER_MS);
    expect(() => t.idle.check()).not.toThrow();
    tier(t);
    t.advance(IDLE_GC_AFTER_MS);
    expect(() => t.idle.check()).not.toThrow();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(t.notes).toEqual([
      "no last-resort GC when idle: V8's gc is not available; this daemon runs on without it",
    ]);
    expect(t.lines).toEqual([]);
  });

  it("when looking gc up throws, persists one note and keeps running", () => {
    const t = subject({
      lookup: () => {
        throw new Error("flags frozen");
      },
    });
    t.idle.ready();
    t.advance(IDLE_GC_AFTER_MS);
    expect(() => t.idle.check()).not.toThrow();
    tier(t);
    t.advance(IDLE_GC_AFTER_MS);
    t.idle.check();
    expect(t.notes).toEqual([
      "no last-resort GC when idle: V8's gc is not available (Error: flags frozen); this daemon runs on without it",
    ]);
  });

  it("when gc throws, persists one note and calls it no more", () => {
    const gc = vi.fn<GcFunction>(() => {
      throw new TypeError("bad options");
    });
    const t = subject({ lookup: () => gc });
    t.idle.ready();
    t.advance(IDLE_GC_AFTER_MS);
    expect(() => t.idle.check()).not.toThrow();
    tier(t);
    t.advance(IDLE_GC_AFTER_MS);
    t.idle.check();
    expect(gc).toHaveBeenCalledTimes(1);
    expect(t.notes).toEqual([
      "no last-resort GC when idle: it failed (TypeError: bad options); this daemon runs on without it",
    ]);
    expect(t.lines).toEqual([]);
  });

  it("names RSS where the host has no private memory reading", () => {
    const t = subject({ memory: () => ({ kind: "rss", bytes: 300 * MIB }) });
    t.idle.ready();
    t.advance(IDLE_GC_AFTER_MS);
    t.idle.check();
    expect(t.lines[0]).toMatch(/took RSS from 300 to 300 MiB in a \d+ ms pause$/);
  });
});

describe("IdleGc.track", () => {
  const report = {} as RunReport;

  function runner(run: RunnerAdapter["run"]): RunnerAdapter {
    return { name: "fake", adapterVersion: "1", run } as unknown as RunnerAdapter;
  }

  it("counts each run of the runner as a tier, to its end, rejected or not", async () => {
    const t = subject();
    t.idle.ready();
    let finish: (report: RunReport) => void = () => {};
    const tracked = t.idle.track(
      runner(() => new Promise<RunReport>((resolve) => (finish = resolve))),
    );
    expect(tracked.name).toBe("fake");
    const running = tracked.run([], {} as Parameters<RunnerAdapter["run"]>[1]);
    t.advance(2 * IDLE_GC_AFTER_MS);
    t.idle.check();
    expect(t.gc).not.toHaveBeenCalled();
    finish(report);
    await expect(running).resolves.toBe(report);
    t.advance(IDLE_GC_AFTER_MS);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(1);

    const failing = t.idle.track(runner(() => Promise.reject(new Error("run failed"))));
    await expect(failing.run([], {} as Parameters<RunnerAdapter["run"]>[1])).rejects.toThrow(
      "run failed",
    );
    t.advance(IDLE_GC_AFTER_MS);
    t.idle.check();
    expect(t.gc).toHaveBeenCalledTimes(2);
  });
});
