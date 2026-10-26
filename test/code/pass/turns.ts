import { constants, type PerformanceEntry, PerformanceObserver } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { vi } from "vitest";
import { Connection } from "../../../src/core/store/connection.js";

/*
 * Rows 015-55 and 015-56: the main thread's long turns while a pass or a
 * coverage chain runs, and what ran in each. A timer every `TICK_MS`
 * bounds the turns. The thread's own CPU time in a turn tells work from a
 * wait (another process on the CPU, or a disk sync). Garbage collections
 * and write transactions are timed beside, and the caller's marks name
 * the phase. Only a long turn is kept.
 */

/** The timer's period: a turn is known to this much. */
const TICK_MS = 5;

/** A turn longer than this is kept. */
const LONG_MS = 50;

/** A write transaction this long is named in its turn. */
const WRITE_MS = 5;

const GC_KINDS: Record<number, string> = {
  [constants.NODE_PERFORMANCE_GC_MAJOR]: "major",
  [constants.NODE_PERFORMANCE_GC_MINOR]: "minor",
  [constants.NODE_PERFORMANCE_GC_INCREMENTAL]: "incremental",
  [constants.NODE_PERFORMANCE_GC_WEAKCB]: "weak callbacks",
};

interface Span {
  readonly from: number;
  readonly to: number;
}

/** One long turn: its wall time, the main thread's CPU time in it, and what ran in it. */
export interface Turn extends Span {
  readonly cpu: number;
}

/** The main thread's CPU time in ms; the process's where Node has no per-thread count. */
function cpuMs(): number {
  const usage = (process.threadCpuUsage ?? process.cpuUsage)();
  return (usage.user + usage.system) / 1000;
}

export class TurnLog {
  readonly #turns: Turn[] = [];
  readonly #marks: { readonly at: number; readonly phase: string }[] = [];
  readonly #gc: (Span & { readonly kind: string })[] = [];
  /** Each write transaction: its first statement, and its commit, where SQLite checkpoints the WAL. */
  readonly #transactions: (Span & { first: string; commit: number })[] = [];
  #stop: (() => void) | null = null;

  /** Starts the timer, the collector's observer and the transactions' timing, at `phase`. */
  start(phase: string): void {
    this.mark(phase);
    let last = performance.now();
    let lastCpu = cpuMs();
    const tick = () => {
      const now = performance.now();
      const cpu = cpuMs();
      if (now - last > LONG_MS) this.#turns.push({ from: last, to: now, cpu: cpu - lastCpu });
      last = now;
      lastCpu = cpu;
    };
    const timer = setInterval(tick, TICK_MS);
    const collected = (entries: readonly PerformanceEntry[]) => {
      for (const e of entries) {
        const { kind } = (e as PerformanceEntry & { detail?: { kind?: number } }).detail ?? {};
        const name = GC_KINDS[kind ?? 0] ?? "other";
        this.#gc.push({ from: e.startTime, to: e.startTime + e.duration, kind: name });
      }
    };
    const observer = new PerformanceObserver((list) => collected(list.getEntries()));
    observer.observe({ entryTypes: ["gc"] });
    const transaction = Connection.prototype.transaction;
    const run = Connection.prototype.run;
    const exec = DatabaseSync.prototype.exec;
    const transactions = this.#transactions;
    let open: (typeof transactions)[number] | null = null;
    const timed = vi.spyOn(Connection.prototype, "transaction").mockImplementation(function <T>(
      this: Connection,
      fn: () => T,
    ): T {
      if (open !== null) return transaction.call(this, fn) as T;
      const t = { from: performance.now(), to: 0, first: "", commit: 0 };
      open = t;
      try {
        return transaction.call(this, fn) as T;
      } finally {
        open = null;
        t.to = performance.now();
        transactions.push(t);
      }
    });
    const ran = vi.spyOn(Connection.prototype, "run").mockImplementation(function (
      this: Connection,
      sql,
      ...params
    ) {
      if (open !== null && open.first === "") open.first = sql.replace(/\s+/g, " ").slice(0, 60);
      return run.call(this, sql, ...params);
    });
    const committed = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      const from = performance.now();
      exec.call(this, sql);
      if (sql === "COMMIT" && open !== null) open.commit = performance.now() - from;
    });
    this.#stop = () => {
      // The turn that ends here had no tick after it.
      tick();
      clearInterval(timer);
      collected(observer.takeRecords());
      observer.disconnect();
      timed.mockRestore();
      ran.mockRestore();
      committed.mockRestore();
    };
  }

  /** The phase from now on. */
  mark(phase: string): void {
    if (this.#marks.at(-1)?.phase !== phase) this.#marks.push({ at: performance.now(), phase });
  }

  stop(): void {
    this.#stop?.();
    this.#stop = null;
  }

  /** The long turns, longest first. */
  turns(): readonly Turn[] {
    return [...this.#turns].sort((a, b) => b.to - b.from - (a.to - a.from));
  }

  /** The longest turn in ms, a tick's slack included; 0 when none was long. */
  longest(): number {
    const [turn] = this.turns();
    return turn === undefined ? 0 : Math.round(turn.to - turn.from);
  }

  /** The most CPU time the main thread spent in one long turn, in ms: its own work, no wait. */
  longestWork(): number {
    return Math.round(Math.max(0, ...this.#turns.map((t) => t.cpu)));
  }

  /** One turn as the log reads it: `443 ms (thread 130 ms) in a, b; gc major 300 ms; "INSERT INTO states" 12 ms (commit 1 ms)`. */
  describe(turn: Turn): string {
    const within = (s: Span) => s.from < turn.to && s.to > turn.from;
    const before = this.#marks.filter((m) => m.at <= turn.from).at(-1);
    const phases = [
      ...new Set(
        [before, ...this.#marks.filter((m) => m.at > turn.from && m.at < turn.to)].flatMap((m) =>
          m === undefined ? [] : [m.phase],
        ),
      ),
    ];
    const gc = this.#gc
      .filter(within)
      .map((g) => `gc ${g.kind} ${Math.round(g.to - g.from)} ms`)
      .join(", ");
    const written = this.#transactions
      .filter((t) => within(t) && t.to - t.from >= WRITE_MS)
      .map(
        (t) => `"${t.first}" ${Math.round(t.to - t.from)} ms (commit ${Math.round(t.commit)} ms)`,
      )
      .join(", ");
    return `${Math.round(turn.to - turn.from)} ms (thread ${Math.round(turn.cpu)} ms) in ${phases.join(", ")}${gc === "" ? "" : `; ${gc}`}${written === "" ? "" : `; ${written}`}`;
  }

  /** The `count` longest turns as one log fragment. */
  summary(count = 3): string {
    const turns = this.turns().slice(0, count);
    return turns.length === 0
      ? `no turn over ${LONG_MS} ms`
      : `long turns: ${turns.map((t) => this.describe(t)).join(" | ")}`;
  }
}
