import type { Worker } from "node:worker_threads";
import type { FromWorker, PiAnswer, PiAnswers, PiRequest, ToWorker } from "./protocol.js";

/**
 * Spec 009 D4: the shared code runs in a worker thread the extension owns, so
 * a store read with its busy timeout never freezes Pi's main thread, and every
 * handler bounds itself, since Pi awaits handlers with no timeout.
 */
export interface DeliveryHost {
  /**
   * Posts `request` and resolves the worker's answer, or `null` when the worker
   * misses `deadlineMs`, dies, throws or cannot start, or the host is
   * stopped. Never rejects. After a miss or a death the worker is terminated
   * and the next call starts a fresh one.
   */
  call<R extends PiRequest>(request: R, deadlineMs: number): Promise<PiAnswers[R["kind"]] | null>;
  /**
   * Posts a `wait` (D5), which has no deadline: it answers when it has news,
   * and is `null` when cancelled, when the worker dies or is replaced, or
   * when the host stops. A pending wait holds no timer, so it never keeps
   * the process alive.
   */
  wait(request: Extract<PiRequest, { kind: "wait" }>): PendingWait;
  /** Terminates the worker and resolves every pending call `null`. Idempotent; later calls are `null`. */
  stop(): void;
}

/** A `wait` in flight. */
export interface PendingWait {
  readonly answer: Promise<string | null>;
  /** Resolves `answer` `null` at once and tells the worker to release the wait. Idempotent. */
  cancel(): void;
}

interface Pending {
  readonly resolve: (answer: PiAnswer | null) => void;
  readonly timer: NodeJS.Timeout | null;
  /** The verdict slot of the worker the call went to (row 011-288). */
  readonly slot: Int32Array;
}

/**
 * A host on `start`, which creates the worker; it runs on the first call,
 * never before (D4: not in the factory, which also runs without a session).
 *
 * Nothing it holds keeps Node alive past a call: the worker is unreferenced,
 * and a call's deadline timer is referenced only while that call is pending,
 * so `pi -p` waits for an unregistration at `session_shutdown` at most its
 * deadline and never after it.
 *
 * Row 011-288: `start` gets each worker's verdict slot, for its
 * `workerData.verdicts`. An answer marked `held` is committed when its call
 * is still pending as it arrives, and abandoned when the call was settled
 * first (a deadline, a cancel, a stop); a call settled `null` abandons a
 * held answer its worker is waiting with.
 */
export function createDeliveryHost(start: (verdicts: SharedArrayBuffer) => Worker): DeliveryHost {
  let worker: Worker | null = null;
  let stopped = false;
  let next = 1;
  const pending = new Map<number, Pending>();

  const settle = (id: number, answer: PiAnswer | null) => {
    const call = pending.get(id);
    if (call === undefined) return;
    pending.delete(id);
    if (call.timer !== null) clearTimeout(call.timer);
    call.resolve(answer);
  };

  /** Settles `id` silent; a held answer its worker waits with is abandoned. */
  const drop = (id: number) => {
    const call = pending.get(id);
    settle(id, null);
    if (call !== undefined) giveVerdict(call.slot, id, "abandon");
  };

  /** Drops `dead` (when it is still the current worker) and silences its calls. */
  const discard = (dead: Worker) => {
    if (worker !== dead) return;
    worker = null;
    for (const id of [...pending.keys()]) drop(id);
    dead.terminate().catch(() => {});
  };

  // The current worker's verdict slot; before the first, one no worker waits on.
  let slot = new Int32Array(verdictSlot());
  const current = (): Worker | null => {
    if (worker !== null) return worker;
    const verdicts = verdictSlot();
    const started = start(verdicts);
    const own = new Int32Array(verdicts);
    started.on("message", (message: FromWorker) => {
      const received = worker === started && pending.has(message.id);
      if (worker === started) settle(message.id, message.ok ? message.answer : null);
      if (message.ok && message.held === true) {
        giveVerdict(own, message.id, received ? "commit" : "abandon");
      }
    });
    started.on("error", () => discard(started));
    started.on("exit", () => discard(started));
    // A `messageerror` (an answer that does not deserialize) leaves its call to the deadline.
    started.on("messageerror", () => {});
    // After the listeners: a `message` listener refs the worker's port again.
    started.unref();
    worker = started;
    slot = own;
    return started;
  };

  return {
    call<R extends PiRequest>(request: R, deadlineMs: number) {
      if (stopped) return Promise.resolve(null);
      return new Promise<PiAnswers[R["kind"]] | null>((resolve) => {
        let target: Worker | null;
        try {
          target = current();
        } catch {
          target = null;
        }
        if (target === null) return resolve(null);
        const id = next++;
        const timer = setTimeout(() => {
          // One stalled request means the worker is wedged: every call on it goes silent.
          drop(id);
          discard(target);
        }, deadlineMs);
        // The worker answers a request with the answer of its kind (`handle`).
        pending.set(id, { resolve: resolve as Pending["resolve"], timer, slot });
        try {
          target.postMessage({ id, request } satisfies ToWorker);
        } catch {
          drop(id);
        }
      });
    },
    wait(request) {
      let on: Worker | null;
      try {
        on = stopped ? null : current();
      } catch {
        on = null;
      }
      if (on === null) return { answer: Promise.resolve(null), cancel() {} };
      const id = next++;
      const answer = new Promise<string | null>((resolve) => {
        pending.set(id, { resolve: resolve as Pending["resolve"], timer: null, slot });
      });
      try {
        on.postMessage({ id, request } satisfies ToWorker);
      } catch {
        settle(id, null);
      }
      return {
        answer,
        cancel() {
          if (!pending.has(id)) return;
          drop(id);
          try {
            on.postMessage({ cancel: id } satisfies ToWorker);
          } catch {
            // The worker is gone, and its wait with it.
          }
        },
      };
    },
    stop() {
      stopped = true;
      if (worker !== null) discard(worker);
    },
  };
}

/*
 * Row 011-288: the verdict on a held answer, between the Pi host and its
 * delivery worker. The worker answers a request whose report it prepared
 * with `held`, then blocks until the host writes the verdict into one shared
 * `Int32Array` slot: commit when the host received the answer while its call
 * was still pending, abandon when not. Blocked, the worker starts no other
 * write that would wait on its own lock. The slot holds the id it waits for,
 * shifted, and the verdict in its low bits, so a late verdict for another id
 * never lands. It lives here because this module imports nothing at run
 * time (`host-exit.test.ts` runs it alone); the worker imports `awaitVerdict`.
 */

const COMMIT = 1;
const ABANDON = 2;

export type Verdict = "commit" | "abandon";

/** A fresh slot, for one worker; passed to it as `workerData.verdicts`. */
export function verdictSlot(): SharedArrayBuffer {
  return new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
}

/** `id` as the slot holds it while the worker waits: never 0, never past int32. */
const waiting = (id: number) => (((id - 1) % 0x1fffffff) + 1) * 4;

/**
 * The worker's side: marks the slot as waiting for `id`, runs `post` (which
 * posts the held answer), and blocks until the verdict or `boundMs`; no
 * verdict in time is `abandon`.
 */
export function awaitVerdict(
  slot: Int32Array,
  id: number,
  boundMs: number,
  post: () => void,
): Verdict {
  const tag = waiting(id);
  Atomics.store(slot, 0, tag);
  try {
    post();
  } catch {
    Atomics.store(slot, 0, 0);
    return "abandon";
  }
  Atomics.wait(slot, 0, tag, boundMs);
  return Atomics.exchange(slot, 0, 0) === (tag | COMMIT) ? "commit" : "abandon";
}

/** The host's side: gives `id`'s verdict when the worker still waits for it, else nothing. */
export function giveVerdict(slot: Int32Array, id: number, verdict: Verdict): void {
  const tag = waiting(id);
  const value = tag | (verdict === "commit" ? COMMIT : ABANDON);
  if (Atomics.compareExchange(slot, 0, tag, value) === tag) Atomics.notify(slot, 0);
}
