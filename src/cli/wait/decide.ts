import type {
  DaemonResponse,
  RunAllResponse,
  RunGroupResponse,
  RunSlowResponse,
} from "../../core/types/daemon.js";
import { BEFORE_DEADLINE, type Unanswered } from "./socket.js";
import {
  STATUS_FIELD_OF,
  type StatusCondition,
  type StatusField,
  type StatusOutcome,
  type StatusRecord,
  type StatusRow,
} from "./status-table.js";
import {
  type Condition,
  FIELD_OF,
  type ReadField,
  type RequestLoopName,
  type RequestRow,
  type Rule,
  type RunWaitRow,
  type WaitOutcome,
  type WaitRecord,
} from "./table.js";

/*
 * Row 011-326 (`research/waits.md`, decision 3): the pure decisions. One
 * takes a run wait's row and one record of what a read found; one takes a
 * request loop's row and its last answer. Each answers: read this field
 * first, go on, or end with this outcome and this reason. The loops in
 * `wait.ts` read; these only decide.
 */

/** What a run wait does after one record: read a field, go on, or end. */
export type WaitStep =
  | { readonly kind: "read"; readonly field: ReadField }
  | { readonly kind: "go on" }
  | {
      readonly kind: "end";
      readonly outcome: WaitOutcome;
      /** The conditions that held: the rule that ended the wait. */
      readonly reason: readonly Condition[];
    };

const GO_ON = { kind: "go on" } as const;

/**
 * What a chain's conditions read and ask of a record: the field each reads,
 * and one flat predicate each. The run waits and the status waits each have
 * one (row 011-331); the walk is the same.
 */
interface Vocabulary<C extends string, R, F extends keyof R> {
  readonly fieldOf: Readonly<Record<C, F>>;
  readonly holds: Readonly<Record<C, (r: R) => boolean>>;
}

/** Where a walk stopped: a field to read first, the rule whose conditions all hold, or none. */
type Walked<L, F> =
  | { readonly kind: "read"; readonly field: F }
  | { readonly kind: "held"; readonly rule: L }
  | { readonly kind: "none" };

/**
 * The first rule of `rules` whose conditions all hold. A condition on a
 * field the record lacks asks for that field, so a wait reads only what
 * its chain reaches, in the chain's order; conditions after one that fails
 * are not read.
 */
function walk<C extends string, R, F extends keyof R, L extends { readonly when: readonly C[] }>(
  rules: readonly L[],
  record: R,
  vocabulary: Vocabulary<C, R, F>,
): Walked<L, F> {
  next: for (const rule of rules) {
    for (const condition of rule.when) {
      const field = vocabulary.fieldOf[condition];
      if (record[field] === undefined) return { kind: "read", field };
      if (!vocabulary.holds[condition](record)) continue next;
    }
    return { kind: "held", rule };
  }
  return { kind: "none" };
}

/**
 * The first rule of `row` whose conditions all hold ends the wait, with
 * the fields its outcome carries, read first when the record lacks one.
 */
export function decideRunWait(row: RunWaitRow, record: WaitRecord): WaitStep {
  const walked = walk(row.rules, record, RUN_VOCABULARY);
  if (walked.kind !== "held") return walked.kind === "read" ? walked : GO_ON;
  const { rule } = walked;
  if (rule.then === "go on") return GO_ON;
  const missing = rule.with.find((field) => record[field] === undefined);
  if (missing !== undefined) return { kind: "read", field: missing };
  return { kind: "end", outcome: outcomeOf(rule, record), reason: rule.when };
}

/** What each run-wait condition asks of a read record: one flat predicate each. */
const HOLDS: Readonly<Record<Condition, (r: WaitRecord) => boolean>> = {
  "store unopened": (r) => r.store === "unopened",
  "store busy": (r) => r.store === "busy",
  "newer revision": (r) => r.since !== undefined && (r.revision ?? 0) > r.since,
  abandoned: (r) => r.end === "abandoned",
  running: (r) => r.end !== "completed",
  completed: (r) => r.end === "completed",
  "before deadline": (r) => r.late === false,
  late: (r) => r.late === true,
  held: (r) => r.hold !== null && r.hold !== undefined,
  "verdict settled": (r) =>
    r.verdict !== undefined && r.verdict.byClass.pending === 0 && !r.verdict.unlisted,
  "files pending": (r) =>
    r.classes !== undefined && (r.classes.byClass.pending > 0 || r.classes.unlisted),
  "files settled": (r) =>
    r.classes !== undefined && r.classes.byClass.pending === 0 && !r.classes.unlisted,
  "lint off": (r) => r.counts === "off",
  "lint unread": (r) => r.counts === "unread",
  "lint busy": (r) => r.counts === "busy",
  "nothing to lint": (r) => typeof r.counts === "object" && r.counts.linting === 0,
  "daemon down": (r) => r.daemon?.state === "down",
};

const RUN_VOCABULARY: Vocabulary<Condition, WaitRecord, ReadField> = {
  fieldOf: FIELD_OF,
  holds: HOLDS,
};

/** What a status wait does after one record: read a field, go on, or end. */
export type StatusStep =
  | { readonly kind: "read"; readonly field: StatusField }
  | { readonly kind: "go on" }
  | {
      readonly kind: "end";
      readonly outcome: StatusOutcome;
      /** The conditions that held: the rule that ended the wait. */
      readonly reason: readonly StatusCondition[];
    };

/** What each status-wait condition asks of a read record. */
const STATUS_HOLDS: Readonly<Record<StatusCondition, (r: StatusRecord) => boolean>> = {
  "store unread": (r) => r.store === "unread",
  "first read": (r) => r.first === true,
  late: (r) => r.late === true,
  settled: (r) => r.settled === true,
  "daemon down": (r) => r.daemon === "down",
  news: (r) => (r.news ?? 0) > 0,
  quiet: (r) => r.quiet === true,
  "decided settled": (r) => r.decided === "settled",
  "decided focused": (r) => r.decided === "focused",
  "decided unmatched": (r) => r.decided === "unmatched",
  "decided slow": (r) => r.decided === "slow",
  held: (r) => r.hold !== null && r.hold !== undefined,
};

const STATUS_VOCABULARY: Vocabulary<StatusCondition, StatusRecord, StatusField> = {
  fieldOf: STATUS_FIELD_OF,
  holds: STATUS_HOLDS,
};

/**
 * Row 011-331: a status wait's decision, the run waits' walk over its row.
 * The first rule whose conditions all hold ends the wait with its outcome;
 * the read that ends it builds what the wait returns, as before the move.
 */
export function decideStatusWait(row: StatusRow, record: StatusRecord): StatusStep {
  const walked = walk(row.rules, record, STATUS_VOCABULARY);
  if (walked.kind !== "held") return walked.kind === "read" ? walked : GO_ON;
  const { rule } = walked;
  return rule.then === "go on" ? GO_ON : { kind: "end", outcome: rule.then, reason: rule.when };
}

/** The rule's outcome with its fields; an `install` of `null` is left out, as no install wait. */
function outcomeOf(rule: Rule, record: WaitRecord): WaitOutcome {
  const fields: Record<string, unknown> = {};
  for (const field of rule.with) {
    const value = record[field];
    if (value !== null) fields[field] = value;
  }
  // The table pairs each outcome with the fields its type carries; the table test checks each.
  return { kind: rule.then, ...fields } as WaitOutcome;
}

/** The answer a request loop waits on, by its type. */
export interface AnswerOf {
  readonly "run-all": RunAllResponse;
  readonly "run-slow": RunSlowResponse;
  readonly "run-group": RunGroupResponse;
}

export type RequestAnswer = AnswerOf[RequestLoopName];

/** One read of a request loop: its last answer, and the deadline once the answer leaves it open. */
export interface RequestRecord {
  /** The first answer, then each status request's: `null` when no daemon listened. */
  readonly answer: DaemonResponse | null | Unanswered;
  /** The last answer of the loop's own type before `answer`: the request the deadline leaves pending. */
  readonly before: RequestAnswer | null;
  /** The deadline passed at this read (`now > deadline`). */
  readonly late?: boolean;
}

/** How a request loop ended; the command words each as before. */
export type RequestOutcome<A extends RequestAnswer = RequestAnswer> =
  /** The scheduler took the request: `requested`, or `checkpoint` for `run-all`, is set. */
  | { readonly kind: "taken"; readonly answer: A }
  /** The deadline passed first: the request's last answer. */
  | { readonly kind: "pending"; readonly answer: A }
  /** The daemon does not know the request ("unknown request type"). */
  | { readonly kind: "unsupported" }
  /** An answer not `ok`, or of another type ("unexpected answer"). */
  | { readonly kind: "refused"; readonly error: string }
  /** The answer's own `error`. */
  | { readonly kind: "failed"; readonly error: string }
  /** The daemon's policy has no group of the request's name (`run-group` only). */
  | { readonly kind: "unknown group"; readonly answer: A }
  | { readonly kind: "stopped" }
  /** A status request the socket gave no answer to, other than by the deadline: the words after "did not answer". */
  | { readonly kind: "unanswered"; readonly answer: A; readonly words: string };

/** What a request loop does after one read: read the clock, ask again with this answer's id, or end. */
export type RequestStep =
  | { readonly kind: "read late" }
  | { readonly kind: "ask"; readonly answer: RequestAnswer }
  | { readonly kind: "end"; readonly outcome: RequestOutcome };

/**
 * The checks every request loop made in this order: no daemon, no answer, a
 * wrong answer, taken, an unknown group, an error, the deadline (`>`).
 */
export function decideRequest(
  loop: RequestLoopName,
  row: RequestRow,
  record: RequestRecord,
): RequestStep {
  const end = (outcome: RequestOutcome): RequestStep => ({ kind: "end", outcome });
  const { answer, before } = record;
  if (answer === null) return end({ kind: "stopped" });
  if ("unanswered" in answer) {
    // An unanswered read comes only after an answer of the loop's type: `before` is set.
    const last = before as RequestAnswer;
    if (answer.unanswered === BEFORE_DEADLINE) return end({ kind: "pending", answer: last });
    return end({ kind: "unanswered", answer: last, words: answer.unanswered });
  }
  if (!answer.ok || answer.type !== loop) {
    if (row.wrong === "stopped") return end({ kind: "stopped" });
    const error = answer.ok ? "unexpected answer" : answer.error;
    return end(
      error.startsWith("unknown request type")
        ? { kind: "unsupported" }
        : { kind: "refused", error },
    );
  }
  const own = answer as RequestAnswer;
  if (own.type === "run-all" ? own.checkpoint !== null : own.requested !== null) {
    return end({ kind: "taken", answer: own });
  }
  if (own.type === "run-group" && own.unknown) return end({ kind: "unknown group", answer: own });
  if (own.error !== null) return end({ kind: "failed", error: own.error });
  if (record.late === undefined) return { kind: "read late" };
  return record.late ? end({ kind: "pending", answer: own }) : { kind: "ask", answer: own };
}
