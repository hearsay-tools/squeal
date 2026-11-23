import { median } from "../core/code/gate/estimate.js";
import { resolveCommonDir } from "../core/fs/git-layout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { Connection } from "../core/store/connection.js";
import { openReadOnly } from "../core/store/open.js";
import { storePaths } from "../core/store/paths.js";
import { SCHEMA_VERSION } from "../core/store/schema.js";
import { createStore } from "../core/store/store.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { RunRecord } from "../core/types/store-records.js";
import { MEASURED_LEAST, tooFew } from "./status-at-estimate.js";

/*
 * Row 023-60 (spec 023 D7.3, dogfood round 7 W3): the named file's time.
 * A narrowed call's estimate counts its own files' stored durations, which
 * is true when they run alone: the daemon cuts a wider tier that holds a
 * leading file (`src/core/scheduler/lead-cut.ts`). When it does not (the
 * tier's work left is within 30 s of the file's own, or the tier was cut
 * for it once already), the file's result comes when that tier ends, and
 * the call says so, with the tier's time left.
 */

/** A daemon's run in flight that holds a file of the call beside files outside it. */
export interface NamedRun {
  /** The call's files still running in it. */
  readonly named: readonly TestFileRef[];
  /** All its test files. */
  readonly files: number;
  readonly startedAt: EpochMs;
  /** Whole seconds since its start, when the call read it. */
  readonly ran: number;
  /** How many of its files have a stored duration. */
  readonly known: number;
  /**
   * Its time left in whole seconds; `null` when unknown: too few of its
   * files have a stored duration (`tooFew`) and this call measured no rate.
   */
  readonly seconds: number | null;
}

/** The call's results on the side and its time so far, when it queued (`SideWork.measured`). */
export interface NamedRate {
  readonly done: number;
  readonly ms: number;
}

/**
 * The runs in flight of each daemon `ids` names, since its start, read-only
 * from the main store of `root`'s repository; none for `null`, a daemon not
 * registered, or a store that cannot be read.
 */
export function runsInFlight(
  root: AbsolutePath,
  ids: readonly (WorktreeId | null)[],
): (readonly RunRecord[])[] {
  const none = ids.map(() => []);
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return none;
  const paths = storePaths(commonDir);
  const db = openReadOnly(paths.database, SCHEMA_VERSION);
  if (db === null || db === "missing") return none;
  const store = createStore(new Connection(db), SCHEMA_VERSION, paths);
  try {
    return ids.map((id) => {
      const daemon = id === null ? null : (store.worktrees.get(id)?.daemon ?? null);
      return id === null || daemon === null ? [] : store.runs.inFlight(id, daemon.startedAt);
    });
  } catch {
    return none;
  } finally {
    store.close();
  }
}

/**
 * Of `running`, the call's files still running, the newest run in flight
 * that holds one beside a file outside `call`, with its time left: its
 * files run `width` at once, so it takes the longer of its longest file and
 * its summed `seconds` over the width, times `factor` (the host's load),
 * less the time since its start. As the side's estimate (`estimateSide`):
 * a file without a stored duration counts at the median of the stored ones,
 * this call's rate wins when it measured one, and the time is unknown when
 * too few have one (review 0.1.607 B1). `null` when each runs alone or with
 * the call's files only, whose own time the estimate already counts.
 */
export function namedRun(
  runs: readonly RunRecord[],
  call: readonly TestFileRef[],
  running: readonly TestFileRef[],
  seconds: (ref: TestFileRef) => number | null,
  at: {
    readonly width: number;
    readonly factor: number | null;
    readonly now: number;
    readonly rate?: NamedRate | null;
  },
): NamedRun | null {
  const own = new Set(call.map(testFileId));
  const newest = [...runs].sort((a, b) => b.startedAt - a.startedAt);
  const holding = new Map<RunRecord, TestFileRef[]>();
  for (const ref of running) {
    const run = newest.find((r) => r.testFiles.some((f) => testFileId(f) === testFileId(ref)));
    if (run === undefined || run.testFiles.every((f) => own.has(testFileId(f)))) continue;
    holding.set(run, [...(holding.get(run) ?? []), ref]);
  }
  const [run, named] = [...holding].sort(([a], [b]) => b.startedAt - a.startedAt)[0] ?? [];
  if (run === undefined || named === undefined) return null;
  const all = run.testFiles.map(seconds);
  const files = all.length;
  const known = all.filter((s): s is number => s !== null);
  const ran = Math.max(0, Math.round((at.now - run.startedAt) / 1000));
  const whole = wholeSeconds(all, known, Math.min(at.width, files), at);
  const left = whole === null ? null : Math.max(0, whole - ran);
  const { startedAt } = run;
  return { named, files, startedAt, ran, known: known.length, seconds: left };
}

/** The run's whole time in seconds, from this call's rate or its stored durations; `null`: unknown. */
function wholeSeconds(
  all: readonly (number | null)[],
  known: readonly number[],
  width: number,
  at: { readonly factor: number | null; readonly rate?: NamedRate | null },
): number | null {
  const { rate } = at;
  if (rate !== undefined && rate !== null && rate.done >= MEASURED_LEAST && rate.ms > 0) {
    const rated = Math.ceil((all.length * rate.ms) / 1000 / rate.done);
    return Math.max(rated, Math.ceil(Math.max(0, ...known) * (at.factor ?? 1)));
  }
  const middle = median(known);
  if (middle === null || tooFew(known.length, all.length)) return null;
  const filled = all.map((s) => s ?? middle);
  const whole = Math.max(Math.max(0, ...filled), sum(filled) / Math.max(1, width));
  return Math.ceil(whole * (at.factor ?? 1));
}

const sum = (list: readonly number[]) => list.reduce((a, s) => a + s, 0);

/**
 * `test/store/open.test.ts runs in a batch of 65 test files started 98 s
 * ago; its result comes when that batch ends (about 4 min)`, its times
 * written by `time` (`timeText`: `about 98 s`).
 */
export function namedRunText(run: NamedRun, time: (seconds: number) => string): string {
  const [first] = run.named;
  const more = run.named.length - 1;
  const who =
    more === 0 ? (first?.path ?? "") : `${first?.path ?? ""} and ${more} more named test files`;
  const verb = more === 0 ? "runs" : "run";
  const its = more === 0 ? "its result comes" : "their results come";
  const ago = time(run.ran).replace(/^about /, "");
  const end =
    run.seconds === null
      ? unknownText(run)
      : run.seconds === 0
        ? "any time now: it has run past its stored durations"
        : time(run.seconds);
  return `${who} ${verb} in a batch of ${run.files} test files started ${ago} ago; ${its} when that batch ends (${end})`;
}

/** Why a batch's time is unknown: no stored duration, or too few (review 0.1.607 B1). */
function unknownText(run: NamedRun): string {
  if (run.known === 0) return "time unknown: none of its files has a stored duration";
  const have = run.known === 1 ? "has" : "have";
  return `time unknown: too few runs stored (${run.known} of its ${run.files} files ${have} a stored duration) and this call measured no rate`;
}
