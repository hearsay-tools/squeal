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
  /** Its time left in whole seconds, from stored durations; `null` when none is known. */
  readonly seconds: number | null;
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
 * less the time since its start. `null` when each runs alone or with the
 * call's files only, whose own time the estimate already counts.
 */
export function namedRun(
  runs: readonly RunRecord[],
  call: readonly TestFileRef[],
  running: readonly TestFileRef[],
  seconds: (ref: TestFileRef) => number | null,
  at: { readonly width: number; readonly factor: number | null; readonly now: number },
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
  const known = run.testFiles.map(seconds).filter((s): s is number => s !== null);
  const width = Math.max(1, Math.min(at.width, run.testFiles.length));
  const whole = Math.max(Math.max(0, ...known), sum(known) / width);
  const ran = Math.max(0, Math.round((at.now - run.startedAt) / 1000));
  const left = known.length === 0 ? null : Math.max(0, Math.ceil(whole * (at.factor ?? 1)) - ran);
  const { startedAt } = run;
  return { named, files: run.testFiles.length, startedAt, ran, seconds: left };
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
      ? "time unknown: none of its files has a stored duration"
      : run.seconds === 0
        ? "any time now: it has run past its stored durations"
        : time(run.seconds);
  return `${who} ${verb} in a batch of ${run.files} test files started ${ago} ago; ${its} when that batch ends (${end})`;
}
