import { owedRegistration } from "../../core/delivery/registration-owed.js";
import type { EpochMs } from "../../core/types/common.js";
import type { Consumer } from "../../core/types/delivery.js";
import type { HookContext } from "../shared/context.js";
import type { HookDeps } from "../shared/hook.js";

/*
 * Review 0.1.546 B1 (row 005-107): a registration text this worker handed to its host is not
 * said again by this worker, whether the clear of its owed mark was written, failed or has no
 * answer (a daemon that froze), until a request reads it cleared. The worker keeps, in its
 * memory, each registration whose text the host has, keyed by its consumer and its
 * `registeredAt`; no store record is added. A request that finds that registration still owed
 * writes its clear again, held with its own answer, so the shared code that reads the mark
 * (`sayOwed`) reads it cleared. A new worker process, as after a killed start, has no memory,
 * and says the owed text once (row 005-98, decision C).
 */

/** The Pi handlers' deps: the shared ones, and what the request hands (`Handing`). */
export interface PiDeps extends HookDeps {
  readonly handing?: Handing;
}

/** What one request hands to the host, and what the worker knows it handed before. */
export interface Handing {
  /**
   * `context` for this request's handlers: it clears again a registration the host already
   * has, and notes each registration whose clear the request writes (`registrationSent`).
   */
  enter(context: HookContext): Promise<HookContext>;
  /** The host has the request's answer: what it handed is kept. */
  keep(): void;
}

/** `context` as `deps.handing` gives it; as it is without one. */
export function entered(context: HookContext, deps: PiDeps): Promise<HookContext> {
  return deps.handing?.enter(context) ?? Promise.resolve(context);
}

const keyOf = (consumer: Consumer) =>
  JSON.stringify([consumer.worktreeId, consumer.sessionId, consumer.agentId]);

/** The registrations whose text one worker handed to its host, until a request reads them cleared. */
export class HandedRegistrations {
  readonly #handed = new Map<string, EpochMs>();

  /** A new request's `Handing`. */
  request(): Handing {
    const handed = this.#handed;
    const sent = new Map<string, EpochMs>();
    return {
      enter: async (context) => {
        const { consumer, delivery, store } = context;
        const key = keyOf(consumer);
        const kept = handed.get(key);
        if (kept !== undefined) {
          const same = store.consumers.get(consumer)?.registeredAt === kept;
          if (same && owedRegistration(store, consumer) !== null) {
            await delivery.registrationSent(consumer);
          } else {
            handed.delete(key);
          }
        }
        const registrationSent = async (to: Consumer) => {
          const at = store.consumers.get(to)?.registeredAt;
          await delivery.registrationSent(to);
          if (at !== undefined) sent.set(keyOf(to), at);
        };
        return { ...context, delivery: { ...delivery, registrationSent } };
      },
      keep: () => {
        for (const [key, at] of sent) handed.set(key, at);
      },
    };
  }
}
