import type { RevisionNumber } from "../../core/types/common.js";
import type { StatusHold } from "../../core/types/standing.js";
import type { CheckpointEnd } from "../../core/types/store-records.js";
import type { FileClasses, FileVerdict } from "../verdict.js";
import type { InstallHold } from "./progress.js";
import type { LintCounts } from "./reads.js";

/*
 * Row 011-326 (`research/waits.md`, decision 3): the run waits by name, each
 * one row of one table. A row is the wait's chain of conditions in the order
 * the wait checked them before the move; each cell is a difference between
 * two waits, beside the others. The cells that differ by accident are
 * marked "accidental" where they stand (`research/waits.md`, "Gaps open
 * today in the run waits").
 *
 * Row 011-327 (decision 4) gives the run waits the status waits' rules,
 * each a changed cell. Every socket request a wait or a request loop makes
 * ends by the deadline (`askWithin`), and a late answer is a busy daemon:
 * common to every row, so no longer a cell.
 */

/** A run wait by name (GLOSSARY "Run wait"). */
export type RunWaitName = "checkpoint" | "group" | "lint group";

/** A field of a read record (`WaitRecord`) that a read fills. */
export type ReadField =
  | "store"
  | "unavailable"
  | "end"
  | "revision"
  | "late"
  | "hold"
  | "verdict"
  | "classes"
  | "install"
  | "counts"
  | "daemon";

/** A condition on a read record; `FIELD_OF` names the field it reads. */
export type Condition =
  | "store unopened"
  | "store busy"
  | "newer revision"
  | "abandoned"
  | "running"
  | "completed"
  | "before deadline"
  | "late"
  | "held"
  | "verdict settled"
  | "files pending"
  | "files settled"
  | "lint off"
  | "lint unread"
  | "nothing to lint"
  | "ping due"
  | "no daemon";

/** The field each condition reads; `poll` is given, never read. */
export const FIELD_OF: Readonly<Record<Condition, ReadField | "poll">> = {
  "store unopened": "store",
  "store busy": "store",
  "newer revision": "revision",
  abandoned: "end",
  running: "end",
  completed: "end",
  "before deadline": "late",
  late: "late",
  held: "hold",
  "verdict settled": "verdict",
  "files pending": "classes",
  "files settled": "classes",
  "lint off": "counts",
  "lint unread": "counts",
  "nothing to lint": "counts",
  "ping due": "poll",
  "no daemon": "daemon",
};

/** Every this many reads, a run wait asks whether the daemon is still there: every 5 s. */
export const PING_POLLS = 5;

/**
 * What one read of a run wait found. A field is absent until the decision
 * asked for it: a wait reads only what its row's chain reaches.
 */
export interface WaitRecord {
  /** The read's number from 0; the daemon check is due on every `PING_POLLS`th. */
  readonly poll: number;
  /** The checkpoint's revision, which a newer one ends (the checkpoint wait; given, not read). */
  readonly since?: RevisionNumber;
  /**
   * Whether the worktree's store opened for this read: `busy`, its lock was
   * held past the read's busy timeout; `unopened`, it cannot be read.
   */
  readonly store?: "opened" | "busy" | "unopened";
  /** Why the store was not read, in the words of `withStatusStore` (row 011-327). */
  readonly unavailable?: string;
  /** The checkpoint's end: `null` while it runs. */
  readonly end?: CheckpointEnd | null;
  /** The worktree's latest revision. */
  readonly revision?: RevisionNumber;
  /** The deadline passed at this read (`now >= deadline`). */
  readonly late?: boolean;
  /** The hold on the worktree with one of the wait's files queued; `null`: none. */
  readonly hold?: StatusHold | null;
  readonly verdict?: FileVerdict;
  readonly classes?: FileClasses;
  /** The install the worktree waits for; `null`: none. */
  readonly install?: InstallHold | null;
  /** The lint group's checks; `off` when lint is off, `unread` when the lint store cannot be read. */
  readonly counts?: LintCounts | "off" | "unread";
  /** The daemon check's answer: `none` when no daemon listens. */
  readonly daemon?: "answered" | "none" | "unanswered";
}

/** Row 011-327: the worktree's store did not open, or was busy at the deadline's read; why. */
export interface UnopenedOutcome {
  readonly kind: "unopened";
  readonly unavailable: string;
}

/** How the checkpoint wait ended (spec 005 D1). */
export type CheckpointOutcome =
  | { readonly kind: "ended"; readonly verdict: FileVerdict }
  | UnopenedOutcome
  /** Row 011-73 (C6 as amended 2026-10-21): its files are queued while the worktree is on hold. */
  | { readonly kind: "on-hold"; readonly hold: StatusHold }
  | { readonly kind: "abandoned" | "stopped" }
  | { readonly kind: "moved"; readonly revision: RevisionNumber }
  | { readonly kind: "deadline"; readonly verdict: FileVerdict };

/** How the wait on a group's test files ended (spec 019 D6). */
export type GroupOutcome =
  | { readonly kind: "ended"; readonly verdict: FileVerdict }
  | { readonly kind: "deadline"; readonly verdict: FileVerdict; readonly install?: InstallHold }
  | { readonly kind: "on-hold"; readonly hold: StatusHold }
  | UnopenedOutcome
  | { readonly kind: "stopped" };

/** How the wait on a lint group's checks ended (row 019-22). */
export type LintGroupOutcome =
  | { readonly kind: "ended" | "deadline"; readonly counts: LintCounts }
  | { readonly kind: "off" | "unread" | "stopped" };

/** Each run wait's closed set of outcomes (GLOSSARY "Wait outcome"). */
export interface OutcomeOf {
  readonly checkpoint: CheckpointOutcome;
  readonly group: GroupOutcome;
  readonly "lint group": LintGroupOutcome;
}

export type WaitOutcome = OutcomeOf[RunWaitName];

/** The fields an outcome carries. */
export type PayloadField = "verdict" | "hold" | "revision" | "install" | "counts" | "unavailable";

/**
 * One link of a chain: when every condition holds, the wait ends with
 * `then`, carrying `with`; `go on` ends the chain with no outcome.
 */
export interface Rule {
  readonly when: readonly Condition[];
  readonly then: WaitOutcome["kind"] | "go on";
  /** The outcome's fields, read in this order before it ends. */
  readonly with: readonly PayloadField[];
}

/** A run wait's row. */
export interface RunWaitRow {
  /** The store a read opens: the worktree's, or none, where the lint read opens the lint store. */
  readonly store: "worktree" | "lint";
  /** The fields a read starts with, in the order the wait read them. */
  readonly reads: readonly ReadField[];
  /** The chain: the first rule whose conditions all hold ends the wait; with none, it goes on. */
  readonly rules: readonly Rule[];
}

const rule = (
  when: readonly Condition[],
  then: Rule["then"],
  ...fields: readonly PayloadField[]
): Rule => ({ when, then, with: fields });

/** The daemon check, last in every chain: a ping every `PING_POLLS` reads that no daemon hears. */
const GONE = rule(["ping due", "no daemon"], "stopped");

/**
 * Row 011-327 (decision 4 item 1), the status waits' rule (`waitForStatus`):
 * the worktree's store read through `withStatusStore`, its busy timeout
 * bounded by what is left and the full one at the deadline's read. A store
 * that does not open ends the wait with why; a busy one is read again, and
 * at the deadline's read ends it with why.
 */
const STORE: readonly Rule[] = [
  rule(["store unopened"], "unopened", "unavailable"),
  rule(["store busy", "late"], "unopened", "unavailable"),
  rule(["store busy"], "go on"),
];

/** The run waits' rows. */
export const RUN_WAITS: Readonly<Record<RunWaitName, RunWaitRow>> = {
  // `run --all --wait`: moved > abandoned > on hold > ended > deadline.
  checkpoint: {
    store: "worktree",
    reads: ["end", "revision", "late"],
    rules: [
      ...STORE,
      rule(["newer revision"], "moved", "revision"),
      rule(["abandoned"], "abandoned"),
      rule(["running", "before deadline", "held"], "on-hold", "hold"),
      rule(["completed", "verdict settled"], "ended", "verdict"),
      rule(["late"], "deadline", "verdict"),
      GONE,
    ],
  },
  // `run <group> [<path>...] --wait`: on hold > ended or deadline; the deadline names an install.
  group: {
    store: "worktree",
    reads: ["classes", "late"],
    rules: [
      ...STORE,
      rule(["files pending", "before deadline", "held"], "on-hold", "hold"),
      rule(["files settled"], "ended", "verdict"),
      rule(["late"], "deadline", "verdict", "install"),
      GONE,
    ],
  },
  // `run <lint group> --wait`: off or unread, then deadline > ended, then stopped.
  // Accidental: `late` before `nothing to lint`, so the deadline's last read gives no verdict.
  "lint group": {
    store: "lint",
    reads: ["counts", "late"],
    rules: [
      rule(["lint off"], "off"),
      rule(["lint unread"], "unread"),
      rule(["late"], "deadline", "counts"),
      rule(["nothing to lint"], "ended", "counts"),
      GONE,
    ],
  },
};

/** The answer types of the requests a run command waits for the daemon to take. */
export type RequestLoopName = "run-all" | "run-slow" | "run-group";

/** A request loop's row: `run-group` serves `run <group>`, its narrow run and a lint group. */
export interface RequestRow {
  /** Whose request id the status request names: the first answer's, or the last one's. */
  readonly askBy: "first" | "last";
  /** What an answer of another type, or one not `ok`, means: the daemon stopped, or it refused. */
  readonly wrong: "stopped" | "refused";
  /** The pause between status requests: 100 ms, or at most what is left before the deadline. */
  readonly pause: "fixed" | "to deadline";
}

/** The request loops' rows. */
export const REQUEST_LOOPS: Readonly<Record<RequestLoopName, RequestRow>> = {
  "run-all": { askBy: "first", wrong: "stopped", pause: "fixed" },
  "run-slow": { askBy: "last", wrong: "refused", pause: "fixed" },
  "run-group": { askBy: "last", wrong: "refused", pause: "to deadline" },
};
