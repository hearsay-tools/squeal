import { duration, NO_BOOT } from "./flags-text.js";
import type { PsModel } from "./model.js";
import type { PsFlag, PsFlagName, PsOrphan } from "./shape.js";
import type { ProcessRow } from "./source.js";

/*
 * Spec 014 D7, the processes (task 014-10): a test process past its
 * runner's bound, a mark no live daemon owns, a waiter whose session is
 * gone and a permit holder that is no daemon. Without marks (D10) the first
 * two are not evaluated; `flag` names them.
 */

/** One false orphan showed on a single sample (`research/should-not-be-up.md` 1). */
const ORPHAN_WINDOW_MS = 1_000;
/** C13: the reaper's grace and rounds come well within it. */
const OVERDUE_MS = 60_000;
const NODE_COMMS: ReadonlySet<string> = new Set(["MainThread", "node"]);
const WAITER = /\/dist\/waiter\.mjs$/;

/** What the process rules read of `flag`'s context. */
export interface ProcessContext {
  readonly model: PsModel;
  readonly ageOf: (row: ProcessRow) => number | null;
  readonly startOf: (row: ProcessRow) => number | null;
  readonly name: (what: string, why: string) => void;
}

/**
 * D7 `overdue-test-process`: a process carrying a mark, not its daemon's
 * own child, older than `runner.timeoutMs` plus a minute. The flag sits on
 * the test process whose row lists it, a descendant included.
 */
export function overdue(c: ProcessContext): Map<number, PsFlag[]> {
  const { model } = c;
  const out = new Map<number, PsFlag[]>();
  if (!model.source.readsMarks) return out;
  const table = model.second.sample.table;
  for (const p of model.second.attribution.processes) {
    const work = model.second.work.get(p.daemonPid) ?? model.first.work.get(p.daemonPid);
    if (work === undefined || !Number.isFinite(work.settings.timeoutMs)) continue;
    const bound = work.settings.timeoutMs + OVERDUE_MS;
    for (const pid of [p.pid, ...p.descendants]) {
      const row = table.get(pid);
      if (row === undefined || row.ppid === p.daemonPid) continue;
      const age = c.ageOf(row);
      if (age === null) c.name("flag overdue-test-process", NO_BOOT);
      if (age === null || age <= bound) continue;
      if (pid !== p.pid && model.source.markOf(pid) === null) continue;
      const who =
        pid === p.pid
          ? "it is"
          : `its descendant ${pid} (${row.comm}) carries its mark, is not its daemon's child, and is`;
      const reason = `${who} ${duration(age)} old, past runner.timeoutMs plus ${OVERDUE_MS / 1000} s`;
      out.set(p.pid, [
        ...(out.get(p.pid) ?? []),
        { flag: "overdue-test-process", reason, command: `kill ${pid}` },
      ]);
    }
  }
  return out;
}

/** D7's flagged processes no live daemon owns: `orphan-test-process`, `orphan-waiter`, `foreign-permit`. */
export function orphans(c: ProcessContext): PsOrphan[] {
  const { model } = c;
  const table = model.second.sample.table;
  const byPid = new Map<number, PsFlag[]>();
  const add = (pid: number, flag: PsFlagName, reason: string) =>
    byPid.set(pid, [...(byPid.get(pid) ?? []), { flag, reason, command: `kill ${pid}` }]);

  for (const { pid, reason } of orphanTestProcesses(c)) add(pid, "orphan-test-process", reason);
  // The host's table: the second reads only the processes the window measures (`reviews/wave-2.md` B1).
  const host = model.first.sample.table;
  for (const row of host.values()) {
    if (!NODE_COMMS.has(row.comm) || (row.uid !== null && row.uid !== model.places.uid)) continue;
    if (!(model.source.cmdline(row.pid) ?? []).some((a) => WAITER.test(a))) continue;
    const parent = host.get(row.ppid);
    if (parent === undefined) add(row.pid, "orphan-waiter", `its parent ${row.ppid} is gone`);
    else if (row.ppid === 1 || parent.comm === "systemd")
      add(
        row.pid,
        "orphan-waiter",
        `its parent is ${parent.comm} ${row.ppid}: its session is gone`,
      );
  }
  for (const { pid, path } of model.pool.foreign)
    if (table.has(pid) || host.has(pid))
      add(pid, "foreign-permit", `it holds the pool permit ${path} and is no daemon`);

  return [...byPid].map(([pid, flags]) => {
    const row = table.get(pid) ?? host.get(pid);
    return {
      pid,
      comm: row?.comm ?? "",
      startedAt: row === undefined ? null : c.startOf(row),
      flags,
    };
  });
}

/**
 * D7 `orphan-test-process`: a mark no live daemon's token owns, on both
 * readings at least a second apart, by the same process. While any
 * daemon's token is unread, a mark may be its, so none is claimed.
 */
function orphanTestProcesses(c: ProcessContext): { pid: number; reason: string }[] {
  const { model } = c;
  if (!model.source.readsMarks) return [];
  for (const d of model.discovery.daemons) {
    const pid = d.row.pid;
    if ([model.first, model.second].some((r) => (r.work.get(pid)?.token ?? null) === null)) {
      c.name(
        "flag orphan-test-process",
        `the token of daemon ${pid} is unread, so a mark may be its`,
      );
      return [];
    }
  }
  const windowMs = model.second.sample.atMs - model.first.sample.atMs;
  if (windowMs < ORPHAN_WINDOW_MS) {
    c.name(
      "flag orphan-test-process",
      `the samples are ${Math.round(windowMs)} ms apart, under 1 s`,
    );
    return [];
  }
  const before = new Map(model.first.attribution.unowned.map((u) => [u.pid, u.mark]));
  const found: { pid: number; reason: string }[] = [];
  for (const { pid, mark } of model.second.attribution.unowned) {
    const a = model.first.sample.table.get(pid);
    const b = model.second.sample.table.get(pid);
    if (before.get(pid) !== mark || a === undefined || a.startTicks !== b?.startTicks) continue;
    const token = mark.split(":")[0];
    found.push({ pid, reason: `its mark's token ${token} names no live daemon, on both samples` });
  }
  return found;
}
