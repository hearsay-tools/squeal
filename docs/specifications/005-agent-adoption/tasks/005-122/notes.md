# 005-122: the quality scan's slices 1 to 15

Wave 29 W1, worker c6532348, baseline `cand/0.1.559` plus the wave-29 brief. Scope: `quality/2026-11.md`, section "Slices", items 1 to 15; note N1 of `reviews/0.1.553.md`; and, on the coordinator's message during the wave, S1 of `reviews/0.1.559.md`.

## One line per slice

1. Done: proof `2cfc67909`, removal `be8619935`. The claim held (measures below). `WaitForm` loses `short`; `folded` keeps only the folds with the CLI unnamed; `waitSentence`'s plain form is only the unnamed sentence.
2. Done, `8c8e11e2f`. `PASSES_SILENT_TEXT` lives in `late-format.ts`, not beside `quietEditsText` in `format.ts`: `format.ts` imports `late-format.ts`, so the brief's place makes an import cycle. No text change.
3. Done, `f4a062fb1`. `knownFailuresCountLine(counted, failures, header, command)` in `format.ts`; `text.ts` passes Stop's count line. No text change.
4. Done, `cf086c4e6`. `showsOwnCount(header, form, told)` in `header.ts`; `newsLine` uses it for its owed-counts branch, and `delivery.ts` calls it in place of `ownShown`. 005-111 did not move it.
5. Done, `6a9d7b1c3`. The slow-start sentence already used `utcTimeText` (row 005-111). "No daemon has validated since" is built once, `notValidatedSinceText` in `header-daemon.ts` (where the header's daemon sentences moved), and used by the header, the Not validated line and the wait's no-daemon verdict. `squeal status`'s Outstanding line (`next-step.ts`) keeps its ISO time, as every other status line does: not a hook text. Text change below.
6. Done, `ef1161c50`. `ageText` calls `durationText` below two hours; from two hours it still says `N h`. Text change below.
7. Done, `3d96aac89`. Four copies, not two: `format.ts`, `late-format.ts`, `failure-groups.ts` and `shared-closure.ts` (`capitalizeFirst`). One `capitalize` in `src/core/text.ts`.
8. Done, `bbeb9c65b`. One `NO_RESULTS_HERE` for the unlisted line's three sentences. `noResultsText` keeps its own words ("is still starting … has no results yet"): merging them would change text the scan did not ask to change.
9. Done, `8c3fca644`. True: no test ran the real slow-start or stopped-start text through the parser. `test/evals/slow-start-evidence.test.ts`: titles, full headers and registrations, listed and unlisted, plain and in hook JSON. 24 of its 36 cases fail with the three alternatives taken out of `NO_DAEMON`.
10. Done, `e967ae9b3`.
11. Done, `19495c756`. `birthMarkOf` and `checksBornBy` are test-local helpers in `test/store/state-born.test.ts`.
12. Comments done, merge dropped: `05721feb8` merged the queries, `59f03882f` took the merge back and kept the comment fixes. `key-format.test.ts` passed with the merge, but `test/delivery/idle-scope.test.ts` failed: that test wraps the store in a `Proxy` to count repository reads, and `connectionOf` does not reach `openStore`'s connection through it. The no-mark read stays `KnownStateRepo.untold`, whose comment now says it is for a consumer with no birth mark and names `untoldBornAfter`. `view-seed.ts` and `consumers.ts` comments reworded.
13. Done, `8cb50d0a7`. `succeeds` and `requestStepDown` are exported and tested directly. Two old cases leave with the wrapper: the default version (production passes `deps.squealVersion ?? squealVersion()` in `handOver`) and the stale heartbeat (production never reaches `handOver` with a stale heartbeat: `ensureIfStale` ensures instead, and `handOver` reads `alive` through `readHookHandoff`). I did not find a test that pins "a stale older daemon is asked nothing" at `ensureIfStale`; a reviewer may want one. Its doc comment's history moved onto `succeeds` and `requestStepDown`; `flags.ts` names `succeeds`.
14. Done, `47695015b`. Four test files read `readLockMarks(f, now).start() !== null` (`wait-locked` through a local `startMarked` helper). `markedPid` took over the doc comment.
15. Skipped, as the brief allows.

- Review 0.1.553 N1: done, `87a296a2f`. Comments only.
- Review 0.1.559 S1: done, `8b1f0ec42`. `MARK_FINDERS` admits `unknown`; a test in `test/store/open.test.ts` for a well-formed `found: "unknown"` mark (finder kept, neutral stop text, recovery note without `check`, `checkedAt`, `markedAt`); it fails without the fix. A mark with no finder or another finder still reads as the full check's.

## Text changes

Slice 5, every hook and wait text that says it:

- Before: `No daemon has validated since 2026-10-04T14:02:00.000Z; results are as of revision 184.`
- After: `No daemon has validated since 14:02:00 UTC; results are as of revision 184.`
- Before: `Not validated: no daemon has validated since 2026-10-11T05:42:42.946Z; any change this call made has no result.`
- After: `Not validated: no daemon has validated since 05:42:42 UTC; any change this call made has no result.`
- Before: `Returned without a daemon: no daemon has validated since 2026-10-06T11:59:00.000Z: the daemon stopped; …`
- After: `Returned without a daemon: no daemon has validated since 11:59:00 UTC: the daemon stopped; …`

Slice 6, every text that says an age through `ageText` (hook header, status, the checkpoint line):

- Before: `The daemon's heartbeat is late: the last one was 90 s ago, at …` / `the last one was 60 s ago`
- After: `The daemon's heartbeat is late: the last one was 1 min 30 s ago, at …` / `the last one was 1 min ago`
- Before: `Daemon: stopping since … (2 min), past its 130 s bound` / `started 90 s ago`
- After: `Daemon: stopping since … (2 min 10 s), past its 130 s bound` / `started 1 min 30 s ago`
- Unchanged: under 60 s (`1 s ago`), and from two hours (`2 h`).

The heartbeat-late sentence's `at <time>` is still a full ISO time (`lateHeartbeatDetail`); the scan did not list it.

## Slice 1 measures

Before the removal, per coverage in `test/harness/primer-wait-forms.test.ts`, CLI lengths 10 to 2,000:

| Coverage | Path wait, CLI named | Then |
| --- | --- | --- |
| Vitest alone | 10..917 | path wait, CLI unnamed |
| slow files, required | 10..571 | path wait, CLI unnamed |
| many node:test projects | 10..530 | plain wait, CLI unnamed |
| check groups | 10..338 | plain wait, CLI unnamed |
| no test group at edit | 10..816 | path wait, CLI unnamed |

The short form and the CLI-named plain form: 0 of 9,955 primers.

## Pinned texts and e2e

- `test/e2e/lifecycle.test.ts` pins both changed sentences: updated (`utcTimeText(down.daemon.since)`, and the age pattern accepts `1 min 30 s`). Not run: the e2e harness copies the committed plugin bundles, which the brief leaves to the coordinator's build. Run it after the build.
- `evals/lib` parsers match neither the timestamp nor the age; unchanged. The skill references say `<time>`; unchanged.
- Bundles: no build here (brief). `plugins/*/dist` drifts until the coordinator builds.

## Seam map

- Hook daemon sentences: `src/core/delivery/header-daemon.ts` (`daemonText`, `slowStartText`, `stoppedStartText`, now `notValidatedSinceText`). The unlisted line: `unlistedLine` in `header.ts`.
- Ages: `ageText` in `src/core/status/status-detail.ts`, used by status, the checkpoint line (`outstanding-text.ts`) and `lateHeartbeatDetail`. `src/core/daemon/terminate.ts` has its own `ageText` over seconds, a different one; not in the scan.
- Untold reads: `KnownStateRepo.untold` (no mark), `untoldBornAfter` (with a mark), chosen by `untoldStates` in `view-mark.ts`. A test that proxies the store sees only the repository read.
