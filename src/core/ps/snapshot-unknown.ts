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
    if (!all.has(what)) all.set(what, { what, why });
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
  if (seenOnce.length > 0)
    name(
      "processes cpuPct",
      `${were(seenOnce)} in one sample of the window only: ${pids(seenOnce)}`,
    );
  const noMemory = entries.filter(([, c]) => c === null || c.privateBytes === null);
  if (noMemory.length > 0)
    name(
      "processes privateBytes",
      `${counted(noMemory)} left before their memory was read: ${pids(noMemory)}`,
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
