import type { Attribute, ProcessOwner, TestProcessModel } from "./model.js";
import type { ProcessTable } from "./source.js";

/*
 * Spec 014 D5 (task 014-07): the test processes of each daemon, from one
 * table and the marks (`SQUEAL_DAEMON_CHILD`, read only through `markOf`).
 *
 * - A test process is a marked process whose nearest marked-or-daemon
 *   ancestor is a daemon, or that has neither: what a runner started. A
 *   source that reads no marks (D10) has the ppid tree only, and there a
 *   test process is a daemon's child.
 * - Its owner is its nearest daemon ancestor; when it has none, the daemon
 *   whose token its mark carries (`escaped`). A daemon is never a test
 *   process or a descendant: its subtree is its own.
 * - Its descendants are the processes below it up to the next daemon, with
 *   or without a mark: a test's `git`, servers and browsers inherit its
 *   mark with its env.
 * - A marked process with no owner is `unowned` when every live daemon's
 *   token was read; while one is not, its mark may be that daemon's.
 */

export interface Mark {
  readonly token: string;
  /** `null` for the bare mark and for a run told no lane (`<token>:`). */
  readonly lane: string | null;
  readonly runId: string | null;
}

/** `<token>`, `<token>:<lane>` or `<token>:<lane>#<runId>` (`daemon/escaped.ts`). */
export function parseMark(mark: string): Mark {
  const colon = mark.indexOf(":");
  if (colon < 0) return { token: mark, lane: null, runId: null };
  const rest = mark.slice(colon + 1);
  const hash = rest.indexOf("#");
  const lane = hash < 0 ? rest : rest.slice(0, hash);
  return {
    token: mark.slice(0, colon),
    lane: lane === "" ? null : lane,
    runId: hash < 0 ? null : rest.slice(hash + 1),
  };
}

export const attribute: Attribute = (source, table, owners) => {
  const owner = new Map(owners.map((o) => [o.pid, o]));
  const marks = new Map<number, string>();
  if (source.readsMarks) {
    for (const pid of table.keys()) {
      if (owner.has(pid)) continue;
      const mark = source.markOf(pid);
      if (mark !== null) marks.set(pid, mark);
    }
  }
  const isHead = (pid: number): boolean => {
    if (owner.has(pid)) return false;
    const parent = table.get(pid)?.ppid;
    if (!source.readsMarks) return parent !== undefined && owner.has(parent);
    if (!marks.has(pid)) return false;
    const above = nearest(table, parent, (p) => owner.has(p) || marks.has(p));
    return above === null || owner.has(above);
  };
  const pids = [...table.keys()].sort((a, b) => a - b);
  const heads = new Set(pids.filter(isHead));

  const descendants = new Map<number, number[]>([...heads].map((h) => [h, []]));
  for (const pid of pids) {
    if (owner.has(pid) || heads.has(pid)) continue;
    const head = nearest(table, table.get(pid)?.ppid, (p) => owner.has(p) || heads.has(p));
    if (head !== null) descendants.get(head)?.push(pid);
  }

  const byToken = new Map<string, ProcessOwner>();
  for (const o of owners) if (o.token !== null && !byToken.has(o.token)) byToken.set(o.token, o);
  const tokensKnown = owners.every((o) => o.token !== null);

  const processes: TestProcessModel[] = [];
  const unowned: { pid: number; mark: string }[] = [];
  for (const head of heads) {
    const mark = marks.get(head);
    const parsed = mark === undefined ? null : parseMark(mark);
    const ancestor = nearest(table, table.get(head)?.ppid, (p) => owner.has(p));
    const by =
      ancestor !== null
        ? owner.get(ancestor)
        : parsed === null
          ? undefined
          : byToken.get(parsed.token);
    if (by === undefined) {
      if (mark === undefined || !tokensKnown) continue;
      for (const pid of [head, ...(descendants.get(head) ?? [])]) {
        const carried = marks.get(pid);
        if (carried !== undefined) unowned.push({ pid, mark: carried });
      }
      continue;
    }
    const args = source.cmdline(head);
    processes.push({
      pid: head,
      daemonPid: by.pid,
      escaped: ancestor === null,
      lane: parsed?.lane ?? null,
      runId: parsed === null ? null : runOf(parsed, by),
      runner: args === null ? null : runnerOf(args),
      files: args === null ? null : filesOf(args),
      descendants: descendants.get(head) ?? [],
    });
  }
  return { processes, unowned };
};

/** The first of `pid` and its ancestors that `is`; `null` when none is. */
function nearest(
  table: ProcessTable,
  pid: number | undefined,
  is: (pid: number) => boolean,
): number | null {
  // A table read while processes come and go may hold a loop; it is cut at its size.
  for (let at = pid, steps = 0; at !== undefined && steps <= table.size; steps++) {
    if (is(at)) return at;
    const row = table.get(at);
    if (row === undefined || row.ppid === at) return null;
    at = row.ppid;
  }
  return null;
}

/** Its mark's run, else its lane's one open run of its daemon (D5). */
function runOf(mark: Mark, owner: ProcessOwner): string | null {
  if (mark.runId !== null) return mark.runId;
  if (mark.lane === null) return null;
  const open = owner.tiers.filter((t) => t.lane === mark.lane);
  return open.length === 1 ? (open[0]?.runId ?? null) : null;
}

const VITEST_WORKER = /\/vitest\/dist\/workers\/[^/]+\.js$/;

function runnerOf(args: readonly string[]): string | null {
  if (args.some((a) => VITEST_WORKER.test(a))) return "vitest";
  if (args.some((a) => a.startsWith("--basetemp=")) && isPytest(args)) return "pytest";
  if (args.includes("--test")) return "node-test";
  return null;
}

function isPytest(args: readonly string[]): boolean {
  return args.some((a, i) => (a === "-m" && args[i + 1] === "pytest") || /(^|\/)pytest$/.test(a));
}

/**
 * The files a node:test process names after `--test` and its options, and
 * a pytest batch after `--basetemp=<dir>`. `null` for a Vitest worker, whose
 * files are its tier's, and for any other process.
 */
function filesOf(args: readonly string[]): readonly string[] | null {
  const runner = runnerOf(args);
  if (runner === "pytest")
    return args.slice(args.findIndex((a) => a.startsWith("--basetemp=")) + 1);
  if (runner === "node-test")
    return args.slice(args.indexOf("--test") + 1).filter((a) => !a.startsWith("-"));
  return null;
}
