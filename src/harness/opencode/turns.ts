import type { OcClient } from "./api.js";
import { arrivals } from "./arrivals.js";
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
/** How every Squeal report opens. */
const REPORT_OPENING = "SQUEAL · ";

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
  /**
   * A message came since the last idle, so the next idle ends a turn. OpenCode
   * 1.18.35 emits a second `session.idle` after an abort, which ends none
   * (review 008-16 B2).
   */
  open: boolean;
  /** Squeal continued or woke this turn: its idle ends the turn, silent (002's `stop_hook_active`). */
  continued: boolean;
  /** A `MessageAbortedError` came since the last idle (002's Interrupt). */
  aborted: boolean;
  /** The text Squeal last sent, so its `chat.message` is known as Squeal's own. */
  own: string | null;
  /** The id of the root's last message this instance saw, which a stored report must follow. */
  last: string | null;
  /** `arrivals` at the last idle, which a stored report must find unchanged. */
  arrivals: number;
  /**
   * Counts the root's messages and aborts. An idle decision taken at another
   * count is stale: only the turn that went idle, still live and not
   * aborted, may be continued (review 008-16 B2).
   */
  epoch: number;
  /**
   * Reports Stop or the waiter answered whose continuation was cancelled or
   * not taken: delivered already, so they ride on the next message or tool
   * result instead (`take`).
   */
  held: string[];
  waiter: AbortController | null;
}

export interface Turns {
  /**
   * A root's `chat.message`: the idle wait ends, and an idle decision still
   * pending is stale; a message that is not the one Squeal sent clears the
   * continuation flag and starts a turn with no abort. `messageId` is its id.
   */
  message(id: string, messageId: string, parts: readonly unknown[]): void;
  /** A root's `session.error` with `MessageAbortedError`; an idle decision still pending is stale. */
  aborted(id: string): void;
  /** The reports held for the root `id`, once, or `null`. */
  take(id: string): string | null;
  /**
   * A root's `session.idle`, 002's Stop: after an abort or Squeal's own turn
   * the turn ends, silent; otherwise news continues it once through
   * `promptAsync`, unless a message or an abort came meanwhile. Unless
   * continued or overtaken, the idle wait is armed (D5). An idle with no
   * message since the last one ends no turn.
   */
  idle(consumer: OcConsumer, deadline: Deadline): Promise<void>;
  /** `session.deleted`: the session's wait ends and its state goes. */
  forget(id: string): void;
  /**
   * `dispose`: every wait ends, and none is armed again. An idle whose Stop is
   * still in flight stores its news in the session instead, within `deadline`
   * (goal 4 under `opencode run`).
   */
  stop(deadline: Deadline): void;
}

const textOf = (part: unknown): string | null => {
  const p = part as { type?: unknown; text?: unknown } | null;
  return p?.type === "text" && typeof p.text === "string" ? p.text : null;
};

/**
 * Whether `parts` are a report Squeal stored at `dispose`: synthetic texts
 * only, each a report. Storing it re-creates OpenCode's plugin state, whose
 * new Squeal instance sees the message (`turns`' `stop`) and must leave it be.
 */
export const storedBySqueal = (parts: readonly unknown[]): boolean =>
  parts.length > 0 &&
  parts.every(
    (part) =>
      (part as { synthetic?: unknown } | null)?.synthetic === true &&
      textOf(part)?.startsWith(REPORT_OPENING) === true,
  );

export function turns(client: OcClient, ask: Ask): Turns {
  const all = new Map<string, Turn>();
  /** `dispose`'s deadline, once it came: what an idle in flight has to store its news. */
  let stopped: Deadline | null = null;

  const turnOf = (id: string): Turn => {
    let turn = all.get(id);
    if (turn === undefined) {
      turn = {
        open: false,
        continued: false,
        aborted: false,
        own: null,
        last: null,
        arrivals: 0,
        epoch: 0,
        held: [],
        waiter: null,
      };
      all.set(id, turn);
    }
    return turn;
  };

  /** Whether `turn` is still the root `id`, at `epoch`. */
  const live = (id: string, turn: Turn, epoch: number) =>
    all.get(id) === turn && turn.epoch === epoch;
  /** Whether `turn` is still the live root `id`, at `epoch`, and the instance is not stopping. */
  const current = (id: string, turn: Turn, epoch: number) =>
    stopped === null && live(id, turn, epoch);

  /**
   * Whether OpenCode says the newest message of session `id` is `last` or
   * a reply to it, within `deadline`; a failed read is `false`. Once
   * `dispose` began, OpenCode routes new input to the instance it re-creates
   * and so does an abort's event, which this instance's epoch never sees
   * (review 008-27 B1).
   */
  const latest = async (id: string, last: string | null, deadline: Deadline) => {
    if (last === null) return false;
    const cancel = new AbortController();
    const read = client.session.messages({
      path: { id },
      query: { limit: 1 },
      signal: cancel.signal,
    });
    const result = await within(read, deadline());
    if (result === null) cancel.abort();
    const info = result?.data?.at(-1)?.info;
    return info?.id === last || (info?.role === "assistant" && info.parentID === last);
  };

  const cancelWait = (turn: Turn) => {
    turn.waiter?.abort();
    turn.waiter = null;
  };

  /**
   * Starts one more turn with `text` (D3's continuation, D5's wake) within
   * what is left of `deadline`, if the turn is still the one at `epoch`;
   * whether OpenCode took it. Past the deadline the request is aborted, so
   * it starts no late continuation (review 008-16 B1); with none left, or
   * the turn stale (B2), it is not sent. A text not taken is held for the
   * next message or tool result, and stays Squeal's own in case OpenCode
   * took it after all. Once the instance is stopping, the text is stored
   * instead, with `noReply` and within `dispose`'s deadline: `opencode run`
   * exits after `dispose`, so no turn could run, and the session's next
   * resume reads it (D5); but only while the turn's message is still the
   * session's last (`latest`), and no message or abort reached any instance
   * since its idle (`arrivals`).
   */
  const say = async (
    id: string,
    turn: Turn,
    text: string,
    deadline: Deadline,
    epoch: number,
  ): Promise<boolean> => {
    const stop = stopped;
    const left = stop ?? deadline;
    const overtaken = async (stop: Deadline) =>
      !(await latest(id, turn.last, stop)) || arrivals(id) !== turn.arrivals;
    if (left() <= 0 || !live(id, turn, epoch) || (stop && (await overtaken(stop)))) {
      turn.held.push(text);
      return false;
    }
    turn.continued = true;
    turn.own = text;
    const cancel = new AbortController();
    const path = { id };
    const signal = cancel.signal;
    const sent =
      stop === null
        ? client.session.promptAsync({ path, body: { parts: [{ type: "text", text }] }, signal })
        : client.session.prompt({
            path,
            body: { parts: [{ type: "text", text, synthetic: true }], noReply: true },
            signal,
          });
    const result = await within(sent, left());
    if (result !== null && result.error === undefined) return true;
    cancel.abort();
    turn.held.push(text);
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
        if (answer?.text == null || stopped !== null) return;
        const deadline = deadlineIn(PROMPT_DEADLINE_MS);
        await say(consumer.sessionId, turn, answer.text, deadline, turn.epoch);
      })
      .catch(() => {});
  };

  return {
    message(id, messageId, parts) {
      const turn = turnOf(id);
      turn.open = true;
      turn.last = messageId;
      turn.epoch++;
      cancelWait(turn);
      const own = turn.own;
      if (own !== null && parts.some((part) => textOf(part) === own)) {
        turn.own = null;
        // Squeal's own, perhaps taken after its deadline: what it carries reached the model.
        turn.held = turn.held.filter((text) => text !== own);
        return;
      }
      turn.continued = false;
      turn.aborted = false;
    },
    aborted(id) {
      const turn = turnOf(id);
      turn.aborted = true;
      turn.epoch++;
    },
    take(id) {
      const turn = all.get(id);
      if (turn === undefined || turn.held.length === 0) return null;
      const text = turn.held.join("\n\n");
      turn.held = [];
      return text;
    },
    async idle(consumer, deadline) {
      const id = consumer.sessionId;
      const turn = turnOf(id);
      if (!turn.open) return;
      turn.open = false;
      turn.arrivals = arrivals(id);
      const epoch = turn.epoch;
      if (turn.aborted || turn.continued) {
        // A continued turn's own news waits for the next prompt, the wake included (defect 5).
        const ending = turn.aborted ? { consumer } : { consumer, continued: true as const };
        turn.aborted = false;
        await ask("endTurn", ending, deadline);
      } else {
        const report = (await ask("stop", { consumer }, deadline))?.report ?? null;
        if (report !== null && (await say(id, turn, report, deadline, epoch))) return;
      }
      // A newer message or an abort decides for itself, at its own idle.
      if (current(id, turn, epoch)) armWait(consumer, turn);
    },
    forget(id) {
      const turn = all.get(id);
      if (turn !== undefined) cancelWait(turn);
      all.delete(id);
    },
    stop(deadline) {
      stopped = deadline;
      for (const turn of all.values()) cancelWait(turn);
    },
  };
}
