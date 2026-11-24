import type { RunnerAdapter } from "../../types/runner.js";
import { runnerHostGone } from "../proxy.js";
import type { RemoteHost } from "./connect.js";
import type { WhenLost } from "./settings.js";

/*
 * Spec 026 D8.3 (row 026-12): a lane's planning on its remote host
 * (`planning: "remote"`). While the remote is ready, `testFiles`,
 * `environment`, `affected`, `closure`, `enumerate` (and `globalSetups`)
 * are the remote host's, after the paths invalidated since the last message
 * reached it: no runner host starts here. A call waits for a connect in
 * flight, or starts one when the remote sleeps or its retry is due. When the
 * remote is down, `whenLost: "local"` plans here (the runner here starts
 * then, lazily); `whenLost: "not-run"` rejects the call, naming the remote,
 * so its files stay unknown. A call in flight counts as remote work: a sleep
 * is refused meanwhile. After the lane closes or the daemon's exit begins,
 * no call starts a runner host here.
 */

/** Spec 026 D8.3: where a lane plans; absent, `local`. */
export type Planning = "local" | "remote";

/** What the planning needs of its lane (`lane.ts`). */
export interface PlanningContext {
  readonly target: string;
  readonly whenLost: WhenLost;
  /** The runner here, which plans when the remote is down under `whenLost: "local"`. */
  readonly local: RunnerAdapter;
  /** The host ready for a call, after a connect or sleep in flight ended; `null`: the remote is down. */
  host(): Promise<RemoteHost | null>;
  /** Sends `host` the paths invalidated since the last message. */
  send(host: RemoteHost): Promise<unknown>;
  /** `host` ended during a call: the remote is down. */
  lost(host: RemoteHost): void;
  /** A call on the remote begins: busy until the returned call. */
  begin(): () => void;
  /** Why the remote is down, as status names it: `unreachable (...)` or `refused: ...`. */
  why(): string;
  /** The lane closed or the daemon's exit began: nothing starts here. */
  ending(): boolean;
  /** The runner here was asked: invalidations go there from now on. */
  opened(): void;
}

/** The planning members of a lane that plans on its remote. */
export type RemotePlanning = Pick<
  RunnerAdapter,
  "testFiles" | "environment" | "affected" | "closure" | "enumerate" | "globalSetups"
>;

/** `context.local`'s planning on the remote while it is ready, else as `whenLost` says. */
export function remotePlanning(context: PlanningContext): RemotePlanning {
  const { local, target } = context;
  const plan = async <T>(
    there: (adapter: RunnerAdapter) => Promise<T>,
    here: () => Promise<T>,
  ): Promise<T> => {
    if (context.ending()) throw new Error(`remote ${target}: its lane closed; not planned here`);
    const end = context.begin();
    try {
      const host = await context.host();
      if (host !== null) {
        try {
          await context.send(host);
          return await there(host.adapter);
        } catch (error) {
          // The remote's own answer stands; only a host that ended falls back.
          if (!runnerHostGone(host.adapter)) throw error;
          context.lost(host);
        }
      }
    } finally {
      end();
    }
    if (context.ending()) throw new Error(`remote ${target}: its lane closed; not planned here`);
    if (context.whenLost === "not-run") {
      throw new Error(`remote ${target} ${context.why()}; not planned here (whenLost "not-run")`);
    }
    context.opened();
    return here();
  };
  const planning: RemotePlanning = {
    testFiles: () =>
      plan(
        (a) => a.testFiles(),
        () => local.testFiles(),
      ),
    environment: () =>
      plan(
        (a) => a.environment(),
        () => local.environment(),
      ),
    affected: (paths) =>
      plan(
        (a) => a.affected(paths),
        () => local.affected(paths),
      ),
    closure: (file) =>
      plan(
        (a) => a.closure(file),
        () => local.closure(file),
      ),
    enumerate: (file) =>
      plan(
        (a) => a.enumerate(file),
        () => local.enumerate(file),
      ),
  };
  const setups = local.globalSetups?.bind(local);
  if (setups === undefined) return planning;
  return {
    ...planning,
    globalSetups: () => plan((a) => a.globalSetups?.() ?? Promise.resolve([]), setups),
  };
}
