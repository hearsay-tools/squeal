import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readHeader } from "../../src/core/delivery/index.js";
import type {
  RunnerAdapter,
  RunOptions,
  RunReport,
  Scheduler,
  Store,
  WorktreeId,
} from "../../src/core/types/index.js";

/**
 * Phase marks for a real-scheduler test (row 011-281). The test's waits are
 * bounded within its budget; one that runs out fails with a `StallError`
 * that names the phase it waited in, the spans still open in it (a runner
 * call, a child process), the scheduler's state, this process's children,
 * and where the test's store and run logs are kept.
 */

/** The phases of the crash/re-key test; a forced stall names one (`TraceOptions.stall`). */
export const PHASES = [
  "baseline",
  "batch",
  "refinement",
  "runner.run",
  "child rewrite",
  "child exit",
  "idle",
  "cleanup",
] as const;
export type Phase = (typeof PHASES)[number];

export interface TraceOptions {
  /** How long the test's waits may take in all, from the trace's creation. */
  readonly budgetMs: number;
  /** How long each cleanup step may take. */
  readonly cleanupMs: number;
  /**
   * Test-only hook: the first span of this phase after the baseline waits
   * until a bound runs out (for `baseline`, the baseline's first run).
   */
  readonly stall: Phase | null;
  /** Kept on a failure and named in it. */
  readonly kept: { readonly dir: string; readonly database: string; readonly runsDir: string };
}

interface Span {
  readonly phase: Phase;
  readonly detail: string;
  /** The foreground wait open when the span began; `null` between waits. */
  readonly within: Phase | null;
  readonly queuedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  held: boolean;
}

/** What a report reads of a harness. */
export interface Watched {
  readonly scheduler: Scheduler;
  readonly store: Store;
  readonly worktreeId: WorktreeId;
  readonly runs: readonly { readonly options: RunOptions; readonly report: RunReport }[];
  readonly errors: readonly Error[];
}

/** A bound ran out: `phase` is the wait that ran out, `open` the phases of the spans still open. */
export class StallError extends Error {
  constructor(
    readonly phase: Phase,
    readonly open: readonly Phase[],
    readonly boundMs: number,
    readonly waitedMs: number,
    report: string,
  ) {
    super(report);
    this.name = "StallError";
  }
}

const MARKS_SHOWN = 80;
const RAN_OUT: unique symbol = Symbol("ran out");
const firstLine = (error: unknown) => String(error).split("\n")[0];

export class PhaseTrace {
  readonly #began = Date.now();
  readonly #spans: Span[] = [];
  readonly #marks: string[] = [];
  readonly #releases: (() => void)[] = [];
  #current: Phase | null = null;
  #stallUsed = false;
  #kept = false;
  #reported = false;
  #watched: Watched | null = null;

  constructor(readonly options: TraceOptions) {}

  /** What is left of the budget. */
  remaining(): number {
    return Math.max(0, this.#began + this.options.budgetMs - Date.now());
  }

  /** The test's tmp dir stays after its cleanup: a bound ran out or the test failed. */
  keeps(dir: string): boolean {
    return this.#kept && dir === this.options.kept.dir;
  }

  watch(watched: Watched): void {
    this.#watched = watched;
  }

  /**
   * `call` as a span of `phase`, for a queue to call: queued now, started
   * when called, ended with `outcome` of its answer; held first when it is
   * the forced stall.
   */
  call<T>(
    phase: Phase,
    detail: string,
    call: () => Promise<T>,
    outcome: (answer: T) => string = () => "ok",
  ): () => Promise<T> {
    const span = this.#begin(phase, detail);
    return async () => {
      this.#start(span);
      try {
        const held = this.#hold(span);
        if (held !== null) await held;
        const answer = await call();
        this.#end(span, outcome(answer));
        return answer;
      } catch (error) {
        this.#end(span, `rejected: ${firstLine(error)}`);
        throw error;
      }
    };
  }

  /** `work` as a foreground wait of `phase`, bounded by what is left of the budget. */
  wait<T>(phase: Phase, detail: string, work: () => Promise<T>): Promise<T> {
    return this.#bounded(phase, detail, () => work(), this.remaining(), true);
  }

  /** `work` as a background step, bounded by `capMs` or what is left of the budget. */
  step<T>(phase: Phase, detail: string, work: (ms: number) => Promise<T>, capMs: number) {
    return this.#bounded(phase, detail, work, Math.min(capMs, this.remaining()), false);
  }

  /** Marks a line in the trace, as a step's progress. */
  note(phase: Phase, text: string): void {
    this.#marks.push(`+${Date.now() - this.#began} ${phase} ${text}`);
  }

  /**
   * A harness's close, each step bounded by `cleanupMs`. A close that runs
   * out is retried with cancellation, so the runner can still close; its
   * `StallError` is thrown after.
   */
  async close(scheduler: Scheduler, runner: RunnerAdapter): Promise<void> {
    const cleanup = (detail: string, work: () => Promise<void>) =>
      this.#bounded("cleanup", detail, work, this.options.cleanupMs, true);
    let stall: unknown = null;
    try {
      await cleanup("scheduler.close", () => scheduler.close());
    } catch (error) {
      stall = error;
      await cleanup("scheduler.close with cancel", () => scheduler.close({ cancel: true })).catch(
        () => {},
      );
    }
    await cleanup("runner.close", () => runner.close()).catch((error: unknown) => {
      stall ??= error;
    });
    if (stall !== null) throw stall;
  }

  /** The test failed: keep its files; the report, unless a `StallError` carried it. */
  failed(): string | null {
    this.#kept = true;
    if (this.#reported) return null;
    this.#reported = true;
    return this.report("squeal scheduler test failed (row 011-281 trace)");
  }

  report(headline: string): string {
    const now = Date.now();
    const at = (time: number) => `+${time - this.#began} ms`;
    const open = this.#spans.filter((span) => span.endedAt === null);
    const { budgetMs, stall } = this.options;
    return [
      headline,
      `test time ${now - this.#began} ms of a ${budgetMs} ms budget; forced stall: ${stall ?? "none"}`,
      open.length === 0 ? "open spans: none" : "open spans, oldest first:",
      ...open.map((span) => {
        const started = span.startedAt === null ? "not started" : `started ${at(span.startedAt)}`;
        const held = span.held ? " (held: forced stall)" : "";
        const since = now - (span.startedAt ?? span.queuedAt);
        return `  ${span.phase} [${span.detail}]: queued ${at(span.queuedAt)}, ${started}, open ${since} ms${held}`;
      }),
      `marks, ms since the trace began (last ${Math.min(MARKS_SHOWN, this.#marks.length)} of ${this.#marks.length}):`,
      ...this.#marks.slice(-MARKS_SHOWN).map((mark) => `  ${mark}`),
      "harness:",
      ...this.#state().map((line) => `  ${line}`),
      childProcesses(),
      ...this.#keptLines(),
    ].join("\n");
  }

  async #bounded<T>(
    phase: Phase,
    detail: string,
    work: (ms: number) => Promise<T>,
    boundMs: number,
    foreground: boolean,
  ): Promise<T> {
    const span = this.#begin(phase, detail);
    if (foreground) this.#current = phase;
    this.#start(span);
    const held = this.#hold(span);
    const answer = held === null ? work(boundMs) : held.then(() => work(boundMs));
    answer.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ranOut = new Promise<typeof RAN_OUT>((resolve) => {
      timer = setTimeout(() => resolve(RAN_OUT), boundMs);
    });
    try {
      const first = await Promise.race([answer, ranOut]);
      if (first !== RAN_OUT) {
        this.#end(span, "ok");
        return first;
      }
    } catch (error) {
      this.#end(span, `rejected: ${firstLine(error)}`);
      throw error;
    } finally {
      clearTimeout(timer);
      if (foreground) this.#current = null;
    }
    const waitedMs = Date.now() - (span.startedAt ?? span.queuedAt);
    this.#end(span, `ran out after ${waitedMs} ms (bound ${boundMs} ms)`);
    const open = this.#spans.filter((other) => other.endedAt === null).map((other) => other.phase);
    const headline = `squeal scheduler test stalled (row 011-281): ${phase} [${detail}] did not end within ${boundMs} ms`;
    const error = new StallError(phase, open, boundMs, waitedMs, this.report(headline));
    this.#kept = true;
    this.#reported = true;
    for (const release of this.#releases.splice(0)) release();
    throw error;
  }

  #begin(phase: Phase, detail: string): Span {
    const span: Span = {
      phase,
      detail,
      within: this.#current,
      queuedAt: Date.now(),
      startedAt: null,
      endedAt: null,
      held: false,
    };
    this.#spans.push(span);
    this.#mark(span, "queued");
    return span;
  }

  #start(span: Span): void {
    span.startedAt = Date.now();
    this.#mark(span, "start");
  }

  #end(span: Span, outcome: string): void {
    span.endedAt = Date.now();
    this.#mark(span, `end: ${outcome}`);
  }

  /** The forced stall's wait for `span`, or `null`: released when a bound runs out. */
  #hold(span: Span): Promise<void> | null {
    const { stall } = this.options;
    if (stall === null || this.#stallUsed) return null;
    const match =
      stall === "baseline"
        ? span.phase === "runner.run" && span.within === "baseline"
        : span.phase === stall && span.within !== "baseline";
    if (!match) return null;
    this.#stallUsed = true;
    span.held = true;
    this.#mark(span, "held: forced stall");
    return new Promise((resolve) => this.#releases.push(resolve));
  }

  #mark(span: Span, event: string): void {
    this.note(span.phase, `[${span.detail}] ${event}`);
  }

  #state(): readonly string[] {
    const watched = this.#watched;
    if (watched === null) return ["not opened"];
    try {
      const { scheduler, store, worktreeId, runs, errors } = watched;
      const ends = runs.map(({ options: { runId }, report }) => {
        return `${runId} ${report.end} (store: ${store.runs.get(runId)?.end ?? "no end"})`;
      });
      return [
        `revision ${scheduler.status().revision}, queued ${scheduler.queued()}, in use ${scheduler.inUse()}, owed ${scheduler.owedWork() ?? "nothing"}`,
        `counts ${JSON.stringify(readHeader(store, worktreeId).counts)}`,
        `recorded runs: ${ends.length === 0 ? "none" : ends.join("; ")}`,
        `scheduler errors: ${errors.length === 0 ? "none" : errors.map(firstLine).join("; ")}`,
      ];
    } catch (error) {
      return [`unreadable: ${firstLine(error)}`];
    }
  }

  #keptLines(): string[] {
    const { dir, database, runsDir } = this.options.kept;
    const lines = [`kept for inspection: ${dir}`, `  store: ${database}`, `  run logs: ${runsDir}`];
    let runs: string[] = [];
    try {
      runs = readdirSync(runsDir).sort();
    } catch {
      lines.push("    none written");
    }
    for (const run of runs) {
      let end = "no vitest.log";
      try {
        end = readFileSync(join(runsDir, run, "vitest.log"), "utf8").split("\n")[1] ?? "";
      } catch {}
      lines.push(`    ${run}: ${end}`);
    }
    return lines;
  }
}

/** A process's state letter from `/proc` (`Z`: exited, not reaped), or `gone`; `null` if unknown. */
export function processState(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] ?? null;
  } catch {
    try {
      process.kill(pid, 0);
      return null;
    } catch {
      return "gone";
    }
  }
}

/** This process's children with their state and command, read from `/proc` (Linux). */
function childProcesses(): string {
  try {
    const pids = readdirSync("/proc/self/task").flatMap((task) =>
      readFileSync(`/proc/self/task/${task}/children`, "utf8").trim().split(/\s+/).filter(Boolean),
    );
    const children = pids.map((pid) => {
      let command = "";
      try {
        command = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").slice(0, 120);
      } catch {}
      return `  ${pid} ${processState(Number(pid)) ?? "?"} ${command.trim()}`;
    });
    return [`child processes of ${process.pid}: ${children.length}`, ...children].join("\n");
  } catch (error) {
    return `child processes of ${process.pid}: unreadable (${firstLine(error)})`;
  }
}
