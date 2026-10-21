import type { OcClient, OcPlugin } from "./api.js";
import { squealHooks } from "./hooks.js";
import { findNode, NODE_FLOOR, usesSquealAt } from "./host.js";
import type { OcKind } from "./protocol.js";

export {
  DISPOSE_DEADLINE_MS,
  EVENT_DEADLINE_MS,
  IDLE_DEADLINE_MS,
  MAIN_AGENT,
} from "./hooks.js";
export { partAfter, partId } from "./parts.js";
export { WAIT_DEADLINE_MS } from "./turns.js";

/** `client.app.log`'s service name. */
export const LOG_SERVICE = "squeal";
/** The line logged when no Node of Squeal's minimum is on the PATH (D4). */
export const NO_NODE_LOG = `Squeal: no Node ${NODE_FLOOR} or later on the PATH, so Squeal is off in this OpenCode process.`;

export interface SquealPluginOptions {
  /** The bridge entry of each request kind, `dist/hooks/<kind>.mjs` (D1, D4). */
  readonly bridge: (kind: OcKind) => string;
  /** The package's `bin/`, prepended to the agent shell's `PATH` (D2). */
  readonly bin: string;
  /** Default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Default `findNode`. */
  readonly findNode?: (env: Readonly<Record<string, string | undefined>>) => Promise<string | null>;
  /** OpenCode's process (D2). Default `process.pid`. */
  readonly pid?: number;
}

/**
 * The Squeal plugin (spec 008 D2 to D4). OpenCode calls it once per instance
 * (a directory). Outside a Squeal repository, and without a Node to run the
 * bridge, it returns no hooks. Otherwise the hooks of D3:
 *
 * - `event` keeps the session map (D2): `session.created` records each
 *   session's parent; `session.deleted` ends a root session whole, or a
 *   child's consumer alone. A root's `session.idle` is 002's Stop: news
 *   continues the turn once through `promptAsync`, unless Squeal continued
 *   it or a `session.error` aborted it; then the idle wait is armed (D5). A
 *   child's `session.idle` ends its consumer.
 * - `chat.message` cancels the idle wait, registers the message's consumer
 *   once per instance, a root as `(session, "main")` and a child as `(root,
 *   child)`, or starts its turn, and adds the header or the undelivered delta
 *   to the message as one synthetic text part.
 * - `experimental.chat.system.transform` appends the primer to every request.
 * - `tool.execute.before` blocks an edit over an undelivered regression, and
 *   a `bash` test command under 005 D8, by throwing the reason;
 *   `tool.execute.after` appends the tool boundary's delta to the result.
 * - `shell.env` names the consumer in the agent's shell
 *   (`OPENCODE_SESSION_ID`, `OPENCODE_AGENT_ID`) and puts the package's
 *   `bin/` first on its `PATH`.
 * - `dispose` stops the idle waits and unregisters what this instance
 *   registered, within its deadline; after it every hook is silent.
 *
 * No hook outlasts its deadline or throws, except to block: a miss is
 * silence (D4).
 */
export function squealPlugin(options: SquealPluginOptions): OcPlugin {
  return async (input) => {
    try {
      const env = options.env ?? process.env;
      if (!usesSquealAt(input.directory) && !usesSquealAt(input.worktree)) return {};
      const node = await (options.findNode ?? findNode)(env);
      if (node === null) {
        log(input.client, NO_NODE_LOG);
        return {};
      }
      return squealHooks({
        node,
        bridge: options.bridge,
        client: input.client,
        directory: input.directory,
        worktree: input.worktree,
        pid: options.pid ?? process.pid,
        bin: options.bin,
        env,
      });
    } catch {
      return {};
    }
  };
}

function log(client: OcClient, message: string): void {
  try {
    client.app.log({ body: { service: LOG_SERVICE, level: "warn", message } }).catch(() => {});
  } catch {
    // No log either: still no hooks.
  }
}
