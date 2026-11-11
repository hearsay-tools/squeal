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
  readonly timer: NodeJS.Timeout | undefined;
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
   * with `HostLost`. `deadlineMs` `null`: no deadline but the host's exit.
   */
  request(
    m: HostMethod,
    a: readonly unknown[],
    deadlineMs: number | null,
    id: number = this.nextId(),
  ): Promise<unknown> {
    if (this.#lost !== null) return Promise.reject(this.#lost);
    return new Promise((resolve, reject) => {
      const timer =
        deadlineMs === null
          ? undefined
          : setTimeout(
              () =>
                this.#lose(
                  `${this.#options.label} did not answer ${m} within ${deadlineMs} ms; Squeal stopped it`,
                  true,
                ),
              deadlineMs,
            );
      this.#pending.set(id, { resolve, reject, timer });
      this.#options.channel.write(encodeLine({ id, m, a }));
    });
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
      pending.reject(lost);
    }
    this.#pending.clear();
    if (!this.#closing) this.#options.lost(lost);
  }
}
