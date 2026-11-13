import { setTimeout as sleep } from "node:timers/promises";
import type { AbsolutePath } from "../../core/types/common.js";
import type { DaemonRequest, DaemonResponse } from "../../core/types/daemon.js";
import { askDaemon, CLI_SOCKET_TIMEOUT_MS } from "../daemon-access.js";

/*
 * Row 011-326: the ports a wait's loop reads through, the clock and the
 * socket, each with its production adapter here; a test gives a stepped
 * clock. The store stays the real one: a test gives a scratch store.
 */

/** The clock and the socket of a wait. */
export interface WaitPorts {
  /** Epoch ms, as `Date.now`. */
  readonly now: () => number;
  /** Resolves after `ms`, as `setTimeout`. */
  readonly pause: (ms: number) => Promise<void>;
  /** `askDaemon`: the answer, `null` when no daemon listens; a timeout or another error throws. */
  readonly ask: (
    socketPath: AbsolutePath,
    request: DaemonRequest,
    timeoutMs?: number,
  ) => Promise<DaemonResponse | null>;
}

export const REAL_PORTS: WaitPorts = {
  now: () => Date.now(),
  pause: async (ms) => {
    await sleep(ms);
  },
  ask: (socketPath, request, timeoutMs) => askDaemon(socketPath, request, timeoutMs),
};

/** The least a socket request at the deadline waits, so a daemon that answers at once is heard. */
const SOCKET_FLOOR_MS = 50;

/**
 * Row 019-24 item 3 (review 0.1.397 S1): how long a socket request of
 * `run <group>` may wait for its answer, what is left before `deadline`
 * (epoch ms; `Infinity` for a bare `--wait`), at most the CLI's bound and
 * at least `SOCKET_FLOOR_MS`.
 */
export function socketBound(deadline: number, now: () => number = REAL_PORTS.now): number {
  return Math.max(SOCKET_FLOOR_MS, Math.min(CLI_SOCKET_TIMEOUT_MS, deadline - now()));
}

/** `askWithin`'s words when the deadline bounded the request: what is left of the wait ran out. */
export const BEFORE_DEADLINE = " before the deadline";

/** A socket request with no answer: the words that follow "the daemon did not answer …". */
export interface Unanswered {
  readonly unanswered: string;
}

/**
 * A request's answer within `socketBound(deadline)`: the response, `null`
 * when no daemon listens, or, when the socket gave none, the words that
 * follow "the daemon did not answer …": ` before the deadline`, ` within
 * 2 s`, or `: <the socket's error>`. Never a throw, so the command's
 * no-verdict path words it (exit 3 with `--wait`).
 */
export async function askWithin(
  socketPath: AbsolutePath,
  request: DaemonRequest,
  deadline: number,
  ports: WaitPorts = REAL_PORTS,
): Promise<DaemonResponse | null | Unanswered> {
  const timeoutMs = socketBound(deadline, ports.now);
  try {
    return await ports.ask(socketPath, request, timeoutMs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ETIMEDOUT") {
      return { unanswered: `: ${(error as Error).message}` };
    }
    return {
      unanswered:
        timeoutMs < CLI_SOCKET_TIMEOUT_MS
          ? BEFORE_DEADLINE
          : ` within ${CLI_SOCKET_TIMEOUT_MS / 1_000} s`,
    };
  }
}
