import type { ProcessCost } from "./model.js";
import type { PsDaemon, PsSnapshot, PsUnknown } from "./shape.js";

/*
 * Spec 014 D8 (task 014-11): a value `ps` could not read is `null`, and
 * `unknown` names it; it never reads as zero. The stages name what they
 * could not read (discovery, the stores, the flags). This names the rest,
 * field by field, one entry per cause: a process seen once is one entry
 * with the count, not one per process. A `null` that means "not asked" or
 * "does not apply" is not unknown: `unflaggedFiles` and `descendants.list`
 * without `--full`, `dead-consumer`'s command, a tier's `checkpointId`,
 * `departedAt` and `drainLeftMs` without a departure, a lane or files a
 * process does not have, a checkout's harness, a consumer that recorded no
 * harness process.
 */

export interface UnknownInput {
  readonly shape: Omit<PsSnapshot, "unknown">;
  /** What discovery, the stores and the flags named; each `what` once, first one kept. */
  readonly named: readonly PsUnknown[];
  /** Each process the shape covers, descendants included: its cost, `null` in neither sample. */
  readonly costs: ReadonlyMap<number, ProcessCost | null>;
}

/** How many pids an entry lists before it says how many more. */
const LISTED = 10;

export function unknownOf({ shape, named, costs }: UnknownInput): PsUnknown[] {
  const all = new Map<string, PsUnknown>();
  const name = (what: string, why: string): void => {
    // A named entry is kept whole: the withheld leftovers carry their `paths`.
    if (!all.has(what)) all.set(what, named.find((u) => u.what === what) ?? { what, why });
  };
  for (const u of named) name(u.what, u.why);

  const { host, squeal } = shape;
  if (host.load === null) name("host load", "the source cannot read it on this host");
  if (host.cpuPressure === null || host.memoryPressure === null)
    name("host pressure", "the source cannot read it on this host");
  if (host.memTotal === null || host.memAvailable === null)
    name("host memory", "the source cannot read it on this host");
  if (host.swapTotal === null || host.swapUsed === null)
    name("host swap", "the source cannot read it on this host");
  if (host.busyCpuPct === null)
    name(
      "host busyCpuPct",
      "the host's CPU times cannot be read, or did not change over the window",
    );
  if (squeal.cpuShare === null && squeal.cpuPct !== null && host.busyCpuPct !== null)
    name("squeal cpuShare", "the host's busy CPU over the window was none");
  if (squeal.memoryShare === null && squeal.privateBytes !== null && host.memTotal !== null)
    name("squeal memoryShare", "the host's used memory reads none");
  if (squeal.pool.held === null)
    name("pool permits", "the lock holders cannot be read, so no daemon's permits are known");

  const entries = [...costs];
  const seenOnce = entries.filter(([, c]) => c === null || c.cpuPct === null);
  // Its CPU in the window counts in the ancestor that waited for it (D4).
  const reaped = seenOnce.filter(([, c]) => (c?.reapedBy ?? null) !== null);
  if (seenOnce.length > 0)
    name(
      "processes cpuPct",
      `${were(seenOnce)} in one sample of the window only: ${pids(seenOnce)}${waitedFor(reaped.length, seenOnce.length)}`,
    );
  const lost = seenOnce.filter(([, c]) => (c?.reapedBy ?? null) === null);
  // An unsure reaper (`reviews/wave-4.md` B3): one that ended, or the row that holds the bound for one below it that is no row.
  const unsure = entries.filter(([, c]) => c?.reaperUnknown === true);
  const outside = lost.filter(([, c]) => c?.reaperUnknown !== true);
  const ended = unsure.filter(([, c]) => c?.cpuPct === null);
  const holding = unsure.filter(([, c]) => c?.cpuPct !== null);
  const parts = [
    ...(outside.length === 0
      ? []
      : [
          `${counted(outside)} in one sample only, which no process ps measures waited for: ${pids(outside)}`,
        ]),
    ...(ended.length === 0
      ? []
      : [`${counted(ended)} that ended ${afterParent(ended.length)}: ${pids(ended)}`]),
    ...(holding.length === 0
      ? []
      : [`processes below ${counted(holding)} that ended ${afterParent(2)}: ${pids(holding)}`]),
  ];
  if (parts.length > 0)
    name(
      "squeal cpuPct",
      `a lower bound: it leaves out the CPU in the window of ${parts.join("; and of ")}`,
    );
  // One gone at the second sample holds none, so a sum adds 0 for it (014-24).
  const noMemory = entries.filter(([, c]) => c === null || c.privateBytes === null);
  const left = noMemory.filter(([, c]) => c?.left === true);
  if (left.length > 0)
    name(
      "processes privateBytes",
      `${counted(left)} ended in the window, so ${left.length === 1 ? "it holds" : "they hold"} none: ${pids(left)}`,
    );
  const unread = noMemory.filter(([, c]) => c?.left !== true);
  if (unread.length > 0)
    name(
      "squeal privateBytes",
      `a lower bound: it leaves out the memory of ${counted(unread)} whose status could not be read: ${pids(unread)}`,
    );
  const noSwap = entries.filter(
    ([, c]) => c !== null && c.privateBytes !== null && c.swapBytes === null,
  );
  if (noSwap.length > 0)
    name(
      "processes swapBytes",
      shape.memory === "rss"
        ? "the source reads no swap per process on this platform (D10)"
        : `${counted(noSwap)} show no swap: ${pids(noSwap)}`,
    );

  const daemons = shape.repositories.flatMap((r) => r.daemons);
  const starts = [...daemons, ...daemons.flatMap((d) => d.processes)];
  if (starts.some((p) => p.startedAt === null))
    name("processes startedAt", "the boot time cannot be read");
  for (const d of daemons) daemonOf(d, all, name);
  const elsewhere = daemons
    .flatMap((d) => d.consumers)
    .filter((c) => c.harnessPid !== null && c.alive === null);
  if (elsewhere.length > 0)
    name(
      "consumers alive",
      `${elsewhere.length === 1 ? "1 consumer's harness process is" : `${elsewhere.length} consumers' harness processes are`} in another PID namespace`,
    );
  return [...all.values()];
}

function daemonOf(
  d: PsDaemon,
  all: ReadonlyMap<string, PsUnknown>,
  name: (what: string, why: string) => void,
): void {
  const of = `daemon ${d.pid}`;
  if (d.worktreeId === null)
    name(`${of} worktreeId`, "its lock file is not open and its root cannot be read");
  if (d.root === null) name(`${of} root`, "its arguments name a relative root");
  if (d.version === null)
    name(`${of} version`, "its script path names none, and its store records no daemon of its own");
  if (d.work.pending === null)
    name(
      `${of} work`,
      d.phase === "waiting"
        ? "it waits for its lock, and its worktree's row is the holder's"
        : "its store cannot be found",
    );
  // A starting daemon's row is a predecessor's, which `readWork` names as its work.
  else if (d.work.lastUsedAt === null && !all.has(`${of} work`))
    name(`${of} lastUsedAt`, "its store records no last use of its own (D9)");
}

/** Of `once` processes seen once, `reaped` ended under an ancestor that counts their CPU. */
function waitedFor(reaped: number, once: number): string {
  if (reaped === 0) return "";
  const whom = reaped < once ? `${reaped} of them` : once === 1 ? "it" : "them";
  return `; the ancestor that waited for ${whom} counts ${once === 1 ? "its" : "their"} CPU`;
}

/** Why no sample shows the process that waited for `n` processes that ended. */
function afterParent(n: number): string {
  return n === 1
    ? "after its parent did, or under one whose children's times grew too little, so no sample shows which process waited for it"
    : "after their parents did, or under ones whose children's times grew too little, so no sample shows which processes waited for them";
}

function counted(entries: readonly unknown[]): string {
  return entries.length === 1 ? "1 process" : `${entries.length} processes`;
}

function were(entries: readonly unknown[]): string {
  return `${counted(entries)} ${entries.length === 1 ? "was" : "were"}`;
}

function pids(entries: readonly (readonly [number, unknown])[]): string {
  const listed = entries.slice(0, LISTED).map(([pid]) => pid);
  const more = entries.length - listed.length;
  return `pid ${listed.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}
