import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { FileState } from "../../src/core/scheduler/files.js";
import { newFileState } from "../../src/core/scheduler/files.js";
import type { FocusEntry } from "../../src/core/scheduler/focused-entries.js";
import type { PlanAsks, QueueView } from "../../src/core/scheduler/tier-plan.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";

/*
 * Row 011-346: a queue view built from rows and a table of the plan's
 * asks that logs each call, so a plan runs with no store, no scheduler and
 * no timer. The queue's order is the rows' order: the first group (an
 * edit's work, a batch's files) first, or the second group first on the
 * turn; a batch's files by rank, then longest first.
 */

/** One queued test file. */
export interface Row {
  readonly path: string;
  readonly lane?: string;
  /** Work an edit caused: of the first group. */
  readonly recent?: boolean;
  readonly ms?: number | null;
  /** `null`: unkeyed, it leaves the queue. */
  readonly keyed?: boolean;
  /** A saved result stands for it: its lookup settles it. */
  readonly stored?: boolean;
  /** Another worktree's claim holds its key. */
  readonly claimed?: boolean;
  /** The batch it is in (promoted). */
  readonly batch?: number;
  readonly forced?: boolean;
  readonly catchUp?: boolean;
  readonly tierCap?: number;
  /** Its runner runs the backlog in slots of this many files. */
  readonly slot?: number;
  /** A focused entry waits for it. */
  readonly focus?: boolean;
  /** Cut past its tier's estimate by a yield. */
  readonly cut?: boolean;
}

/** The table: rows and the facts beside them. */
export interface Table {
  readonly rows: readonly Row[];
  readonly busy?: readonly string[];
  readonly turnDue?: boolean;
  readonly batchTurn?: boolean;
  /** What the pool offers; the want when absent. */
  readonly offer?: number;
  /** The most workers a backlog tier may get (row 011-418); none, `null`, when absent. */
  readonly fullWidth?: number;
  readonly tierSize?: number;
  readonly backlogTierSize?: number;
  readonly timeoutMs?: number | null;
  /** Lanes that wait for quiet after a backlog cancel. */
  readonly quiet?: readonly string[];
  readonly quietWakeMs?: number;
  /** Lanes whose catch-up waits for quiet: a backlog tier or a turn takes none of its catch-up rows. */
  readonly catchUpQuiet?: readonly string[];
  /** The paths a tier beside a running batch's takes. */
  readonly beside?: readonly string[];
  readonly slots?: boolean;
}

export const NOW = 1_000_000 as EpochMs;

const ref = (path: string): TestFileRef => ({ project: "", path });

/** A view and logging asks over `table`; `queued` holds the paths still queued. */
export function tableOf(table: Table) {
  const log: string[] = [];
  const rows = new Map(table.rows.map((row) => [row.path, row]));
  const queued = new Set(table.rows.map((row) => row.path));
  const files = new Map<string, FileState>();
  for (const row of table.rows) {
    const file = newFileState(ref(row.path));
    file.key = row.keyed === false ? null : (`k-${row.path}` as CheckKey);
    file.durationMs = row.ms ?? null;
    file.tierCap = row.tierCap ?? null;
    files.set(row.path, file);
  }
  const of = (r: TestFileRef): Row => rows.get(r.path) ?? { path: r.path };
  const first = (r: TestFileRef) => of(r).recent === true || of(r).batch !== undefined;
  const live = () => table.rows.filter((row) => queued.has(row.path)).map((row) => ref(row.path));
  const tierSize = table.tierSize ?? 4;
  const entries: FocusEntry[] = table.rows
    .filter((row) => row.focus === true)
    .map((row, seq) => ({
      ref: ref(row.path),
      id: testFileId(ref(row.path)),
      texts: ["t"],
      until: NOW + 60_000,
      seq,
      runId: null,
    }));
  const lane = (r: TestFileRef) => of(r).lane ?? "fast";
  let waited = false;
  const view: QueueView = {
    now: NOW,
    runner: {
      tierSize,
      backlogTierSize: table.backlogTierSize ?? 200,
      timeoutMs: table.timeoutMs === undefined ? 600_000 : table.timeoutMs,
    },
    cut: { cutPastEstimate: (file) => of(file.ref).cut === true },
    slots: table.slots ?? false,
    busy: () => new Set(table.busy ?? []),
    turnDue: () => table.turnDue ?? false,
    beside: () => {
      const paths = table.beside;
      return paths === undefined ? null : (r) => paths.includes(r.path);
    },
    lane,
    tierWidth: (_, grant) => Math.max(1, grant),
    tierPart: () => "",
    backlogSlot: (r) => of(r).slot ?? null,
    file: (r) => files.get(r.path),
    inputs: () => [],
    runtimePolicy: () => "",
    checkpointIdFor: () => null,
    checkpointActive: () => null,
    ordered: (turn) => {
      const all = live();
      const firsts = all.filter(first);
      const rest = all.filter((r) => !first(r));
      return turn ? [...rest, ...firsts] : [...firsts, ...rest];
    },
    orderedBatches: () =>
      live()
        .filter((r) => of(r).batch !== undefined)
        .sort(
          (a, b) => (of(a).batch ?? 0) - (of(b).batch ?? 0) || (of(b).ms ?? -1) - (of(a).ms ?? -1),
        ),
    rankAt: (r) => of(r).batch ?? null,
    has: (r) => queued.has(r.path),
    isFirstGroup: first,
    isForced: (r) => of(r).forced === true,
    isRecent: (r) => of(r).recent === true,
    isCatchUp: (r) => of(r).catchUp === true,
    isPromoted: (r) => of(r).batch !== undefined,
    hasFast: (where) => live().some(where),
    fastQueued: (where) => live().some(where),
    hasFirstGroup: (where) => live().some((r) => first(r) && where(r)),
    fastSize: () => live().length,
    batchTurn: () => table.batchTurn ?? false,
    quietHolds: (r, at, tier) =>
      (tier.backlog && (table.quiet ?? []).includes(at)) ||
      ((tier.backlog || tier.turn) &&
        of(r).catchUp === true &&
        (table.catchUpQuiet ?? []).includes(at)),
    quietWakeMs: () => {
      const quiet = table.quiet ?? [];
      const catchUp = table.catchUpQuiet ?? [];
      const holds = live().some(
        (r) => quiet.includes(lane(r)) || (of(r).catchUp === true && catchUp.includes(lane(r))),
      );
      return holds ? (table.quietWakeMs ?? 1_000) : null;
    },
    focusedSize: () => entries.length,
    focusRunnable: (entry) => {
      const file = files.get(entry.ref.path);
      return file?.key ? { file, key: file.key } : null;
    },
  };
  const asks: PlanAsks = {
    beginPass: () => {
      waited = false;
      log.push("begin");
    },
    focusWaiting: () => entries.filter((entry) => entry.runId === null),
    dropFocus: (entry) => {
      log.push(`drop focus ${entry.ref.path}`);
    },
    peek: (r) => (of(r).claimed ? "waits" : of(r).stored ? "stored" : "free"),
    drop: (r) => {
      log.push(`drop ${r.path}`);
      queued.delete(r.path);
    },
    lookup: (file) => {
      log.push(`lookup ${file.ref.path}`);
      if (of(file.ref).stored !== true) return { mayWait: true };
      queued.delete(file.ref.path);
      return "settled";
    },
    held: (key) => {
      const path = key.slice(2);
      const held = rows.get(path)?.claimed === true;
      if (held) {
        log.push(`held ${path}`);
        waited = true;
      }
      return held;
    },
    backlogSize: () => table.backlogTierSize ?? 200,
    offer: (want) => {
      log.push(`offer ${want}`);
      return table.offer ?? want;
    },
    fullWidth: () => table.fullWidth ?? null,
    endPass: () => {
      log.push("end");
    },
    claimsWaiting: () => waited,
  };
  return { view, asks, log, queued };
}
