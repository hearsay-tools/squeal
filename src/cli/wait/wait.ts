import type { AbsolutePath } from "../../core/types/common.js";
import type { DaemonRequest } from "../../core/types/daemon.js";
import type { Store } from "../../core/types/store.js";
import {
  type AnswerOf,
  decideRequest,
  decideRunWait,
  type RequestAnswer,
  type RequestOutcome,
  type RequestRecord,
  type WaitStep,
} from "./decide.js";
import { type FieldReader, inStore, type RunWaitAsk, waitReads } from "./reads.js";
import { askWithin, REAL_PORTS, type WaitPorts } from "./socket.js";
import {
  type OutcomeOf,
  REQUEST_LOOPS,
  type RequestLoopName,
  RUN_WAITS,
  type RunWaitRow,
  type WaitRecord,
} from "./table.js";

/*
 * Row 011-326 (`research/waits.md`, decisions 1 and 3): the entry of the
 * wait module. `runWait` runs a run wait by name, `untilTaken` waits for the
 * daemon to take a request; one polling loop each owns the reads, the
 * clock, the socket and the daemon check, and asks `decide.ts` what each
 * read means. A command asks with plain data and words the outcome.
 */

/** How often a run wait reads the store (C6 as amended, task 011-42). */
const STORE_POLL_MS = 1_000;
/** How often a request loop asks whether the daemon took the request. */
const REQUEST_POLL_MS = 100;

/**
 * Reads the store once a second until the wait's row ends it: its outcome,
 * one of today's for that wait. Each read opens the store, fills the fields
 * the row's chain reaches and closes it; then the daemon check, when it is
 * due, and the pause, which ends by the deadline.
 */
export async function runWait<A extends RunWaitAsk>(
  ask: A,
  ports: WaitPorts = REAL_PORTS,
): Promise<OutcomeOf[A["wait"]]> {
  const row = RUN_WAITS[ask.wait];
  const reads = waitReads(ask, ports.now);
  const since = ask.wait === "checkpoint" ? { since: ask.checkpoint.revision } : {};
  for (let poll = 0; ; poll++) {
    const given: WaitRecord = { poll, ...since };
    let [record, step] =
      row.store === "lint"
        ? settle(row, given, reads(null))
        : (inStore(ask.root, (store: Store) =>
            settle(row, { ...given, store: "opened" }, reads(store)),
          ) ?? unopened(row, given));
    if (step.kind === "read") {
      // Only the daemon check is left once the store closed: `settle` reads every other field.
      record = { ...record, daemon: await daemonCheck(row, ask, ports) };
      step = decideRunWait(row, record);
      if (step.kind === "read")
        throw new Error(`run wait ${ask.wait}: no field after the daemon's`);
    }
    // The row's outcomes are the wait's: `RUN_WAITS` gives each wait its own.
    if (step.kind === "end") return step.outcome as OutcomeOf[A["wait"]];
    await ports.pause(Math.max(0, Math.min(STORE_POLL_MS, ask.deadline - ports.now())));
  }
}

/** One read: the row's first fields in order, then each field the decision asks for, but the daemon's. */
function settle(row: RunWaitRow, given: WaitRecord, read: FieldReader): [WaitRecord, WaitStep] {
  let record = given;
  for (const field of row.reads) {
    if (field !== "store" && field !== "daemon") record = { ...record, ...read(field) };
  }
  for (;;) {
    const step = decideRunWait(row, record);
    if (step.kind !== "read" || step.field === "daemon") return [record, step];
    if (step.field === "store") throw new Error("run wait: the loop gives the store field");
    record = { ...record, ...read(step.field) };
  }
}

/** A read whose store did not open: no field is read. */
function unopened(row: RunWaitRow, given: WaitRecord): [WaitRecord, WaitStep] {
  const record: WaitRecord = { ...given, store: "unopened" };
  return [record, decideRunWait(row, record)];
}

/** The daemon check: a ping, bounded by the row's socket cell. */
async function daemonCheck(
  row: RunWaitRow,
  ask: RunWaitAsk,
  ports: WaitPorts,
): Promise<NonNullable<WaitRecord["daemon"]>> {
  const ping = { type: "ping" } as const;
  if (row.socket === "unbounded") {
    return (await ports.ask(ask.socketPath, ping)) === null ? "none" : "answered";
  }
  const pong = await askWithin(ask.socketPath, ping, ask.deadline, ports);
  if (pong === null) return "none";
  return "unanswered" in pong ? "unanswered" : "answered";
}

/** A request a command waits for the daemon to take. */
export interface RequestAsk<L extends RequestLoopName> {
  /** The type of the request's answers. */
  readonly loop: L;
  readonly socketPath: AbsolutePath;
  /** The answer to the request itself. */
  readonly first: RequestRecord["answer"];
  /** Epoch ms; `Infinity` for a bare `--wait`. */
  readonly deadline: number;
}

/**
 * Asks the request's status until the scheduler took it, it failed, or the
 * deadline passed: its outcome, which the command words as before. The
 * row's cells bound each socket request and pause.
 */
export async function untilTaken<L extends RequestLoopName>(
  ask: RequestAsk<L>,
  ports: WaitPorts = REAL_PORTS,
): Promise<RequestOutcome<AnswerOf[L]>> {
  const row = REQUEST_LOOPS[ask.loop];
  let record: RequestRecord = { answer: ask.first, before: null };
  let first: RequestAnswer | null = null;
  for (;;) {
    let step = decideRequest(ask.loop, row, record);
    if (step.kind === "read late") {
      step = decideRequest(ask.loop, row, { ...record, late: ports.now() > ask.deadline });
    }
    // An outcome's answer is the loop's own type, which `decideRequest` checked.
    if (step.kind === "end") return step.outcome as RequestOutcome<AnswerOf[L]>;
    if (step.kind !== "ask") throw new Error("request loop: the clock was read once");
    first ??= step.answer;
    await ports.pause(
      row.pause === "fixed"
        ? REQUEST_POLL_MS
        : Math.max(0, Math.min(REQUEST_POLL_MS, ask.deadline - ports.now())),
    );
    const request = statusRequest(
      ask.loop,
      (row.askBy === "first" ? first : step.answer).requestId,
    );
    const answer =
      row.socket === "unbounded"
        ? await ports.ask(ask.socketPath, request)
        : await askWithin(ask.socketPath, request, ask.deadline, ports);
    record = { answer, before: step.answer };
  }
}

function statusRequest(loop: RequestLoopName, requestId: string): DaemonRequest {
  switch (loop) {
    case "run-all":
      return { type: "run-all-status", requestId };
    case "run-slow":
      return { type: "run-slow-status", requestId };
    case "run-group":
      return { type: "run-group-status", requestId };
  }
}
