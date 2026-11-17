import type { MessagePort } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { owedRegistration } from "../../../src/core/delivery/registration-owed.js";
import { giveVerdict, type Verdict, verdictSlot } from "../../../src/harness/pi/host.js";
import type { FromWorker, PiRequest, ToWorker } from "../../../src/harness/pi/protocol.js";
import { serve } from "../../../src/harness/pi/worker.js";
import { type ServedWrites, serveWrites } from "../daemon-writes-helpers.js";
import { SESSION, type SquealRepo, squealRepo } from "../helpers.js";

/*
 * Row 005-107 (main CI 44114276401, `test/e2e/pi.test.ts:116`): a Pi print session read its
 * registration header twice in its first request. With a daemon serving the store (spec 021
 * D15), the session start's last write, the clear of the owed header, is sent to the daemon
 * at the host's commit verdict. The host has the answer by then, so Pi starts the run, whose
 * request the worker served at once: it read the header still owed and said it again. The
 * worker now starts a request only once the daemon wrote what the verdict before it sent.
 *
 * `serve` runs in this thread: the port gives the commit verdict as the held answer is posted,
 * so the worker's wait for it returns at once, as it does when the host answers in time.
 */

const HEADER = "registered at revision";
const deps = { env: {}, ensureDaemon: async () => "alive" as const };

const served: ServedWrites[] = [];
afterEach(async () => {
  for (const daemon of served.splice(0)) {
    daemon.release();
    await daemon.close();
  }
});

/**
 * `serve` on a port whose host commits each held answer but the start's, which gets `atStart`'s
 * verdict; `cancel` cancels a request's `wait`.
 */
function worker(atStart: () => Verdict) {
  const verdicts = verdictSlot();
  const slot = new Int32Array(verdicts);
  const listeners: ((message: ToWorker) => void)[] = [];
  const answers = new Map<number, (message: FromWorker) => void>();
  const port = {
    on: (_event: string, listener: (message: ToWorker) => void) => listeners.push(listener),
    postMessage: (message: FromWorker) => {
      if (message.ok && message.held === true) {
        giveVerdict(slot, message.id, message.id === 1 ? atStart() : "commit");
      }
      answers.get(message.id)?.(message);
    },
  } as unknown as MessagePort;
  serve(port, deps, verdicts);
  let next = 1;
  const ask = (request: PiRequest): Promise<FromWorker> => {
    const id = next++;
    const answer = new Promise<FromWorker>((resolve) => answers.set(id, resolve));
    for (const listener of listeners) listener({ id, request });
    return answer;
  };
  const cancel = (id: number) => {
    for (const listener of listeners) listener({ cancel: id });
  };
  return Object.assign(ask, { cancel });
}

const count = (text: unknown) => (typeof text === "string" ? text.split(HEADER).length - 1 : 0);

const newsOf = (answer: FromWorker) =>
  answer.ok ? (answer.answer as { news: string | null }).news : null;

async function servedRepo(freezable = false): Promise<{ r: SquealRepo; daemon: ServedWrites }> {
  const r = squealRepo();
  r.apply(r.fail());
  const daemon = await serveWrites(r, { freezable });
  served.push(daemon);
  return { r, daemon };
}

describe("Pi: a session start's header with a daemon serving the store (row 005-107)", () => {
  it("the run Pi starts right after it does not say the header again", async () => {
    const { r, daemon } = await servedRepo();
    // The commit's batch waits at the daemon, as one the daemon has not written yet.
    const ask = worker(() => {
      daemon.pause();
      return "commit";
    });
    const session = { sessionId: SESSION, cwd: r.root };
    const start = await ask({ kind: "start", reason: "startup", ...session });
    expect(start.ok && count(start.answer)).toBe(1);
    // Pi awaits `session_start`, then starts the run: the worker has its request at once.
    const run = ask({ kind: "run", ...session });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(daemon.held()).toHaveLength(1);
    daemon.release();
    const answer = await run;
    expect(answer.ok).toBe(true);
    expect(count(newsOf(answer))).toBe(0);
    expect(owedRegistration(r.store, r.consumer())).toBeNull();
  }, 30_000);

  it("a start whose answer the host lost leaves the header owed: the run says it once", async () => {
    const { r } = await servedRepo();
    // The host's call was settled first (a deadline): it abandons the held answer.
    const ask = worker(() => "abandon");
    const session = { sessionId: SESSION, cwd: r.root };
    await ask({ kind: "start", reason: "startup", ...session });
    expect(count(newsOf(await ask({ kind: "run", ...session })))).toBe(1);
    expect(count(newsOf(await ask({ kind: "run", ...session })))).toBe(0);
  }, 30_000);
});

/*
 * Review 0.1.546 B1: the daemon never writes the start's clear (it froze at the verdict). The
 * write's bound passes, the worker's gate opens, and the store still owes the header. The host
 * has the text: the same worker does not say it again, within the event's deadline. A new
 * worker, as after a killed start, does not know it was handed and says it once.
 */
describe("Pi: a start whose clear the daemon never writes (review 0.1.546 B1)", () => {
  const EVENT_DEADLINE_MS = 2_000;
  const frozen = async () => {
    const { r, daemon } = await servedRepo(true);
    const ask = worker(() => {
      daemon.freeze();
      return "commit";
    });
    const session = { sessionId: SESSION, cwd: r.root };
    const start = await ask({ kind: "start", reason: "startup", ...session });
    expect(start.ok && count(start.answer)).toBe(1);
    return { r, daemon, ask, session };
  };
  const timed = async (answer: Promise<FromWorker>) => {
    const from = performance.now();
    const result = await answer;
    expect(performance.now() - from).toBeLessThan(EVENT_DEADLINE_MS);
    return result;
  };

  it("the next run does not say the header again, nor does a tool boundary after it", async () => {
    const { r, daemon, ask, session } = await frozen();
    const run = await timed(ask({ kind: "run", ...session }));
    expect(run.ok).toBe(true);
    expect(count(newsOf(run))).toBe(0);
    const boundary = await timed(ask({ kind: "boundary", edited: false, ...session }));
    expect(boundary.ok && count(boundary.answer)).toBe(0);
    daemon.thaw();
    expect(count(newsOf(await ask({ kind: "run", ...session })))).toBe(0);
    expect(owedRegistration(r.store, r.consumer())).toBeNull();
  }, 30_000);

  it("a tool boundary next does not say it either", async () => {
    const { ask, session } = await frozen();
    const boundary = await timed(ask({ kind: "boundary", edited: true, ...session }));
    expect(boundary.ok && count(boundary.answer)).toBe(0);
    expect(count(newsOf(await timed(ask({ kind: "run", ...session }))))).toBe(0);
  }, 30_000);

  it("an idle wait asked while the clear is pending ends at its cancel", async () => {
    const { ask, session } = await frozen();
    const wait = ask({ kind: "wait", ...session });
    ask.cancel(2);
    const answer = await timed(wait);
    expect(answer).toEqual({ id: 2, ok: true, answer: null });
    expect(count(newsOf(await ask({ kind: "run", ...session })))).toBe(0);
  }, 30_000);

  it("a new worker, as after a killed start, says the header once", async () => {
    const { r, session } = await frozen();
    // The start's worker would have written the clear again at its next request.
    const next = worker(() => "commit");
    expect(count(newsOf(await timed(next({ kind: "run", ...session }))))).toBe(1);
    expect(count(newsOf(await next({ kind: "run", ...session })))).toBe(0);
    expect(owedRegistration(r.store, r.consumer())).toBeNull();
  }, 30_000);
});
