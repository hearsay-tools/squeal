import type { OcClient } from "./api.js";
import type { CallOptions } from "./bridge-client.js";
import { type Deadline, deadlineIn, within } from "./deadline.js";
import type { OcAnswers, OcConsumer, OcKind, OcRequest } from "./protocol.js";

/*
 * Spec 008 D3's end of a turn and D5's idle wake in the plugin: per root
 * session, whether Squeal continued the turn, whether it was aborted, and its
 * idle waiter. Runs in OpenCode's Bun.
 */

/** D4: how long `promptAsync` may take to accept a wake (D5); a continuation has what is left of idle's deadline. */
export const PROMPT_DEADLINE_MS = 2_000;
/** D5: the waiter's own bound (`IDLE_WAIT_MS`, 59 minutes) and a minute; it exits first. */
export const WAIT_DEADLINE_MS = 3_600_000;

/** The request of kind `K`, without what every request carries. */
export type About<K extends OcKind> = Omit<
  Extract<OcRequest, { kind: K }>,
  "kind" | "worktree" | "pid"
>;

/** The plugin's bridge call. */
export type Ask = <K extends OcKind>(
  kind: K,
  request: About<K>,
  deadline: Deadline,
  options?: CallOptions,
) => Promise<OcAnswers[K] | null>;

/** A root session's turn (D3) and its idle wait (D5). */
interface Turn {
  /** Squeal continued or woke this turn: its idle ends the turn, silent (002's `stop_hook_active`). */
  continued: boolean;
  /** A `MessageAbortedError` came since the last idle (002's Interrupt). */
  aborted: boolean;
  /** The text Squeal last sent, so its `chat.message` is known as Squeal's own. */
  own: string | null;
  waiter: AbortController | null;
}

export interface Turns {
  /**
   * A root's `chat.message`: the idle wait ends; a message that is not the
   * one Squeal sent clears the continuation flag.
   */
  message(id: string, parts: readonly unknown[]): void;
  /** A root's `session.error` with `MessageAbortedError`. */
  aborted(id: string): void;
  /**
   * A root's `session.idle`, 002's Stop: after an abort or Squeal's own turn
   * the turn ends, silent; otherwise news continues it once through
   * `promptAsync`. Unless continued, the idle wait is armed (D5).
   */
  idle(consumer: OcConsumer, deadline: Deadline): Promise<void>;
  /** `session.deleted`: the session's wait ends and its state goes. */
  forget(id: string): void;
  /** `dispose`: every wait ends, and none is armed again. */
  stop(): void;
}

const textOf = (part: unknown): string | null => {
  const p = part as { type?: unknown; text?: unknown } | null;
  return p?.type === "text" && typeof p.text === "string" ? p.text : null;
};

export function turns(client: OcClient, ask: Ask): Turns {
  const all = new Map<string, Turn>();
  let stopped = false;

  const turnOf = (id: string): Turn => {
    let turn = all.get(id);
    if (turn === undefined) {
      turn = { continued: false, aborted: false, own: null, waiter: null };
      all.set(id, turn);
    }
    return turn;
  };

  const cancelWait = (turn: Turn) => {
    turn.waiter?.abort();
    turn.waiter = null;
  };

  /**
   * Starts one more turn with `text` (D3's continuation, D5's wake) within
   * what is left of `deadline`; whether OpenCode took it. Past the deadline
   * the request is aborted, so it starts no late continuation (review 008-16
   * B1); with none left it is not sent.
   */
  const say = async (
    id: string,
    turn: Turn,
    text: string,
    deadline: Deadline,
  ): Promise<boolean> => {
    const left = deadline();
    if (left <= 0) return false;
    turn.continued = true;
    turn.own = text;
    const cancel = new AbortController();
    const parts = [{ type: "text" as const, text }];
    const result = await within(
      client.session.promptAsync({ path: { id }, body: { parts }, signal: cancel.signal }),
      left,
    );
    if (result !== null && result.error === undefined) return true;
    cancel.abort();
    turn.own = null;
    return false;
  };

  /** D5: waits for the idle delta and wakes the agent with it, once. */
  const armWait = (consumer: OcConsumer, turn: Turn) => {
    cancelWait(turn);
    if (stopped) return;
    const waiter = new AbortController();
    turn.waiter = waiter;
    const options = { signal: waiter.signal, background: true };
    void ask("wait", { consumer }, deadlineIn(WAIT_DEADLINE_MS), options)
      .then(async (answer) => {
        if (turn.waiter !== waiter) return;
        turn.waiter = null;
        if (answer?.text == null || stopped) return;
        await say(consumer.sessionId, turn, answer.text, deadlineIn(PROMPT_DEADLINE_MS));
      })
      .catch(() => {});
  };

  return {
    message(id, parts) {
      const turn = turnOf(id);
      cancelWait(turn);
      if (turn.own !== null && parts.some((part) => textOf(part) === turn.own)) {
        turn.own = null;
        return;
      }
      turn.continued = false;
    },
    aborted(id) {
      turnOf(id).aborted = true;
    },
    async idle(consumer, deadline) {
      const id = consumer.sessionId;
      const turn = turnOf(id);
      if (turn.aborted || turn.continued) {
        turn.aborted = false;
        await ask("endTurn", { consumer }, deadline);
      } else {
        const report = (await ask("stop", { consumer }, deadline))?.report ?? null;
        if (report !== null && !stopped && (await say(id, turn, report, deadline))) return;
      }
      armWait(consumer, turn);
    },
    forget(id) {
      const turn = all.get(id);
      if (turn !== undefined) cancelWait(turn);
      all.delete(id);
    },
    stop() {
      stopped = true;
      for (const turn of all.values()) cancelWait(turn);
    },
  };
}
