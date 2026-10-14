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
}

/**
 * A host on `start`, which creates the worker; it runs on the first call,
 * never before (D4: not in the factory, which also runs without a session).
 *
 * Nothing it holds keeps Node alive past a call: the worker is unreferenced,
 * and a call's deadline timer is referenced only while that call is pending,
 * so `pi -p` waits for an unregistration at `session_shutdown` at most its
 * deadline and never after it.
 */
export function createDeliveryHost(start: () => Worker): DeliveryHost {
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

  /** Drops `dead` (when it is still the current worker) and silences its calls. */
  const discard = (dead: Worker) => {
    if (worker !== dead) return;
    worker = null;
    dead.terminate().catch(() => {});
    for (const id of [...pending.keys()]) settle(id, null);
  };

  const current = (): Worker | null => {
    if (worker !== null) return worker;
    const started = start();
    started.on("message", (message: FromWorker) => {
      if (worker === started) settle(message.id, message.ok ? message.answer : null);
    });
    started.on("error", () => discard(started));
    started.on("exit", () => discard(started));
    // A `messageerror` (an answer that does not deserialize) leaves its call to the deadline.
    started.on("messageerror", () => {});
    // After the listeners: a `message` listener refs the worker's port again.
    started.unref();
    worker = started;
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
          settle(id, null);
          discard(target);
        }, deadlineMs);
        // The worker answers a request with the answer of its kind (`handle`).
        pending.set(id, { resolve: resolve as Pending["resolve"], timer });
        try {
          target.postMessage({ id, request } satisfies ToWorker);
        } catch {
          settle(id, null);
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
        pending.set(id, { resolve: resolve as Pending["resolve"], timer: null });
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
          settle(id, null);
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
