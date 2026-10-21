import type { AbsolutePath, EpochMs } from "../types/index.js";
import { discover } from "./discover.js";
import { hostTotals, readPool } from "./host.js";
import { measure, takeSample } from "./measure.js";
import type {
  Attribution,
  DaemonWork,
  Discovery,
  Flag,
  FoundDaemon,
  ProcessOwner,
  PsModel,
  PsPlaces,
} from "./model.js";
import { attribute } from "./processes.js";
import type { PsSnapshot } from "./shape.js";
import { shapeOf, type WindowRead } from "./snapshot-shape.js";
import type { PsSource } from "./source.js";
import { readWork } from "./work.js";

/*
 * Spec 014 D1, D4 (task 014-11): one `squeal ps` snapshot. The window opens
 * at the first sample, and every other read runs inside it (D4): discovery,
 * the stores, the marks, the pool and the host. The rest of the window is
 * waited out, and the second sample closes it. That second reading reads
 * Squeal's processes, their stores and their marks again, so the flags that
 * confirm on two samples (D7) have both. The CPU is over the monotonic
 * window; the phases and ages are against the epoch clock read at the
 * first sample. Nothing here writes, signals or connects.
 */

/** The CPU window (D4): about half the error of 1 s. */
export const SAMPLE_MS = 2_000;

export interface SnapshotOptions {
  readonly source: PsSource;
  readonly places: PsPlaces;
  /** D7: `flag` of `flags.ts`. */
  readonly flag: Flag;
  /** `--full`: each descendant, and the counts of the files that never get a flag (D1). */
  readonly full: boolean;
  /** `--repo`: the current repository's daemons, processes, flags and files only (D1). */
  readonly repo: boolean;
  readonly sampleMs: number;
  /** The epoch clock, read once at the first sample. */
  readonly now: () => EpochMs;
  /** Waits out the rest of the window. */
  readonly wait: (ms: number) => Promise<void>;
}

export interface Snapshot {
  readonly shape: PsSnapshot;
  /** Every leftover path, for `--leftovers` (D1). */
  readonly leftovers: readonly AbsolutePath[];
}

/** The flags until the coordinator wires `flag` of `flags.ts` (014-10): none. */
export const noFlags: Flag = () => ({
  daemons: new Map(),
  states: new Map(),
  processes: new Map(),
  orphans: [],
  files: [],
  unflagged: [],
  leftovers: [],
  unknown: [],
});

export async function takeSnapshot(options: SnapshotOptions): Promise<Snapshot> {
  const read = await readWindow(options);
  const findings = options.flag(read.model);
  return { shape: shapeOf(read, findings, options), leftovers: findings.leftovers };
}

async function readWindow(o: SnapshotOptions): Promise<WindowRead> {
  const { source, places } = o;
  const first = takeSample(source);
  const now = o.now();
  const discovery = discover(source, first.table, places);
  const work = readWork(source, first.table, discovery.daemons);
  const attribution = attribute(source, first.table, ownersOf(discovery.daemons, work.work));
  const pool = readPool(source, places, new Set(discovery.daemons.map((d) => d.row.pid)));
  const reading = source.host();
  const bootTime = source.bootTime();
  await o.wait(Math.max(0, o.sampleMs - (performance.now() - first.atMs)));

  const second = takeSample(source, followed(discovery, work.work, attribution));
  const live = discovery.daemons.filter(
    (d) => second.table.get(d.row.pid)?.startTicks === d.row.startTicks,
  );
  const again = readWork(source, second.table, live);
  const model: PsModel = {
    now,
    places,
    source,
    discovery,
    first: { sample: first, work: work.work, attribution },
    second: {
      sample: second,
      work: again.work,
      attribution: attribute(source, second.table, ownersOf(live, again.work)),
    },
    pool,
  };
  return {
    model,
    // The host files of one read, the busy CPU over the window's two.
    host: hostTotals(
      { ...reading, cpuTime: first.cpuTime },
      { ...reading, cpuTime: second.cpuTime },
    ),
    costs: measure(source, first, second, measured(discovery, attribution)),
    bootTime,
    unknown: [...discovery.unknown, ...work.unknown, ...again.unknown],
  };
}

/**
 * The live daemons, each with the token and tiers of the work read as its
 * own, never a pid key alone (`reviews/wave-1.md` input 2): a starting
 * daemon's work has neither, since its row is a predecessor's.
 */
function ownersOf(
  daemons: readonly FoundDaemon[],
  work: ReadonlyMap<number, DaemonWork>,
): ProcessOwner[] {
  return daemons.map((d) => {
    const own = work.get(d.row.pid);
    return { pid: d.row.pid, token: own?.token ?? null, tiers: own?.tiers ?? [] };
  });
}

/** The daemons, their test processes and those processes' descendants: what the window measures. */
function measured(discovery: Discovery, attribution: Attribution): number[] {
  return [
    ...discovery.daemons.map((d) => d.row.pid),
    ...attribution.processes.flatMap((p) => [p.pid, ...p.descendants]),
  ];
}

/** What the second sample reads: Squeal's processes, the marked ones nobody owns, and the consumers' harnesses. */
function followed(
  discovery: Discovery,
  work: ReadonlyMap<number, DaemonWork>,
  attribution: Attribution,
): number[] {
  const pids = new Set(measured(discovery, attribution));
  for (const u of attribution.unowned) pids.add(u.pid);
  for (const w of work.values())
    for (const c of w.consumers) if (c.harness !== null) pids.add(c.harness.pid);
  return [...pids].sort((a, b) => a - b);
}
