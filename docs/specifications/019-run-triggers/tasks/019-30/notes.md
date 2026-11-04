# 019-30 notes: Stop's first hold, last hold and a predecessor that never starts

Worker 1d729eab, 2026-11-04. Brief `tasks/wave-5.md`, 019-30; problems P3, P5 (option a) and P6 in `lessons.md` Round 1, "Proposed rows". Base `68c033886` (cand/0.1.399 plus the wave 5 briefs). No build: the bundles are the candidate's.

## What changed

1. **P3, the first Stop's race.** `waitingEntryRecorded` (`stop-decide.ts`): when the 2 s entry's decision is a hold for required checks, the main agent has no hold counted this turn, and the harness has a waiting entry (Claude Code, Codex; not Pi or OpenCode, which pass `pi`), the entry polls every 25 ms for the waiting entry's record (`stopWaitRuns`) until `STOP_RECORD_WAIT_MS` (500 ms) after its context opened. When the record comes, `decideTurn` (`stop.ts`) reads its rules again: the required checks are the waiting entry's, the 2 s entry ends the turn with the handoff, and the waiting entry decides. Without the record by then, the 2 s entry holds as before and counts it.
2. **P5 (a), why a group never started.** `pendingBefore` (`core/state/required.ts`): for a group with files not current at the bound, none of them running (key phase `running`), the groups of its `after` with test files pending, in `after` order, counted by `classifyGroupFiles` as their status lines count them. The waiting entry's bound reason carries it after the file list.
3. **P6, the last hold.** A hold that makes the turn's count reach `stop.maxHolds` gets a line after its reasons, naming each held group's command. Both entries: the waiting entry's bound and failure holds, and the 2 s entry's immediate hold (no waiting entry). A SubagentStop's one hold does not say it.
4. **Without `checks`.** P5 and P6 apply only when `groupTextsShown(policy)` (a `checks` key), through `StopRequired.groupTexts`. Every text of a policy without `checks` is as before; P3 changes no text.
5. **Moved.** The group hold reasons (`stopGroupWords` to `requiredFailuresReason`) moved from `text.ts` to `stop-text.ts`, unchanged but for the new parameters; `text.ts`'s `list` is exported as `listNames`.

## Words chosen

- P5, after the list of files: `They have not started: they run after the unit group, which has 872 test files pending.` Several groups: `they run after the unit and api groups, which have 872 and 12 test files pending.`
- P6, its own line after the reasons: ``This is Stop's last hold this turn: no later Stop in it waits for the e2e group, and `squeal run e2e --wait` runs it and waits for its results.`` Several groups: `the e2e group and the slow tier, and … and … run them and wait for their results.`

## Type changes (additive)

- `StopRequired`: `groupTexts`, `after(group)`, `ownerOf(ref)`.
- `StopRules`: `lastHold`.
- New: `PendingBefore`, `pendingBefore` (`core/state/required.ts`, not re-exported from `core/state/index.ts`, which is not this row's), `STOP_RECORD_WAIT_MS`, `waitingEntryRecorded`, `lastHoldText`, `withLastHold`.
- `slowWaitReason` gains a 7th parameter `before` (default none); `requiredWaitReason`'s options gain `before`.

## Decisions the spec did not settle

- **Which holds wait for the record.** Only a hold before any other this turn. The waiting entry records at its start, so after one Stop of the turn without a record it does not run for the session; a later hold would wait 500 ms for nothing. Cost when the waiting entry does not run (Codex before the user trusts the hook): the turn's first hold for required checks comes up to 500 ms later. A Stop that does not hold never waits.
- **The 500 ms is measured from the 2 s entry's start** and overlaps its `stop.waitMs` wait for pending checks, so the hook's run time and its store busy timeout are as before (`stopBusyTimeoutMs(max(wait, 500))` equals `stopBusyTimeoutMs(wait)` for every honoured `waitMs`).
- **"Not started"** is read from the store: no file of the group not current has key phase `running`. A file a run holds under an old key, re-keyed and queued again, reads as not started.

## Checks expected to fail until the build

`test/harness/plugin.test.ts` "bundles are committed exactly as `npm run build` produces them" and `test/harness/codex/packaging/runtime.test.ts` "has the bundles exactly as `npm run build:plugin` produces them": drift only.

## For the next worker

- `test/e2e/run-triggers-moments.ts` `firstStop` starts the waiting entry first and waits for its record, to dodge P3. With 019-30 in the bundles it can start both entries at once, as the harness does. Not changed here: `test/e2e` is not this row's, and 019-28 changes `run-triggers.test.ts`.
- `src/harness/shared/stop.ts` (about 350 lines) and `stop-slow.ts` (about 365) stay above the styleguide's 300; both were above it before this row.
