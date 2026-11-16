# Row 011-370: small clean-ups after card 7

Source: `quality/2026-11-15-card-7.md`, slices S2, S3, S5, S6, S8 to S11
(S7 went to row 011-366). Each item was checked against the baseline
`dd26ea2b8` first. Commit `adbe6dbc5`. Behaviour preserved: no rule,
key or output changed, so `key-format` needs no raise.

| Slice | Item | Result |
|---|---|---|
| S2 | `tierKeys`, `fileKeys` (`slow-tier.ts`) | Done: removed; no caller (`grep -rnw` over `src test evals scripts`; `fileKeys` in `test/ps` is an unrelated option name). |
| S2 | `queueSlowSuite` (`slow-tier.ts`) | Done: removed; `queueGroup`'s comment now says what it does instead of naming it. |
| S2 | `SchedulerEventKind` (`step-events.ts`) | Done: removed; no caller. |
| S3 | `step-events.ts` header "Until the step (row 011-356) …" | Done: sentence removed. |
| S3 | `step-events.ts` `SchedulerEvent` comment "until row 011-356 the pump reads only that one came" | Done: says the pump's step reads them all, and the sites outside the pump step on theirs. |
| S3 | `step-events.ts` row 011-354 block "none is posted to the pump yet" | Done: "their sites step on them in turn; none is posted to the pump". |
| S3 | `scheduler.ts` `#events` comment | Done: the step reads and clears them. |
| S3 | `scheduler.ts` `#slowMayStart` | Done: now names `Admission.asked`, which holds that rule. |
| S3 | `scheduler.ts` `#fastFirst` | Done: now names the slow lane's `waits` (`Admission.lane`). |
| S3 | The intake's `cutTiers` wake | Done: renamed `checkYields` in `request-intake.ts`, `request-intake-types.ts`, `request-intake-requests.ts`, `scheduler.ts`, `step-events.ts`, and the probe and test (`request-intake-probe.ts` logs "check yields"). |
| S5 | `#notify` | Done: `#post`, 10 sites, all in `scheduler.ts`. |
| S6 | `GLOSSARY.md` "Scheduler decision" | Done: the yield check is one decision; a rule's answer is not a scheduler decision. |
| S6 | `GLOSSARY.md` "Scheduler event" | Done: the pump's step sees a revision, applied runner work and a request only as "asked"; the step outside the pump sees them whole. |
| S8 | `SLOT_HELD_NOTE_MS` export | Done: `export` dropped. |
| S8 | `MERGE_HOLD_POLL_MS` export | Dropped: `test/scheduler/busy-merge.test.ts` imports it now (lines 4, 88, 148), after the quality scan. |
| S9 | `tier-yields-running.test.ts` | Done: merged into `tier-yields-text.test.ts`. The text file's two cases read all five named files and assert the running line, the running entry's `--json` reason, and the running standing beside the queued ones. Two scheduler setups fewer. |
| S10 | Five `step.test.ts` rows restating `yieldReach` | Done: removed "applied runner work and a request taken", "a tier started beside …", "R398 …", "a file end of a tier whose inputs changed …", "the yield bound's wake …". Kept the revision's placement case and the folding case. |
| S11 | `tier-yields-bound.test.ts` `cutPastEstimate` case | Done: the two cancel-reason checks go (`decide-yields.test.ts` holds those rows); the case keeps its `cutPastEstimate` read-backs. |
| S11 | `movableClock` (`test/scheduler/quiet-clock.ts`) | Done: removed; no caller. The brief's ownership list does not name `quiet-clock.ts`, but the brief names "an unused test clock", which is this function. |

## Not settled by the brief

- The glossary's wording of "Scheduler event": I wrote that the pump's own
  step sees the three events only as "asked", because their own step has
  already run outside the pump. This follows `scheduler.ts` (`#stepOutside`
  then `#pump`).
- `slow-tier.ts` no longer imports `CheckKey`; the only use was in
  `fileKeys`.
