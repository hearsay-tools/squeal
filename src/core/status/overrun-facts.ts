import { testFileId } from "../keys/reverse-index.js";
import type { YieldRow } from "../scheduler/yield-row.js";
import type { EpochMs } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { FileOverrun, Standing } from "../types/standing.js";
import type { RunRecord } from "../types/store-records.js";

/*
 * Row 011-399 (gh-233, `research/stuck-running.md` shape 1): a running file
 * whose tier its live daemon published as overrunning (`YieldRow.overruns`)
 * and that the runner has not named ended. E1b's hung file ran 121 s, about
 * 600 times its 0.2 s, and status said only "running since".
 */

/**
 * `{ overrun }` for `ref` when `pending` is its run `run`, that run
 * overruns as of `now` in `row`, and `ref` is among its files left and not
 * named ended since; `{}` otherwise, also from an older daemon.
 */
export function overrunOf(
  ref: TestFileRef,
  pending: Pick<Standing, "kind">,
  run: RunRecord | undefined,
  row: YieldRow,
  now: EpochMs,
): { overrun?: FileOverrun } {
  if (pending.kind !== "running" || run === undefined) return {};
  const tier = row.overruns?.get(run.id);
  if (tier === undefined || now < tier.at) return {};
  const id = testFileId(ref);
  if ((row.endedFiles.get(run.id) ?? []).some((f) => testFileId(f) === id)) return {};
  const file = tier.files.find((f) => testFileId(f) === id);
  if (file === undefined) return {};
  const overrun: FileOverrun = {
    path: ref.path,
    // Review 0.1.567 B2: the age counts from the start the daemon moved by calendar steps, the
    // threshold's and the deadline's; the run row's `startedAt` stays the stored provenance.
    ranMs: Math.max(0, now - tier.startedAt),
    usualMs: file.usualMs,
    since: tier.at,
    deadline: tier.deadline,
    ...(tier.beside === true ? { beside: true } : {}),
  };
  return { overrun };
}

/**
 * The first of `files` that a tier in flight overruns with as of `now` in
 * `row` and that the runner has not named ended (row 011-399): the late
 * line says it may be hung. `null` with none, also from an older daemon.
 */
export function firstOverrunning(
  files: readonly TestFileRef[],
  row: YieldRow,
  now: EpochMs,
): TestFileRef | null {
  const left = new Set<string>();
  for (const [runId, tier] of row.overruns ?? []) {
    if (now < tier.at) continue;
    const ended = new Set((row.endedFiles.get(runId) ?? []).map(testFileId));
    for (const f of tier.files) if (!ended.has(testFileId(f))) left.add(testFileId(f));
  }
  return files.find((f) => left.has(testFileId(f))) ?? null;
}
