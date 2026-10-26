import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { OBSERVE_VARIABLE } from "../../runners/observe/runtime.js";
import { commandLine, TICKS_PER_SECOND, uptimeTicks } from "./terminate.js";

/*
 * Row 011-245 (gh-101, 013 `research/issue-101.md` findings 2 and 5): a
 * Vitest run cut by its forced cancel kills its workers only, so a process a
 * test started in a group and env of its own outlives it, out of the sweep's
 * reach (011 C13: no mark, not in the daemon's group). Squeal names such a
 * process and stops none: the human chose a report over a stop (2026-10-26).
 */

/** A process by its pid and its start, in the clock of its table (`HostRow.start`). */
export interface ProcessIdentity {
  readonly pid: number;
  readonly start: number;
}

/** What ties a process to a run beside its parentage: what the instance adds to its workers' env. */
export interface RunTies {
  /** The daemon's mark, which every worker of the run carries; absent outside a daemon. */
  readonly worker?: { readonly variable: string; readonly value: string };
  /** The recorder's settings variable and the instance's output; absent when it does not observe. */
  readonly observed?: { readonly variable: string; readonly out: string };
}

/** A process as a host's table lists it. */
export interface HostRow extends ProcessIdentity {
  readonly ppid: number;
  readonly pgrp: number;
  /** The id of its session; `null` where the table gives none (macOS). */
  readonly session: number | null;
}

/** What a cut's reading needs of the host: `/proc` on Linux, `ps` on macOS, a table of its own in tests. */
export interface HostTable {
  /** `msAgo` before now, a second early, in the clock of `HostRow.start`. */
  mark(msAgo?: number): number;
  /** Every process, those whose exit has begun left out. */
  list(): Promise<readonly HostRow[]>;
  /** `variable`'s value in the process's env; `null` when it has none or it cannot be read. */
  variable(pid: number, variable: string): Promise<string | null>;
  /** Of `found`, each whose pid still holds the process that started then, as it is now. */
  running(found: readonly ProcessIdentity[]): Promise<HostRow[]>;
  /** Its command line, cut as a note names it; `""` when it cannot be read. */
  command(pid: number): Promise<string>;
}

/**
 * The ties in `env`, what a runner gave its workers (`RunOptions.beforeForce`):
 * `markVariable`'s value and the recorder's output directory.
 */
export function tiesOf(env: Readonly<Record<string, unknown>>, markVariable: string): RunTies {
  const mark = env[markVariable];
  const out = outOf(env[OBSERVE_VARIABLE]);
  return {
    ...(typeof mark === "string" ? { worker: { variable: markVariable, value: mark } } : {}),
    ...(out === null ? {} : { observed: { variable: OBSERVE_VARIABLE, out } }),
  };
}

/** The `out` of recorder settings, `null` for none or for another shape. */
function outOf(settings: unknown): string | null {
  if (typeof settings !== "string") return null;
  try {
    const { out } = JSON.parse(settings) as { out?: unknown };
    return typeof out === "string" && out !== "" ? out : null;
  } catch {
    return null;
  }
}

/**
 * Before a forced cancel: every process started since `since` that the
 * run's workers started, the workers left out. The workers are the
 * daemon's own children since `since` that carry the run's mark, every one
 * of them when it has none. Three ties count: a descendant of a worker; a
 * member of a session or group whose id is a worker's or a descendant's
 * pid, which the kernel keeps from reuse while a member lives; and, on
 * Linux, a process whose env holds the instance's recorder settings as a
 * test's spawn gets them (`spawn.cjs`, `started`), an env of its own too, so
 * a child whose leader exited before any look is found wherever it was
 * reparented (013 `research/issue-101.md` finding 3). An env Squeal cannot
 * read counts as no tie. Never rejects: a failed read finds nothing.
 */
export async function heldByRun(
  ties: RunTies,
  since: number,
  table: HostTable = HOST,
  self: number = process.pid,
): Promise<ProcessIdentity[]> {
  try {
    const recent = (await table.list()).filter((row) => row.start >= since && row.pid !== self);
    const children = recent.filter((row) => row.ppid === self);
    const { worker, observed } = ties;
    const marked = await Promise.all(
      children.map(
        async (row) =>
          worker === undefined || (await table.variable(row.pid, worker.variable)) === worker.value,
      ),
    );
    const workers = new Set(children.filter((_, i) => marked[i]).map((row) => row.pid));
    const below = descendantsOf(workers, recent);
    const ids = new Set([...workers, ...below]);
    const others = recent.filter((row) => !workers.has(row.pid));
    const started =
      observed === undefined
        ? others.map(() => false)
        : await Promise.all(
            others.map(async (row) =>
              startedBy(await table.variable(row.pid, observed.variable), observed.out),
            ),
          );
    return others
      .filter(
        (row, i) =>
          below.has(row.pid) ||
          ids.has(row.pgrp) ||
          (row.session !== null && ids.has(row.session)) ||
          started[i] === true,
      )
      .map(({ pid, start }) => ({ pid, start }));
  } catch {
    return [];
  }
}

/** Whether `settings`, a process's `SQUEAL_OBSERVE`, are `out`'s and say a test started it. */
function startedBy(settings: string | null, out: string): boolean {
  if (settings === null) return false;
  try {
    const parsed: unknown = JSON.parse(settings);
    if (typeof parsed !== "object" || parsed === null) return false;
    const { out: own, started } = parsed as { out?: unknown; started?: unknown };
    return own === out && started === true;
  } catch {
    return false;
  }
}

function descendantsOf(roots: ReadonlySet<number>, rows: readonly HostRow[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const { pid, ppid } of rows) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const found = new Set<number>();
  const queue = [...roots].flatMap((root) => children.get(root) ?? []);
  for (let pid = queue.pop(); pid !== undefined; pid = queue.pop()) {
    if (found.has(pid) || roots.has(pid)) continue;
    found.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return found;
}

/**
 * After a run's sweep: the note naming the run and each of `outlived` still
 * running, its pid and command line and its parent's, and the `kill` that
 * stops them, the step the human asked for (2026-10-26); `null` for none.
 */
export async function outlivedNote(
  outlived: readonly ProcessIdentity[],
  runId: string,
  table: HostTable = HOST,
): Promise<string | null> {
  const running = outlived.length === 0 ? [] : await table.running(outlived).catch(() => []);
  if (running.length === 0) return null;
  const entries = await Promise.all(
    running.map(async ({ pid, ppid }) => {
      const parent = `parent ${ppid} ${await table.command(ppid)}`.trimEnd();
      return `${`${pid} ${await table.command(pid)}`.trimEnd()} (${parent})`;
    }),
  );
  const pids = running.map(({ pid }) => pid).join(" ");
  return running.length === 1
    ? `1 process a test started is still running after Squeal stopped its run ${runId}; Squeal did not stop the process: ${entries.join("; ")}. \`kill ${pids}\` stops it.`
    : `${running.length} processes tests started are still running after Squeal stopped their run ${runId}; Squeal did not stop the processes: ${entries.join("; ")}. \`kill ${pids}\` stops them.`;
}

/** One run's reading: the hook its options carry, and the note after its sweep. */
export interface CutReading {
  /** `RunOptions.beforeForce`: keeps what the workers started; never rejects. */
  readonly beforeForce: (env: Readonly<Record<string, unknown>>) => Promise<void>;
  /** After the run's sweep: `outlivedNote` of what the hook kept; `null` when it kept none. */
  readonly note: (runId: string) => Promise<string | null>;
}

/**
 * A reading for a run starting now, whose workers carry `markVariable`'s
 * mark. A run that ends by itself or in the grace never calls the hook, so
 * it reads nothing and notes nothing.
 */
export function cutReading(markVariable: string, table: HostTable = HOST): CutReading {
  const begun = Date.now();
  let held: readonly ProcessIdentity[] = [];
  return {
    async beforeForce(env) {
      try {
        held = await heldByRun(tiesOf(env, markVariable), table.mark(Date.now() - begun), table);
      } catch {
        held = [];
      }
    },
    note: (runId) => outlivedNote(held, runId, table).catch(() => null),
  };
}

/** `PF_EXITING` in the stat line's flags, as `lifeOf` reads it. */
const PF_EXITING = 0x4;
/** `/proc/<pid>/stat` files read per event-loop turn, as the sweep's scan reads them. */
const CHUNK = 64;

/** The process at `pid` from `/proc/<pid>/stat`, or `null` when none is or its exit has begun. */
function procRow(pid: number): HostRow | null {
  let text: string;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "latin1");
  } catch {
    return null;
  }
  // The command name is in parentheses and may hold either; the fields follow the last one.
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  if (fields[0] === "Z" || fields[0] === "X" || (Number(fields[6]) & PF_EXITING) !== 0) return null;
  return {
    pid,
    ppid: Number(fields[1]),
    pgrp: Number(fields[2]),
    session: Number(fields[3]),
    start: Number(fields[19]),
  };
}

const PROC: HostTable = {
  mark: (msAgo = 0) =>
    Math.max(0, uptimeTicks() - TICKS_PER_SECOND - Math.ceil((msAgo * TICKS_PER_SECOND) / 1_000)),
  async list() {
    const names = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
    const rows: HostRow[] = [];
    for (let at = 0; at < names.length; at += CHUNK) {
      if (at > 0) await new Promise((done) => setImmediate(done));
      for (const name of names.slice(at, at + CHUNK)) {
        const row = procRow(Number(name));
        if (row !== null) rows.push(row);
      }
    }
    return rows;
  },
  async variable(pid, variable) {
    let environ: string;
    try {
      environ = `\0${await readFile(`/proc/${pid}/environ`, "latin1")}`;
    } catch {
      // Gone, or another user's.
      return null;
    }
    const needle = `\0${variable}=`;
    const at = environ.indexOf(needle);
    if (at < 0) return null;
    const end = environ.indexOf("\0", at + needle.length);
    return environ.slice(at + needle.length, end < 0 ? undefined : end);
  },
  running: async (found) =>
    found.flatMap(({ pid, start }) => {
      const row = procRow(pid);
      return row?.start === start ? [row] : [];
    }),
  command: commandLine,
};

const run = promisify(execFile);
/** The longest command line a note names, as the sweep's notes cut it. */
const COMMAND_CHARS = 120;
/** The longest a `ps` may take before it is killed and reads as nothing. */
const PS_TIMEOUT_MS = 2_000;

/** `ps` rows: pid, ppid, group, state and `lstart`, `Mon Oct 26 05:17:01 2026`, read as seconds. */
export function psRows(text: string): HostRow[] {
  return text.split("\n").flatMap((line) => {
    const [pid, ppid, pgrp, state, , month, day, time, year] = line.trim().split(/\s+/);
    if (pid === undefined || state === undefined || state.startsWith("Z")) return [];
    const start = Date.parse(`${month} ${day} ${year} ${time}`) / 1_000;
    if (!Number.isInteger(start)) return [];
    return [{ pid: Number(pid), ppid: Number(ppid), pgrp: Number(pgrp), session: null, start }];
  });
}

/** macOS (spec 014 D10's source reads it the same way): one `ps` of every process, no env. */
const PS: HostTable = {
  mark: (msAgo = 0) => Math.floor((Date.now() - msAgo) / 1_000) - 1,
  async list() {
    const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid=,pgid=,stat=,lstart="], {
      env: { ...process.env, LC_ALL: "C" },
      timeout: PS_TIMEOUT_MS,
    });
    return psRows(stdout);
  },
  variable: async () => null,
  async running(found) {
    const rows = await PS.list();
    return rows.filter((row) =>
      found.some(({ pid, start }) => row.pid === pid && row.start === start),
    );
  },
  async command(pid) {
    try {
      const args = ["-ww", "-o", "command=", "-p", String(pid)];
      const { stdout } = await run("ps", args, { timeout: PS_TIMEOUT_MS });
      const text = stdout.trim();
      return text.length > COMMAND_CHARS ? `${text.slice(0, COMMAND_CHARS - 3)}...` : text;
    } catch {
      return "";
    }
  },
};

const NONE: HostTable = {
  mark: () => 0,
  list: async () => [],
  variable: async () => null,
  running: async () => [],
  command: async () => "",
};

/** This host's table. */
export const HOST: HostTable =
  process.platform === "linux" ? PROC : process.platform === "darwin" ? PS : NONE;
