import { describe, expect, it } from "vitest";
import {
  decideRequest,
  type RequestAnswer,
  type RequestRecord,
  type RequestStep,
} from "../../../src/cli/wait/decide.js";
import { BEFORE_DEADLINE } from "../../../src/cli/wait/socket.js";
import { REQUEST_LOOPS, type RequestLoopName } from "../../../src/cli/wait/table.js";
import type { DaemonResponse } from "../../../src/core/types/daemon.js";

/*
 * Row 011-326: the request loops' table as pure rows. One read in, its
 * answer and, once the answer leaves it open, the deadline; the decision
 * the loop calls out: read the clock, ask again, or end with an outcome.
 * Every outcome of each loop, and the order of its checks.
 */

/** An answer of a request loop's own type, or, by its `type`, of another. */
const answer = (fields: Record<string, unknown>) =>
  ({ schemaVersion: 1, ok: true, error: null, ...fields }) as unknown as RequestAnswer;
const group = (fields: Record<string, unknown> = {}) =>
  answer({
    type: "run-group",
    requestId: "g1",
    group: "e2e",
    requested: null,
    unknown: false,
    ...fields,
  });
const all = (fields: Record<string, unknown> = {}) =>
  answer({ type: "run-all", requestId: "r1", checkpoint: null, ...fields });
const slow = (fields: Record<string, unknown> = {}) =>
  answer({ type: "run-slow", requestId: "s1", requested: null, ...fields });
const refusal = (error: string) => ({ schemaVersion: 1, ok: false, error }) as DaemonResponse;
const QUEUED = { revision: 3, queued: 1 };

const end = (outcome: object): RequestStep => ({ kind: "end", outcome }) as RequestStep;
const read = (fields: Partial<RequestRecord> & Pick<RequestRecord, "answer">): RequestRecord => ({
  before: null,
  ...fields,
});

type Row = readonly [string, RequestLoopName, RequestRecord, RequestStep];

const ROWS: readonly Row[] = [
  [
    "taken: run-all names its checkpoint",
    "run-all",
    read({ answer: all({ checkpoint: { id: "c1" } }) }),
    end({ kind: "taken", answer: all({ checkpoint: { id: "c1" } }) }),
  ],
  [
    "taken: run-slow",
    "run-slow",
    read({ answer: slow({ requested: QUEUED }) }),
    end({ kind: "taken", answer: slow({ requested: QUEUED }) }),
  ],
  [
    "taken: run-group",
    "run-group",
    read({ answer: group({ requested: QUEUED }) }),
    end({ kind: "taken", answer: group({ requested: QUEUED }) }),
  ],
  [
    "taken beats an error",
    "run-group",
    read({ answer: group({ requested: QUEUED, error: "x" }) }),
    end({ kind: "taken", answer: group({ requested: QUEUED, error: "x" }) }),
  ],
  [
    "unknown group beats an error",
    "run-group",
    read({ answer: group({ unknown: true, error: "x" }) }),
    end({ kind: "unknown group", answer: group({ unknown: true, error: "x" }) }),
  ],
  [
    "failed: the answer's error",
    "run-slow",
    read({ answer: slow({ error: "no slow tier" }) }),
    end({ kind: "failed", error: "no slow tier" }),
  ],
  [
    "failed: run-all's error",
    "run-all",
    read({ answer: all({ error: "boom" }) }),
    end({ kind: "failed", error: "boom" }),
  ],
  [
    "unsupported: a daemon before the request",
    "run-group",
    read({ answer: refusal("unknown request type: run-group") }),
    end({ kind: "unsupported" }),
  ],
  [
    "refused: another answer type",
    "run-slow",
    read({ answer: answer({ type: "ping" }) }),
    end({ kind: "refused", error: "unexpected answer" }),
  ],
  [
    "refused: an answer not ok",
    "run-group",
    read({ answer: refusal("busy") }),
    end({ kind: "refused", error: "busy" }),
  ],
  [
    "stopped: run-all reads a wrong answer as a stopped daemon",
    "run-all",
    read({ answer: refusal("unknown request type") }),
    end({ kind: "stopped" }),
  ],
  [
    "stopped: no daemon listened",
    "run-slow",
    read({ answer: null, before: slow() }),
    end({ kind: "stopped" }),
  ],
  [
    "pending: the deadline cut the status request short",
    "run-group",
    read({ answer: { unanswered: BEFORE_DEADLINE }, before: group() }),
    end({ kind: "pending", answer: group() }),
  ],
  [
    "unanswered: the socket's 2 s bound",
    "run-group",
    read({ answer: { unanswered: " within 2 s" }, before: group() }),
    end({ kind: "unanswered", answer: group(), words: " within 2 s" }),
  ],
  [
    "the clock is read only once the answer leaves the request open",
    "run-group",
    read({ answer: group() }),
    { kind: "read late" },
  ],
  [
    "pending: the deadline passed (`now > deadline`)",
    "run-slow",
    read({ answer: slow(), late: true }),
    end({ kind: "pending", answer: slow() }),
  ],
  [
    "ask again before the deadline",
    "run-all",
    read({ answer: all(), late: false }),
    { kind: "ask", answer: all() },
  ],
];

describe("the request loops' table: pure rows (row 011-326)", () => {
  it.each(ROWS)("%s (%s)", (_name, loop, record, step) => {
    expect(decideRequest(loop, REQUEST_LOOPS[loop], record)).toEqual(step);
  });
});
