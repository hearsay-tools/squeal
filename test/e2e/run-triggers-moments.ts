import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { GroupTierState, StatusSnapshot } from "../../src/core/types/status.js";
import type { E2E } from "./harness.js";
import { hookExtra, type StopBoth, type TimedRun } from "./run-triggers-support.js";
import { until } from "./support.js";

/*
 * Spec 019 Testing, "Proof" (row 019-17): reading each moment of
 * `run-triggers.test.ts` from what the agent and the store see.
 */

/** The configured group `name`'s lane in `s` (019 D6); throws when status has none. */
export function groupOf(s: StatusSnapshot, name: string): GroupTierState {
  const tier = s.groupTiers?.find((g) => g.name === name);
  if (tier === undefined) throw new Error(`no group ${name} in status`);
  return tier;
}

/**
 * Every `Commit <sha>` line the boundaries after a commit deliver: one
 * boundary every half second until two came or `ms` passed, then three more,
 * so a third would show. The first boundary asks the daemon for a pass, and
 * the line comes at a later one (019-13 known limit).
 */
export async function commitLines(e: E2E, sha: string, ms = 90_000): Promise<string[]> {
  const head = `Commit ${sha.slice(0, 7)}`;
  const lines: string[] = [];
  const take = async () => {
    const out = await e.hook("post-tool-batch", e.main);
    lines.push(...(out.text ?? "").split("\n").filter((l) => l.startsWith(head)));
    await sleep(500);
  };
  const deadline = Date.now() + ms;
  while (lines.length < 2 && Date.now() < deadline) await take();
  for (let more = 0; more < 3; more++) await take();
  return lines;
}

/**
 * The session's first Stop, its waiting entry started first. Until the
 * waiting entry is known to run for the session (`stopWaitRuns`, task
 * 001-297), the 2 s entry holds on the required checks itself; the harness
 * starts both at once, so which one decides the first Stop is a race. Here
 * the waiting entry records itself, then the 2 s entry starts.
 */
export async function firstStop(e: E2E, overrides: object = {}): Promise<StopBoth> {
  const started = performance.now();
  const waiting = hookExtra(e, "stop-slow", e.main, overrides);
  await until("the waiting entry's record", 30_000, async () =>
    stopWaitRecorded(e) ? true : null,
  );
  const quick = await e.hook("stop", e.main, overrides);
  return { quick, waiting: await waiting, ms: performance.now() - started };
}

function stopWaitRecorded(e: E2E): boolean {
  const db = new DatabaseSync(join(e.main, ".git/squeal/store.sqlite"), { readOnly: true });
  try {
    const row = db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(`stop-wait:${worktreeIdFor(e.main)}`) as { value: string } | undefined;
    return row?.value.includes(`"${e.kind.name}"`) === true;
  } finally {
    db.close();
  }
}

/**
 * Where `runs` break 019 D1 and D3 for the group of `files` (`after:
 * ["unit"]`, `maxParallel: 1`): a run that holds more than one of its files,
 * a run of it that overlaps another of its own, or one that started while a
 * run of another file at its revision ran. A run of two group files at once
 * overlaps nothing, so the first rule is what proves `maxParallel: 1`
 * (review of 0.1.399).
 */
export function lanesKeptApart(runs: readonly TimedRun[], files: readonly string[]): string[] {
  const own = (r: TimedRun) => r.testFiles.some((f) => files.includes(f));
  const ends = (r: TimedRun) => r.ended ?? Number.POSITIVE_INFINITY;
  const broken: string[] = [];
  const group = runs.filter(own);
  for (const [i, run] of group.entries()) {
    const held = run.testFiles.filter((f) => files.includes(f));
    if (held.length > 1) broken.push(`one run holds ${held.length} group files: ${held}`);
    for (const other of group.slice(i + 1)) {
      if (other.started < ends(run)) broken.push(`${run.testFiles} overlaps ${other.testFiles}`);
    }
    for (const before of runs.filter((r) => !own(r) && r.revision === run.revision)) {
      if (before.started < run.started && ends(before) > run.started) {
        broken.push(`${run.testFiles} started before ${before.testFiles} ended`);
      }
    }
  }
  return broken;
}
