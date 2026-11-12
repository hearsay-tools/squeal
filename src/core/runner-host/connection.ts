import type { HostChannel } from "./channel.js";
import {
  encodeLine,
  type HostEvent,
  type HostMessage,
  type HostMethod,
  type HostNotice,
  LineReader,
} from "./protocol.js";

/*
 * Spec 021 D6, D7 (row 021-11): the daemon's end of the protocol. Each
 * request gets one reply or fails: a host that exits, or misses a request's
 * deadline, is lost, every open request with it, and a host past a deadline
 * is killed (`runner-split.md` Q6: nothing else notices a hung host).
 */

/** Why a request got no reply: the host ended (`timedOut` false) or missed the deadline. */
export class HostLost extends Error {
  constructor(
    message: string,
    readonly timedOut: boolean,
  ) {
    super(message);
    this.name = "HostLost";
  }
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  /** Starts the request's deadline again from now. */
  readonly arm: () => void;
  /** Whether `renew` restarts it. */
  readonly renewable: boolean;
  timer: NodeJS.Timeout | undefined;
  /** `Deadline.totalMs`'s timer. */
  total?: NodeJS.Timeout;
  /** Starts `Deadline.idle` again from now; absent without one. */
  readonly armIdle?: () => void;
  /** `Deadline.idle`'s timer. */
  idle?: NodeJS.Timeout;
}

/** What renewed a request: a sign of progress of its work, or only of a live transport. */
export type Renewal = "progress" | "alive";

/**
 * A request's deadline, always finite (spec 021 D6, review 0.1.434 B3).
 * `renewable`: each `renew` starts it again, so it bounds the time between
 * two signs of progress, not the whole request.
 */
export interface Deadline {
  readonly ms: number;
  readonly renewable?: { readonly progress: string };
  /** Spec 021 D13 (row 021-14): a bound no renewal moves, for a renewable deadline. */
  readonly totalMs?: number;
  /**
   * Review 0.1.442 B2: a second bound that only `progress` renewals restart,
   * so signs of a live transport (`alive`) never keep a run whose work is
   * stuck (a remote run without a test timeout).
   */
  readonly idle?: { readonly ms: number; readonly progress: string };
}

export interface ConnectionOptions {
  readonly channel: HostChannel;
  /** Names the host in texts: `the vitest runner host`. */
  readonly label: string;
  readonly event: (message: HostEvent) => void;
  /** Once, when the host is lost; not after `close` began. */
  readonly lost: (error: HostLost) => void;
}

export class HostConnection {
  readonly #options: ConnectionOptions;
  readonly #pending = new Map<number, Pending>();
  #next = 1;
  #lost: HostLost | null = null;
  #closing = false;

  constructor(options: ConnectionOptions) {
    this.#options = options;
    const reader = new LineReader();
    options.channel.output.on("data", (chunk: string) => {
      let messages: unknown[];
      try {
        messages = reader.push(chunk);
      } catch {
        this.#lose(`${options.label} wrote a protocol line that does not parse`, false);
        return;
      }
      for (const message of messages) this.#receive(message as HostMessage);
    });
    void options.channel.ended.then((how) => {
      const tail = options.channel.stderrTail();
      this.#lose(`${options.label} exited (${how})${tail === "" ? "" : `: ${tail}`}`, false);
    });
  }

  /** Why the host can answer no more; `null` while it can. */
  get lost(): HostLost | null {
    return this.#lost;
  }

  /** The id the next request takes. */
  nextId(): number {
    return this.#next++;
  }

  /**
   * Sends request `m` and resolves with its reply, rejects with its error, or
   * with `HostLost`: the host ended, or `deadline` passed, which stops it.
   */
  request(
    m: HostMethod,
    a: readonly unknown[],
    deadline: number | Deadline,
    id: number = this.nextId(),
  ): Promise<unknown> {
    if (this.#lost !== null) return Promise.reject(this.#lost);
    const { ms, renewable, totalMs, idle } =
      typeof deadline === "number"
        ? { ms: deadline, totalMs: undefined, idle: undefined }
        : deadline;
    const what = renewable === undefined ? m : `${m}, nor ${renewable.progress},`;
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        resolve,
        reject,
        timer: undefined,
        renewable: renewable !== undefined,
        arm: () => {
          clearTimeout(pending.timer);
          pending.timer = setTimeout(
            () =>
              this.#lose(
                `${this.#options.label} did not answer ${what} within ${ms} ms; Squeal stopped it`,
                true,
              ),
            ms,
          );
        },
      };
      if (idle !== undefined) {
        const armIdle = () => {
          clearTimeout(pending.idle);
          pending.idle = setTimeout(
            () =>
              this.#lose(
                `${this.#options.label} did not answer ${m}, nor ${idle.progress}, within ${idle.ms} ms; Squeal stopped it`,
                true,
              ),
            idle.ms,
          );
        };
        Object.assign(pending, { armIdle });
        armIdle();
      }
      pending.arm();
      if (totalMs !== undefined) {
        pending.total = setTimeout(
          () =>
            this.#lose(
              `${this.#options.label} did not answer ${m} within ${totalMs} ms; Squeal stopped it`,
              true,
            ),
          totalMs,
        );
      }
      this.#pending.set(id, pending);
      this.#options.channel.write(encodeLine({ id, m, a }));
    });
  }

  /**
   * Request `id` showed a sign of life: its renewable deadline starts again,
   * and its `idle` bound too when the sign is `progress` of its work.
   */
  renew(id: number, renewal: Renewal = "progress"): void {
    const pending = this.#pending.get(id);
    if (pending?.renewable === true) pending.arm();
    if (renewal === "progress") pending?.armIdle?.();
  }

  notice(message: HostNotice): void {
    if (this.#lost === null) this.#options.channel.write(encodeLine(message));
  }

  /** `close` began: the host's end is expected, and no longer reported as lost. */
  closing(): void {
    this.#closing = true;
  }

  #receive(message: HostMessage): void {
    if ("ev" in message) {
      this.#options.event(message);
      return;
    }
    const pending = this.#pending.get(message.id);
    if (pending === undefined) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    clearTimeout(pending.total);
    clearTimeout(pending.idle);
    if ("e" in message) pending.reject(new Error(message.e.message));
    else pending.resolve(message.r);
  }

  #lose(text: string, timedOut: boolean): void {
    if (this.#lost !== null) return;
    const lost = new HostLost(text, timedOut);
    this.#lost = lost;
    this.#options.channel.kill();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      clearTimeout(pending.total);
      clearTimeout(pending.idle);
      pending.reject(lost);
    }
    this.#pending.clear();
    if (!this.#closing) this.#options.lost(lost);
  }
}
