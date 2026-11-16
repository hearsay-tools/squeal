import { execFileSync } from "node:child_process";

/*
 * Spec 023 D6 (row 023-04, `temp-checkout.md` 4): the gate's `--json`
 * relaunch child ends once the CLI process that started it is gone, with
 * every process it started, so a SIGKILL'd CLI process leaves nothing
 * running and nothing writing to the store. An orphaned child wrote 4
 * files to the store after its parent's kill in the probe.
 */

/** The pid of the CLI process that started the gate's child, in the child's environment. */
export const PARENT_PID_VARIABLE = "SQUEAL_CODE_GATE_PARENT";

/** How often the child looks for its parent; the check is one field read. */
const PARENT_POLL_MS = 250;

/**
 * The parent pid the gate's child was given, taken out of `env` at once as
 * the mark is; `undefined` when none or not a pid.
 */
export function takeParentPid(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const value = env[PARENT_PID_VARIABLE];
  if (value === undefined) return undefined;
  delete env[PARENT_PID_VARIABLE];
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** What `watchParent` reads and does; a test gives its own. */
export interface ParentWatch {
  /** This process's parent pid now. Default `process.ppid`. */
  readonly ppid?: () => number;
  /** Called once the parent is gone. Default `endGroup`. */
  readonly gone?: () => void;
  readonly intervalMs?: number;
}

/**
 * Row 023-04 (spec 023 D6): calls `gone` once this process's parent is no
 * longer `parent`, at once when it already is not, then every
 * `intervalMs`. A dead parent's children go to another process, so the
 * parent pid changes; this reads it on Linux and macOS alike. The timer
 * keeps no process alive. Returns the function that stops the watch.
 */
export function watchParent(parent: number, watch: ParentWatch = {}): () => void {
  const ppid = watch.ppid ?? (() => process.ppid);
  const gone = watch.gone ?? endGroup;
  let ended = false;
  const look = () => {
    if (ended || ppid() === parent) return;
    ended = true;
    clearInterval(timer);
    gone();
  };
  const timer = setInterval(look, watch.intervalMs ?? PARENT_POLL_MS);
  timer.unref();
  look();
  return () => {
    ended = true;
    clearInterval(timer);
  };
}

/**
 * Ends this process's group with SIGKILL, after the groups of its
 * descendants: the gate's child leads its own (`relaunchGate` starts it
 * detached), so Vitest's workers end with it, and each node:test file
 * runs in a group of its own (`startGroup`). When it leads none, only
 * this process ends.
 */
export function endGroup(): void {
  for (const group of descendantGroups(process.pid, processTable())) {
    try {
      process.kill(-group, "SIGKILL");
    } catch {
      // The group is gone.
    }
  }
  try {
    process.kill(-process.pid, "SIGKILL");
  } catch {
    process.kill(process.pid, "SIGKILL");
  }
}

/** One row of `ps`: a process, its parent and its group. */
export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
}

/** Every process as `ps` lists it; empty when `ps` cannot run. */
function processTable(): ProcessRow[] {
  try {
    const text = execFileSync("ps", ["-A", "-o", "pid=,ppid=,pgid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    });
    return text.split("\n").flatMap((line) => {
      const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
      return pid && ppid !== undefined && pgid ? [{ pid, ppid, pgid }] : [];
    });
  } catch {
    return [];
  }
}

/** The process groups of `pid`'s descendants in `table`, other than `pid`'s own, sorted. */
export function descendantGroups(pid: number, table: readonly ProcessRow[]): number[] {
  const children = new Map<number, ProcessRow[]>();
  for (const row of table) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const own = table.find((row) => row.pid === pid)?.pgid ?? pid;
  const groups = new Set<number>();
  const seen = new Set<number>([pid]);
  const next = [pid];
  for (let at = next.shift(); at !== undefined; at = next.shift()) {
    for (const child of children.get(at) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      if (child.pgid !== own) groups.add(child.pgid);
      next.push(child.pid);
    }
  }
  return [...groups].sort((a, b) => a - b);
}
