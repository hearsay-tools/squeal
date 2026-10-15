# 001-418: repair of review 001-417 (cand/0.1.196, wave 14)

Baseline 3ddc950f. Each review probe is a regression test; each was checked red on the baseline's `src` before it went green.

| Item | Fix | Regression |
|---|---|---|
| B1 | `src/core/store/repos/runs.ts`: the `checkpoint-lanes.<wt>` meta map is no longer capped at 32. A lane is dropped only once its checkpoint row is gone (prune bounds both). The map's format is unchanged, so there is no schema change and older readers see the same rows. | `test/store/checkpoint-lanes.test.ts`: 40 fast-only checkpoints with no full one; an older real full run behind 40; abandoned lanes never evict a completed lane; stale ids leave the map. Each case asserts the stored map, `lastCompletedFull`, the header line and `fullSuiteReason`. |
| B2 | `src/core/delivery/liveness.ts` `asRested` inside `readLiveHeader`: during a quiet rest (`restState`), a daemon a hook spawned after the rest reads as `startingSince: spawnedAt`. Before any spawn it reads as `resting: true`, rendered as "The daemon stopped while unused". Status judges the record alone and still says down. An overdue rest, or a heartbeat after the mark, falls through to the normal down warning. | `test/delivery/rest-header.test.ts`: undelivered failure news, edit news before any spawn, overdue start, old mark against a newer heartbeat. |
| B3 | `src/core/retry/recorded.ts` `withRecorded(store, wt, states, revision)` selects the producer with `shownResult`, which moved from `status/run-log.ts` to `src/core/state/shown-result.ts` (with `observedSince`) and now also matches the fingerprint, described when not stored. The producer must match the failure's outcome, fingerprint, commit and origin. With no identifiable producer, `KnownFailure.recordedUnknown: true` and the line "recorded at an unknown time and load: …" appear in both status and registration. | `test/status/failure-age.test.ts` (re-keyed pending, stale, cached pass at the new key, same-key replacement, inherited recorded after its revision began); `test/delivery/failure-producer.test.ts` (registration: current, re-keyed pending, cached pass, same-key replacement, inherited). |
| B4 | `src/core/state/revision-commit.ts`: a HEAD move recorded at the latest revision gives the dirty flag even when it is back at the revision's own HEAD. The count and the precedence of a later content revision are unchanged. | `test/state/revision-commit.test.ts`: real-Git round trip A to B (mixed) and back to A (soft), checking the stored move and the rendered header, then a later content revision. |
| S1 | `src/core/scheduler/checkpoints.ts`: a one-lane request joined to an open checkpoint tracks its own files (`Active.lanes`) and ends `completed`, or `abandoned` after its own crash, as soon as they have results. A full joined request still ends with the owner. | `test/scheduler/checkpoint-lane-join.test.ts`, through the real `queueFullSuite`, `Checkpoints` and `newFileState`, including a slow timeout after the fast file finished. |
| S2 | `test/e2e/agree.ts`: `HEADER` reads the optional `· <sha8> + N[, dirty]` and checks it against `status.commit`. The revision, count, liveness and result assertions are kept. | The e2e suite. |

## Decisions the spec did not settle

- **B3, `why`'s ordering bound.** `why` accepts an inherited row only when it was recorded no later than the creation of the revision the state was observed at (wave-13j B4). That bound drops a common inherited case: the source records after this worktree's revision began, and this worktree then inherits at that same revision. The brief requires inherited failures to keep their facts, so `withRecorded` uses the same identity match without the bound (it passes `+Infinity`). Should `why` keep that bound for log provenance? That is for the coordinator to decide.
- **B3, failures with no stored producer.** These now print the unknown line wherever they appear, including fixtures that seed a known failure without any result row. `test/status/status.test.ts`, `test/cli/main.test.ts` and `why-run-log` / `failure-age` fixtures were updated: the fixtures now give fail states the fingerprint and observed revision real states carry.
- **B2, rest before any spawn.** A hook that delivers without ensuring (no spawn after the rest) shows "The daemon stopped while unused; results are as of revision N." It does not show the down warning or "starting".
- **S1, resume.** A lane-joined request a stopping daemon owes is resumed as before (it then ends with the open checkpoint); its own-file tracking does not survive the daemon.

## Type changes (additive)

- `KnownFailure.recordedUnknown?: true`.
- `DaemonLiveness` (down) `resting?: true`. `startingSince` is also set after a quiet rest's spawn; its doc says so.
- `withRecorded` takes known states and the revision instead of built failures (internal; both callers updated).
- New exports: `shownResult` and `observedSince` from `state/`, `RECORDED_UNKNOWN_TEXT` from `retry/`.

## The pytest e2e ENOENT (review's twentieth failure)

The cause was S2. "inherits into synced worktrees…" calls `headerRevision(told.text)` at `test/e2e/pytest.test.ts:295`, which threw on the new revision line. `withEvidence`'s catch then ran `storeEvidence`, which read `run.json` in every `runs/<id>/pytest/<project>/` directory. The pytest runner creates that directory when a run starts (`src/runners/pytest/run/run.ts:87`) and writes `run.json` only when it ends (`batches.ts:134`), so a run still in flight threw ENOENT out of the catch and hid the original error. The diagnostic now marks such runs `inFlight` and can no longer replace the failure it reports.

## Left to the coordinator

Spec D-sections (N1), `docs/board.md`, the key-format pin (the guarded sources changed: `test/keys/key-format.test.ts` asks for a bump), and `plugins/*/dist` (the bundle-drift tests fail until the rebuild).
