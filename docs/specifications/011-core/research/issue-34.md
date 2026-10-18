# Issue 34: pending reruns counted among known failures

Date: 2026-10-18. Issue: https://github.com/hearsay-tools/squeal/issues/34. Checkout: `cez/b0279ef7` at `905b7b6c`, package 0.1.213. Installed plugin: 0.1.199 (`squeal--v0.1.199`, `e36fea56`).

## Reproduction verdict

**Reproduced** with synthetic stores on both the checkout (0.1.213) and the installed plugin's CLI (0.1.199). The original live incident (a hearsay-tools/cezarion worktree, 38 failures observed at revision 24 and pending at revision 30) was not re-run. The issue does not say which Squeal version that session ran.

Host load before the live steps: `cat /proc/loadavg` gave `7.44 3.98 2.40` and `nproc` gave `24`, so the load was below the CPU count and reproduction went ahead. Load stayed between 3.6 and 5.2 during the probes. Nothing was built, and no test suite was run.

## Questions answered

| #   | Question                                                                 | Answer                                                                                                                                                          | Tag                                                               |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Does `squeal status` count a failure pending a rerun as a known failure? | Yes. Every known state with `outcome: "fail"` is counted, whatever its validity (`current`, `pending`, `stale`).                                                | verified by experiment (0.1.213, 0.1.199); read in source code    |
| 2   | Does the registration header do the same?                                | Yes. It uses the same `withRecorded` → `failureCountText` path.                                                                                                 | read in source code (0.1.213, 0.1.199)                            |
| 3   | Do Stop and the hook status line do the same?                            | The count line does. Stop's `stop.blockOnKnownFailures` reason already splits current failures from earlier ones.                                               | verified by experiment (`knownFailuresLine`); read in source code |
| 4   | Does the issue's shape match a distinct validity in the store?           | Yes. `classify` gives `pending` when the result's key is not the file's current key and the new key is queued or running.                                       | read in source code                                               |
| 5   | Is this a duplicate of an existing row or issue?                         | No #34 row is on the board, and 011 `status.md` has no #34 entry. The parent found no exact open duplicate.                                                     | read in board.md, status.md                                       |
| 6   | What should the headline say?                                            | Not determined, because whether a pending entry counts as a known failure is a choice about product meaning, and that choice is the human's. Options are below. | inferred                                                          |

## Findings

**F1. The count ignores validity.** `verified by experiment`. `probe.mjs incident` seeds 38 fail states, all observed at revision 24 and `pending` at revision 30. The checkout prints:

```text
-- status --json counts: {"current":0,"pending":38,"stale":0,"unknown":0}
Revision: 30
Known failures: 38 (38 tests)
  FAIL  src/a.test.ts > t0
        observed at revision 24, pending
-- Stop / hook status line:
Known failures: 38 (src/a.test.ts > t0, ... and 33 more; `squeal status` lists every one)
```

`probe.mjs mixed` (one current, two pending, one stale) prints `Known failures: 4 (4 tests)` while `status --json` holds `knownFailures` validities `{"current":1,"pending":2,"stale":1}`. The JSON already has what an agent needs to count current failures. The text headline does not show it.

**F2. Same on the installed 0.1.199.** `verified by experiment`. `installed.sh` reads the `mixed` store with `~/.claude/plugins/cache/hearsay/squeal/0.1.199/bin/squeal status` under a temp `HOME`:

```text
installed: 0.1.199
Revision: 30
Known failures: 4 (4 tests)
Store schema: 1
```

`read in source code`: at the tag, `format-status.ts:44`, `delivery/format.ts:349` and `stop.ts:299` build the line the same way. `state/header.ts`, `status/checks.ts` and `retry/recorded.ts` are unchanged between the tag and `905b7b6c`.

**F3. Code paths.** `read in source code` (0.1.213):

- `src/core/state/header.ts:251` `toKnownFailure` returns a failure for any `outcome === "fail"` and carries `validity` through.
- `src/core/retry/recorded.ts:65` `withRecorded` keeps every one. Status (`status/snapshot.ts:136`) and registration (`delivery/delivery.ts:304`) both read from it.
- `src/core/status/checks.ts:69` `failureCountText` counts checks only.
- `src/core/status/format-status.ts:42` and `src/core/delivery/format.ts:366` print the headline. Each entry's own line names the validity (`observed at revision 24, pending`), which is why the agents in the issue had to read every entry.
- `src/harness/shared/stop.ts:304-309` passes every fail state to `knownFailuresLine` (`harness/shared/text.ts:41`).

**F4. A split already exists, but only at Stop.** `read in source code`. `stop.ts:220-225` blocks only on `validity === "current"` failures (review wave 3, S1: "failures whose re-run is pending are named as such, never as existing"). `knownFailuresReason` (`text.ts:71`) words the rest as "N checks last failed at an earlier revision and their re-runs at revision R are pending", and stale ones as "have no result for the current files". So the policy decision splits the count, but the status, registration and Stop count lines do not.

**F5. What "pending" covers.** `read in source code` (`state/derive.ts:48`; spec 011 C4). A failure is `pending` only when its key moved and a run for the new key is queued or running. A forced re-run at the same key (001-171's confirmation re-run, or a `squeal retry` at the current key) leaves the result `current`. C5 says such a FAIL "stays counted in `Known failures` until a retry's run passes". So the split the issue asks for does not change how C5 counts a retry. `stale` (the key moved and no run is queued) is a third case, and the issue does not mention it.

**F6. The checkpoint verdict is not affected.** `inferred` from `src/cli/run.ts:338-340`. `run --all --wait` returns its verdict only once no lane file is pending, so its `Known failures` line and exit 1 never include a pending failure. The issue's live case belongs to `status` (and to registration and Stop), not to the checkpoint.

**F7. Related only.** `inferred`. #3 explains where the incident's 38 failures came from: a packaged-CLI tier with no build in the worktree. It does not explain why the count lumps them together. #20 (retry classification), #23/#24 (named state), and #32 (baseline provenance) touch the same lines but not this count.

## Vision and spec fit

`read in docs/vision.md`: "An old result never gets to pose as the current truth". At any moment Squeal can tell apart "what it has validated for the current revision" from "what it last knew on an older revision". A headline that counts revision-24 failures at revision 30, with no qualifier, cuts against that. The vision's example shows the bare `Known failures: 0`. C6 (Status) owns the text and JSON, C5 owns the validity terms and delivery views, and C4 defines `current/stale/unknown/pending`. If the human accepts a change, it is a C6 amendment that touches C5's registration header and the shared Stop line (C8, all harnesses).

## Semantics: the human's decision

Whether a pending (or stale) failure is a "known failure" is the open question, and the issue argues one side. Options:

1. **Split, keep the total.** `Known failures: 38 (0 current, 38 pending rerun)`. Every list keeps its entries, and the JSON gains counts by validity. Least disruption.
2. **Current only in the headline (the issue's position).** `Known failures: 0`, then `Earlier failures: 38 pending rerun, 0 stale (not counted until a rerun fails)`. This matches the vision wording and Stop's policy split (F4), but `Known failures: 0` while 38 reruns are queued might read as "done". The full-suite and pending-count lines would have to carry that warning.
3. **Leave the count as it is.** Rely on each entry's validity line and the JSON.

Two further points need the same decision: where `stale` failures go (pending rerun or their own bucket), and whether Stop's `knownFailuresLine` follows the status wording. Recommendation, `inferred`: option 1 or 2, decided once for all three surfaces, with stale named apart from pending as Stop already does.

## Suggested done-when

- `squeal status`, the registration header and the Stop/hook count line give the current failures apart from those pending a rerun, and from stale ones, with the same wording on all three, per the option the human picks.
- `status --json` exposes the same split as counts, so an agent never has to group `knownFailures` itself.
- A test seeds a store with failures of each validity (the `mixed` shape here) and checks every surface. A same-key forced re-run or retry still counts as current (F5).
- `run --all --wait` verdict and exit codes do not change (F6).
- 011 C6 (and the C5 header sentence) are amended in `status.md` with the human's decision.

## Commands run

```sh
cat /proc/loadavg; nproc                      # 7.44 3.98 2.40 ... ; 24
gh issue view 34 --repo hearsay-tools/squeal
squeal --version                              # 0.1.199 (launcher -> installed plugin)
node -p "require('./package.json').version"   # 0.1.213
docs/specifications/011-core/research/probes/issue-34/run.sh        # F1
docs/specifications/011-core/research/probes/issue-34/installed.sh  # F2
git show 'squeal--v0.1.199':src/core/status/format-status.ts | grep -n "Known failures"
git diff 'squeal--v0.1.199' HEAD --stat -- src/core/state/header.ts src/core/status/checks.ts src/core/retry/recorded.ts
```

## Open questions

- Which option (above) the human picks, and where stale failures go.
- Which version the cezarion incident ran. The issue does not say. The installed launcher on this host resolves 0.1.199.
- Whether the "Affected checks" line should change along with the count. It was not exercised here: the synthetic store has no test-file keys.

## Sources

- https://github.com/hearsay-tools/squeal/issues/34 (read 2026-10-18)
- `docs/specifications/011-core/spec.md` C4, C5, C6; `docs/vision.md` "2. Results are tied to code state" and "The desired experience"
- `src/core/state/header.ts`, `src/core/state/derive.ts`, `src/core/retry/recorded.ts`, `src/core/status/checks.ts`, `src/core/status/format-status.ts`, `src/core/delivery/format.ts`, `src/harness/shared/stop.ts`, `src/harness/shared/text.ts`, `src/cli/run.ts` at `905b7b6c`, and the same files at `squeal--v0.1.199`
- `research/probes/issue-34/` (throwaway probes, README)
