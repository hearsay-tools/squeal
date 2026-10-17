# 011-12 worker notes: seam map

Worker 5fa2cb9e, 2026-10-17, on 0.1.208. Decisions confirmed by the coordinator the same day (request 5f558768).

## Where each fact comes from

- **Per-file class**: `fileClassOf` in `src/cli/verdict.ts`, shared by `readVerdict`'s counts and the named wait's per-file entries.
- **Open runs**: `openRuns` in `src/core/status/open-runs.ts`: `runs.inFlight(worktree, daemon.startedAt)`, only while the daemon is alive. Status counts the checks of an open run's file as running (`breakdown` in `snapshot.ts`), and the snapshot carries `runsOpen` for the idle line.
- **Lane**: the store records none. `laneFor` (`src/core/scheduler/slow.ts`) is the scheduler's own rule, given the runner lane. The CLI gets the runner lane from the policy (`runnerLaneOf` in `src/cli/named-files.ts`: a configured node:test or pytest project, else `vitest`), which matches the composite runner's `owners` map (adapter names `vitest`, `node-test`, `pytest`).
- **Claim**: `claimantOf` (open-runs.ts) uses `TestFileKeyRepo.claimed` as the gate, then scans other worktrees' rows to name the claimant. Its bound is the claimant's open run start plus `claimBoundMs` (`claims.ts`).
- **Unlisted revision**: the createdAt of revision `refinedRevision + 1`, plus `runnerPartBoundMs(runner.timeoutMs)`, minus now, floored at 0.
- **Unknown reasons**: `unknownReasons` in `src/core/status/unknown-files.ts`. The recorded entry at the key (256 kept) comes first, then an unknown check's summary, unkeyed, a failed project setup, another worktree's claim, and a key with no checks ("never run at this key", with the lookup-only reason when that applies). Otherwise `null`, which prints "no reason was kept".

## Text

- `src/cli/named-file-lines.ts`: `classLines` (Pending / Current / Stale / Unknown, 10 files each, then "and N more"), `reasonText` (C15's five reasons), `reasonGroups` (the verdict line's counts by reason, one clock time a group), `fileEntry` (one `wait.testFiles` JSON entry).
- Class lines print only without a clean verdict (`namedClassLines`): on a timeout, with no daemon, or settled with exit 3.
- `src/core/status/work-line.ts`: the `Discovery:` / `Idle:` line after `Affected checks`.

## For 011-11

The reason word is `queued`. When promotion lands, `PendingReason`'s `queued` variant can carry `promoted: boolean`, and `reasonText` can read "queued, promoted, behind the ... tier" (C15's wording). The daemon would need to publish promotion somewhere the CLI can read, since it lives only in the daemon's memory (C15 "Lifetime"). Otherwise the CLI can only say it asked.

## Integration

- `KEY_FORMAT_VERSION` needs a bump: `claims.ts`, `slow.ts` and `tiers.ts` are guarded sources (`test/keys/key-format.test.ts`). 011-11's scheduler changes need one too, so one bump can cover both rows.
- The skill's `references/commands.md` (three copies) still describes the named wait's output as the selection, then the failures, then the verdict. Without a verdict it now also prints the class lines before the verdict.
