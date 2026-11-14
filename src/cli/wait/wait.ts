import { type StatusContext, withStatusStore } from "../../core/status/open.js";
import type { AbsolutePath } from "../../core/types/common.js";
import type { DaemonRequest } from "../../core/types/daemon.js";
import type { StatusUnavailable } from "../../core/types/status.js";
import type { Store } from "../../core/types/store.js";
import { type DaemonSync, pollPause, syncDaemon } from "../status-sync.js";
import {
  type AnswerOf,
  decideRequest,
  decideRunWait,
  decideStatusWait,
  type RequestAnswer,
  type RequestOutcome,
  type RequestRecord,
  type WaitStep,
} from "./decide.js";
import { namedPoll } from "./named.js";
import type { NamedSnapshotOptions, NamedWait, NamedWaitOptions } from "./named-types.js";
import { readBound } from "./presence.js";
import { type FieldReader, type RunWaitAsk, unavailableText, waitReads } from "./reads.js";
import { namedSnapshot } from "./snapshot.js";
import { askWithin, REAL_PORTS, type WaitPorts } from "./socket.js";
import { editPoll, type StatusWait, type StatusWaitOptions } from "./status.js";
import { SETTLE_MS, STATUS_POLL_MS, STATUS_WAITS } from "./status-table.js";
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

/** How often a run wait reads the store, as a status wait (C6 as amended, task 011-42). */
const STORE_POLL_MS = STATUS_POLL_MS;
/** How often a request loop asks whether the daemon took the request. */
const REQUEST_POLL_MS = 100;

/**
 * Reads the store once a second until the wait's row ends it: its outcome,
 * one of that wait's. Each read opens the store, fills the fields the row's
 * chain reaches, the daemon's presence last (row 011-327), and closes it;
 * then the pause, which ends by the deadline.
 */
export async function runWait<A extends RunWaitAsk>(
  ask: A,
  ports: WaitPorts = REAL_PORTS,
): Promise<OutcomeOf[A["wait"]]> {
  const row = RUN_WAITS[ask.wait];
  const reads = waitReads(ask, ports);
  const given: WaitRecord = ask.wait === "checkpoint" ? { since: ask.checkpoint.revision } : {};
  for (;;) {
    const step =
      row.store === "lint"
        ? settle(row, given, reads(null))
        : worktreeRead(row, ask, given, reads, ports);
    // The row's outcomes are the wait's: `RUN_WAITS` gives each wait its own.
    if (step.kind === "end") return step.outcome as OutcomeOf[A["wait"]];
    await ports.pause(Math.max(0, Math.min(STORE_POLL_MS, ask.deadline - ports.now())));
  }
}

/** One read: the row's first fields in order, then each field the decision asks for. */
function settle(row: RunWaitRow, given: WaitRecord, read: FieldReader): EndedStep {
  let record = given;
  for (const field of row.reads) {
    // A busy lint read gives `late` with its counts: whether the deadline had passed when it began.
    if (field !== "store" && field !== "unavailable" && record[field] === undefined) {
      record = { ...record, ...read(field) };
    }
  }
  for (;;) {
    const step = decideRunWait(row, record);
    if (step.kind !== "read") return step;
    if (step.field === "store" || step.field === "unavailable") {
      throw new Error(`run wait: the loop gives the ${step.field} field`);
    }
    record = { ...record, ...read(step.field) };
  }
}

/** A read's step once it read what its chain reached: go on, or end. */
type EndedStep = Exclude<WaitStep, { kind: "read" }>;

/**
 * Row 011-327 (decision 4 item 1): one read of the worktree's store as the
 * status waits read it (`waitForStatus`): in one read transaction, its busy
 * timeout bounded by what is left before the deadline, the deadline's read
 * waiting the full `STATUS_BUSY_TIMEOUT_MS` (`readBound`). A store not read
 * fills no field but why, and, when busy, whether the read was the
 * deadline's.
 */
function worktreeRead(
  row: RunWaitRow,
  ask: RunWaitAsk,
  given: WaitRecord,
  reads: (store: Store) => FieldReader,
  ports: WaitPorts,
): EndedStep {
  const { busyTimeoutMs, final } = readBound(ask.deadline, ports.now);
  const read = withStatusStore(ask.root, { busyTimeoutMs }, ({ store }) =>
    settle(row, { ...given, store: "opened" }, reads(store)),
  );
  if (!("available" in read)) return read;
  const busy = read.reason === "timeout";
  const record: WaitRecord = {
    ...given,
    store: busy ? "busy" : "unopened",
    unavailable: unavailableText(read),
    ...(busy ? { late: final } : {}),
  };
  const step = decideRunWait(row, record);
  if (step.kind === "read")
    throw new Error(`run wait ${ask.wait}: an unread store has no ${step.field}`);
  return step;
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
 * deadline passed: its outcome, which the command words. Each socket
 * request ends by the deadline (row 011-327); the row's cell bounds the pause.
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
    const answer = await askWithin(ask.socketPath, request, ask.deadline, ports);
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

/**
 * Row 011-331: a status wait by name with its data (the options keep their
 * test seams: the sync, the clock, the promotion, the focus and the asks).
 */
export type StatusWaitAsk =
  | { readonly wait: "edit"; readonly cwd: AbsolutePath; readonly options: StatusWaitOptions }
  | {
      readonly wait: "named";
      readonly cwd: AbsolutePath;
      readonly paths: readonly string[];
      readonly options: NamedWaitOptions;
    }
  | {
      readonly wait: "snapshot";
      readonly cwd: AbsolutePath;
      readonly paths: readonly string[];
      readonly options: NamedSnapshotOptions;
    };

/**
 * Row 011-331: runs a status wait by name; the commands word what it
 * returns as before. The edit and named waits poll the store (`pollStatus`);
 * the snapshot reads it once, after its sync or the settle time.
 */
export function statusWait(ask: Extract<StatusWaitAsk, { wait: "edit" }>): Promise<StatusWait>;
export function statusWait(
  ask: Extract<StatusWaitAsk, { wait: "named" | "snapshot" }>,
): Promise<NamedWait>;
export async function statusWait(ask: StatusWaitAsk): Promise<StatusWait | NamedWait> {
  switch (ask.wait) {
    case "edit": {
      const { options } = ask;
      const pollMs = options.pollMs ?? STATUS_POLL_MS;
      const settleMs = options.settleMs ?? SETTLE_MS;
      const sync = options.sync ?? syncDaemon;
      const poll = editPoll({ ...options, pollMs, settleMs, sync });
      const read = await pollStatus(ask.cwd, options.timeoutMs, pollMs, poll);
      return "end" in read ? { ...read.end, waitedMs: read.waitedMs } : read;
    }
    case "named": {
      const { options } = ask;
      const poll = namedPoll(ask.cwd, ask.paths, options);
      const read = await pollStatus(ask.cwd, options.timeoutMs, options.pollMs, poll);
      if (!("end" in read)) return read;
      return { ...read.end, waitedMs: read.waitedMs, timeoutMs: options.timeoutMs };
    }
    case "snapshot":
      return namedSnapshot(ask.cwd, ask.paths, ask.options);
  }
}

/** One read of an edit or named wait: its end, go on (`null`), or an act before the next read. */
export type PollStep<T> = { readonly end: T } | { readonly act: () => Promise<void> } | null;

/** An edit or named wait's reads, which keep their own state between reads. */
export interface StatusPoll<T> {
  readonly name: "edit" | "named";
  /** No read decided yet, by the wait's own reckoning; by default, no read went on. */
  readonly first?: () => boolean;
  /** The wait's sync once a read started it: a pause ends at its answer. */
  readonly sync: () => DaemonSync | undefined;
  /** One read in the store's read transaction; `final`, the deadline's. */
  readonly read: (context: StatusContext, final: boolean, elapsed: () => number) => PollStep<T>;
}

/** A status wait that ended on a store it did not read. */
export interface UnavailableEnd {
  readonly outcome: "unavailable";
  readonly waitedMs: number;
  readonly result: StatusUnavailable;
}

/**
 * Row 011-331: the one polling loop of the edit and named waits. Each read
 * opens the store in one read transaction, its busy timeout bounded by
 * what is left before the deadline and the deadline's read waiting the
 * full one (`readBound`, as the run waits); the read decides by its row. A
 * read that did not read the store is decided by the row's store rules: the
 * first or the deadline's ends the wait, one between is skipped. An act
 * (`named`: ask runs, or a usage error) runs before the next read, with no
 * pause. The pause ends by the deadline, or at the sync's answer.
 */
export async function pollStatus<T>(
  cwd: AbsolutePath,
  timeoutMs: number,
  pollMs: number,
  poll: StatusPoll<T>,
): Promise<{ readonly end: T; readonly waitedMs: number } | UnavailableEnd> {
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const row = STATUS_WAITS[poll.name];
  let wentOn = false;
  try {
    for (;;) {
      // The read at the deadline decides with what it finds and waits the full busy timeout.
      const { busyTimeoutMs, final } = readBound(timeoutMs, elapsed);
      const read = withStatusStore(cwd, { busyTimeoutMs }, (context) =>
        poll.read(context, final, elapsed),
      );
      if (read !== null && "available" in read) {
        const first = poll.first?.() ?? !wentOn;
        const step = decideStatusWait(row, { store: "unread", first, late: final });
        if (step.kind === "end")
          return { outcome: "unavailable", waitedMs: elapsed(), result: read };
      } else if (read !== null && "act" in read) {
        await read.act();
        continue;
      } else if (read !== null) {
        return { end: read.end, waitedMs: elapsed() };
      }
      wentOn = true;
      const remaining = timeoutMs - elapsed();
      if (remaining > 0) await pollPause(Math.min(pollMs, remaining), poll.sync());
    }
  } finally {
    poll.sync()?.stop();
  }
}
