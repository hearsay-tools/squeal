import type {
  DaemonResponse,
  RunAllResponse,
  RunGroupResponse,
  RunSlowResponse,
} from "../../core/types/daemon.js";
import { BEFORE_DEADLINE, type Unanswered } from "./socket.js";
import {
  type Condition,
  FIELD_OF,
  PING_POLLS,
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

const GO_ON: WaitStep = { kind: "go on" };

/**
 * The first rule of `row` whose conditions all hold ends the wait. A
 * condition on a field the record lacks asks for that field, so a wait reads
 * only what its chain reaches, in the chain's order; conditions after one
 * that fails are not read.
 */
export function decideRunWait(row: RunWaitRow, record: WaitRecord): WaitStep {
  for (const rule of row.rules) {
    const held = allHold(rule.when, record);
    if (held === false) continue;
    if (held !== true) return held;
    const missing = rule.with.find((field) => record[field] === undefined);
    if (missing !== undefined) return { kind: "read", field: missing };
    return { kind: "end", outcome: outcomeOf(rule, record), reason: rule.when };
  }
  return GO_ON;
}

function allHold(
  when: readonly Condition[],
  record: WaitRecord,
): boolean | Extract<WaitStep, { kind: "read" }> {
  for (const condition of when) {
    const field = FIELD_OF[condition];
    if (field !== "poll" && record[field] === undefined) return { kind: "read", field };
    if (!holds(condition, record)) return false;
  }
  return true;
}

function holds(condition: Condition, r: WaitRecord): boolean {
  switch (condition) {
    case "store unopened":
      return r.store === "unopened";
    case "newer revision":
      return r.since !== undefined && (r.revision ?? 0) > r.since;
    case "abandoned":
      return r.end === "abandoned";
    case "running":
      return r.end !== "completed";
    case "completed":
      return r.end === "completed";
    case "before deadline":
      return r.late === false;
    case "late":
      return r.late === true;
    case "held":
      return r.hold !== null && r.hold !== undefined;
    case "verdict settled":
      return r.verdict !== undefined && r.verdict.byClass.pending === 0 && !r.verdict.unlisted;
    case "files pending":
      return r.classes !== undefined && (r.classes.byClass.pending > 0 || r.classes.unlisted);
    case "files settled":
      return r.classes !== undefined && r.classes.byClass.pending === 0 && !r.classes.unlisted;
    case "lint off":
      return r.counts === "off";
    case "lint unread":
      return r.counts === "unread";
    case "nothing to lint":
      return typeof r.counts === "object" && r.counts.linting === 0;
    case "ping due":
      return r.poll % PING_POLLS === PING_POLLS - 1;
    case "no daemon":
      return r.daemon === "none";
  }
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
