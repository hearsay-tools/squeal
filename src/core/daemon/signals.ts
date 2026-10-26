import { readFileSync } from "node:fs";

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

/** Where Linux lists the control groups of the reading process. */
export const OWN_CGROUP = "/proc/self/cgroup";

/**
 * Row 011-250 (gh-1, `research/issue-1.md` sections 3 and 5): the systemd
 * unit whose control group this process runs in, read synchronously, at the
 * signal. A stop of that unit signals every process in its control group,
 * and a daemon a hook spawned stays in the hook's: 17 of 19 signal stops
 * were the cockpit's service stopping. The deepest `.service` or `.scope`
 * segment of the unified hierarchy's path, or of the `name=systemd` one
 * under cgroup v1; `null` with neither, off Linux, or when the file cannot
 * be read. Review 0.1.350, N1: a row counts only with the unified header
 * `0::` or a numeric v1 hierarchy id, and an absolute path, which may hold
 * colons.
 */
export function cgroupUnit(path: string = OWN_CGROUP): string | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    const [hierarchy = "", controllers, ...rest] = line.split(":");
    const unified = hierarchy === "0" && controllers === "";
    const systemd = /^\d+$/.test(hierarchy) && controllers === "name=systemd";
    const cgroup = rest.join(":");
    if (!(unified || systemd) || !cgroup.startsWith("/")) continue;
    const segments = cgroup.split("/");
    const unit = segments.reverse().find((segment) => /.\.(service|scope)$/.test(segment));
    if (unit !== undefined) return unit;
  }
  return null;
}

/**
 * Row 011-250: the exit note of a daemon `signal` stopped while it ran in
 * `unit` (`cgroupUnit`). It claims no sender: Node gives none, and the unit
 * need not be it.
 */
export function signalNote(signal: NodeJS.Signals, unit: string | null): string {
  const where = unit === null ? "" : ` while it ran in systemd unit ${unit}`;
  return `daemon stopped: ${signal}${where}; the next Squeal hook starts a new daemon, or \`squeal start\` starts one now`;
}
