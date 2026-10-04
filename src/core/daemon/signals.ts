/** Signals that end a daemon through its shutdown order. */
const OWNED = new Set<string | symbol>(["SIGINT", "SIGTERM", "SIGHUP"]);

const METHODS = ["on", "once", "addListener", "prependListener", "prependOnceListener"] as const;

/**
 * Routes SIGINT, SIGTERM and SIGHUP to `onSignal` only, until the returned
 * function restores the defaults. For the daemon process alone.
 *
 * Vitest's logger registers SIGINT and SIGTERM listeners on every
 * `createVitest` that call `process.exit()` a millisecond later. In the
 * daemon that would skip the shutdown order of spec 001 D10 (the loop and
 * the runner closed, `worktrees.daemon` cleared) and leave status saying the
 * daemon is alive until its heartbeat ages. Other listeners for these
 * signals are therefore not registered while this is in effect; listeners
 * for every other event are untouched.
 */
export function ownSignals(onSignal: (signal: NodeJS.Signals) => void): () => void {
  const originals = METHODS.map((name) => [name, process[name]] as const);
  for (const signal of OWNED) process.on(signal as NodeJS.Signals, onSignal);
  for (const [name, original] of originals) {
    const guarded = function (this: NodeJS.Process, event: string | symbol, ...rest: unknown[]) {
      if (OWNED.has(event)) return process;
      return Reflect.apply(original, this, [event, ...rest]);
    };
    process[name] = guarded as (typeof process)[typeof name];
  }
  return () => {
    for (const [name, original] of originals) process[name] = original as never;
    for (const signal of OWNED) process.off(signal as NodeJS.Signals, onSignal);
  };
}
