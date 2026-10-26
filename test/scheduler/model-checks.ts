import { SLOW_RELEASE_MS } from "../../src/core/scheduler/slow-release.js";
import { isSlowLane } from "../../src/core/types/index.js";
import type { Flight, Model } from "./model-fixture.js";
import { ALL, type Plan } from "./model-plans.js";

/*
 * The invariants A to G of `model-scheduler.test.ts`, checked over one
 * sequence the model plays (row 011-195; row 011-221 adds G).
 */

export interface Violation {
  readonly inv: string;
  /** The event it was seen after, from 1. */
  readonly at: number;
  readonly detail: string;
}

/** How a slow lane's instance closed between two quiet points with no slow run's end between (G). */
export type Closed = "hold" | "bound";

/** Invariants A to G of one sequence, read from the daemon's store and rows and the runner's calls. */
export class Checks {
  readonly found: Violation[] = [];
  /** The event being played, from 1, and the model's clock at its start. */
  at = 0;
  eventAt: number;
  readonly #vitest: boolean;
  readonly #cuts = new Map<string, number>();
  readonly #waits: { files: string[]; deadline: number; open: boolean }[] = [];
  /** The key each file was a current pass at. */
  readonly #was = new Map<string, string>();
  /** G: the slow runs seen ended, and the model's clock at the first quiet point after the last. */
  readonly #slowDone = new Set<Flight>();
  #slowEnd: number | null = null;
  /** G: the slow lanes open at the last quiet point. */
  #open = new Set<string>();
  /** G: the closes the sequence reached, so a G that never meets its case is seen. */
  readonly closed = new Set<Closed>();

  constructor(
    readonly m: Model,
    kind: Plan["kind"],
  ) {
    this.#vitest = kind === "vitest";
    this.eventAt = m.clock.raw();
    m.onCut = (f, reason) => this.#cut(f, reason);
  }

  #add(inv: string, detail: string): void {
    this.found.push({ inv, at: this.at, detail });
  }

  /** C15 Rank: a file an open wait selected ranks by that wait's request, read from the daemon's row. */
  #rank(path: string, t: number): number {
    const i = this.m.promotions().findIndex((x) => x.until > t && x.paths.includes(path));
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  }

  #listed(path: string): boolean {
    return this.m.live().some((f) => f.files.some((x) => x.path === path));
  }

  /** The queued promoted files that rank before every one of `unended` at `t`. */
  #beats(unended: readonly string[], t: number): string[] {
    const { m } = this;
    const beat = Math.min(...unended.map((x) => this.#rank(x, t)));
    // In no run that has not ended it, and queued or not current: it could make a tier yield.
    const queued = (x: string) =>
      !m.running(x) && (m.rows().get(x)?.pending === "queued" || !m.current(x));
    return ALL.filter((x) => queued(x) && this.#rank(x, t) < beat);
  }

  promoted(files: string[], ms: number): void {
    const open = files.some((x) => this.#listed(x) || this.m.rows().get(x)?.pending === "queued");
    this.#waits.push({ files, deadline: this.eventAt + ms, open });
  }

  /** Inside the decision that cancels `f`. */
  #cut(f: Flight, reason: unknown): void {
    const { m } = this;
    // A cancel before row 011-56 names no cause: with no edit since the tier started, it is a yield.
    const yields = reason === "yield" || (typeof reason !== "string" && m.edits === f.edits);
    if (!yields || !this.#vitest) return;
    const t = m.clock.raw();
    const unended = f.files.filter((x) => !f.ended.has(x.path)).map((x) => x.path);
    // C: C4 step 5, a yield cuts a file once per key, the key its run started at.
    for (const path of unended) {
      const key = `${path}@${f.startKeys.get(path)}`;
      const n = (this.#cuts.get(key) ?? 0) + 1;
      this.#cuts.set(key, n);
      if (n > 1) this.#add("C", `${path} cut ${n} times at one key`);
    }
    // A: once a tier has run 30 s, a promoted file cuts it only when it ranks before every
    // unended file, judged at the cut and at the event's start (a jump may have come between).
    if (t - f.startedAt < 31_000 || m.edits !== f.edits) return;
    if ([t, this.eventAt].some((when) => this.#beats(unended, when).length > 0)) return;
    const s = Math.round((t - f.startedAt) / 1000);
    this.#add("A", `tier of ${unended.join(" ")} cut at ${s} s, no promoted file before it`);
  }

  /** At each quiet point. */
  steady(): void {
    for (const path of this.m.paths) this.#validity(path);
    this.#lifetime();
    this.#named();
    this.#slowLane();
  }

  /**
   * G: row 011-211, a slow lane's instance closes at once when a hold
   * begins and once 60 s passed since the last slow run with none in flight
   * since; never while a run of it is live. The last end is read at the
   * quiet point after it, no earlier than the scheduler's own reading.
   */
  #slowLane(): void {
    const { m } = this;
    for (const lane of m.closedUnderRun.splice(0)) this.#add("G", `${lane} closed under its run`);
    const t = m.clock.raw();
    const ended = m.flights.filter((f) => f.done && slow(f) && !this.#slowDone.has(f));
    for (const f of ended) this.#slowDone.add(f);
    if (ended.length > 0) this.#slowEnd = t;
    for (const lane of this.#open)
      if (!m.open.has(lane) && ended.length === 0) this.closed.add(m.held() ? "hold" : "bound");
    this.#open = new Set(m.open);
    for (const lane of m.open) {
      if (m.live().some((f) => f.options.lane === lane)) continue;
      const since = this.#slowEnd === null ? null : t - this.#slowEnd;
      if (m.held()) this.#add("G", `${lane} open under a hold, no run of it live`);
      else if (since !== null && since >= SLOW_RELEASE_MS)
        this.#add("G", `${lane} open ${since / 1000} s after the last slow run, none live`);
    }
  }

  /** D: a current pass at key K is not `unknown` while K stays, unless a run at K crashed; a file running at its key reads pending. */
  #validity(path: string): void {
    const { m } = this;
    const row = m.rows().get(path);
    const key = row?.key ?? null;
    const told = this.#was.get(path);
    const crashed = m.flights.some((f) => f.crashed && f.startKeys.get(path) === key);
    if (told === key && m.unknown(path) && !crashed)
      this.#add("D", `${path} was current at its key and is now unknown`);
    if (key !== null && m.passes(path)) this.#was.set(path, key);
    else if (told !== key) this.#was.delete(path);
    const held = m
      .live()
      .some((f) => key !== null && f.startKeys.get(path) === key && !f.ended.has(path));
    if (held && row?.pending == null && !m.current(path))
      this.#add("D", `${path} runs at its key and its row is not pending`);
  }

  /** F: C15 Lifetime, a promotion lasts until its deadline or until none of its files is queued or running. */
  #lifetime(): void {
    const { m } = this;
    const t = m.clock.raw();
    for (const [n, w] of this.#waits.entries()) {
      if (!w.open || w.deadline <= t) continue;
      const live = w.files.filter((x) => this.#listed(x) || m.rows().get(x)?.pending === "queued");
      // None queued or running: the promotion ended, and a later edit that queues them does not bring it back.
      if (live.length === 0) w.open = false;
      else if (
        !m.promotions().some((x) => x.until > t && w.files.every((y) => x.paths.includes(y)))
      )
        this.#add(
          "F",
          `wait ${n} (${w.files.join(" ")}) is open, ${live.join(" ")} queued or running, its promotion gone`,
        );
    }
  }

  /** B: a tier that stands `named` runs a file that ranks with or before every queued promoted file. */
  #named(): void {
    const { m } = this;
    const live = m.live().filter((f) => !f.cancelled);
    const f = live[0];
    if (!this.#vitest || f === undefined || live.length > 1 || m.edits !== f.edits) return;
    if (m.standings().filter((k) => k === "named").length !== 1) return;
    const unended = f.files.filter((x) => !f.ended.has(x.path)).map((x) => x.path);
    const better = this.#beats(unended, m.clock.raw());
    if (better.length > 0)
      this.#add(
        "B",
        `tier stands named, but ${better.join(" ")} ranks before every unended file (${unended.join(" ")})`,
      );
  }

  /** E: released and idle, every file is current but one whose last run crashed at its key (C4). */
  async released(): Promise<void> {
    const { m } = this;
    if (!(await m.drain())) return this.#add("E", "never idle after every run was released");
    const rows = m.rows();
    const crashedAt = (x: string) => {
      const last = m.flights.findLast((f) => f.files.some((y) => y.path === x));
      return last?.crashed === true && last.startKeys.get(x) === (rows.get(x)?.key ?? null);
    };
    const stale = m.paths.filter((x) => !m.current(x) && !crashedAt(x));
    if (stale.length > 0) this.#add("E", `not current after release: ${stale.join(" ")}`);
    // G: a drained pass closes its lane (004 D2).
    for (const lane of m.open) this.#add("G", `${lane} open after its pass drained`);
  }
}

const slow = (f: Flight) => f.options.lane !== undefined && isSlowLane(f.options.lane);
