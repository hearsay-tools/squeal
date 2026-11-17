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

/** `serve` on a port whose host commits each held answer but the start's, which gets `atStart`'s verdict. */
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
  return (request: PiRequest): Promise<FromWorker> => {
    const id = next++;
    const answer = new Promise<FromWorker>((resolve) => answers.set(id, resolve));
    for (const listener of listeners) listener({ id, request });
    return answer;
  };
}

const count = (text: unknown) => (typeof text === "string" ? text.split(HEADER).length - 1 : 0);

const newsOf = (answer: FromWorker) =>
  answer.ok ? (answer.answer as { news: string | null }).news : null;

async function servedRepo(): Promise<{ r: SquealRepo; daemon: ServedWrites }> {
  const r = squealRepo();
  r.apply(r.fail());
  const daemon = await serveWrites(r);
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
