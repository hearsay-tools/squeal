# Issue 10: an edited unit test stays unknown after its helper moves into e2e

Research for hearsay-tools/squeal#10 (label `friction`: an agent's friction log filed it, not a person), 2026-10-16, brief `tasks/issue-10/brief.md`. Reproduction only, no fix. Probes are in `probes/issue-10/`.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does it reproduce on 0.1.199 and HEAD with a real daemon? | Yes, on both, but the move is not the trigger. The edited test is queued and its run starts. A tracked or declared file is then rewritten with its own bytes during that run (a build). That drops the whole run (task 001-159), and the scheduler records its files `unknown` at their current key. Nothing queues them again until their key changes. The move, the slow directory and `lookup-only` each reproduce the same way without the others. The exact minimal move, with no rewrite, passes. | verified by experiment (0.1.199; HEAD 0.1.200 bundle at 30ec91a2, main 25d65b2d) |
| 1a | Was that the reporter's trigger? | Probably. Their edit and `npm run build` ran in one command. Between revisions 4 and 5, "4 running" files without checks became 4 more `unknown` (656 to 660); the tier size is 4. In the same minute, two other cezar worktrees' runs were dropped for this reason, naming `packages/cezar/dist/**`. Their own worktree's store rows and run logs are gone, so this is not confirmed. | inferred, from the session transcript and the cezar store |
| 2 | Is it already a board row? | No. 001-364 (planned) is the nearest: a `dist` edit cancels a backlog tier and loses its finished results. 001-159 and 001-168 specify this outcome. 001-403 (done) keeps the reason, but this report shows it does not reach a named wait. | read in `docs/board.md` |
| 3 | Does it fit the vision? | Yes. It is filter items 1 and 3: the agent was left without a result and without a reason, so it ran the suite itself. | read in `docs/vision.md` |

## Findings

### 1. Reproduction

**The reported steps alone do not reproduce it.** Fixture `a199` on 0.1.199 used `lookup-only`, cezar's `slow.include` and `inputs`, and no cached results. The move and both import edits were made in one step. At revision 1 the unit test ran and passed:

```text
$ squeal status --wait 60000 packages/web/src/lib/nav-contract.test.ts      # exit 3
Named test files have no verdict: the deadline passed after 60.0 s: 1 test file still pending at revision 1
Selected: packages/web/e2e/nav.e2e.ts, packages/web/src/lib/nav-contract.test.ts
Affected checks: 2 passed (1 test, 1 test file loaded), 0 running, 0 queued
$ squeal why packages/web/src/lib/nav-contract.test.ts
"packages/web/src/lib/nav-contract.test.ts" matches 2 checks in this worktree: ... (1 result, 1 pass / 0 fail)
```

The exit 3 is the slow e2e file, which was waiting for host load. Naming the unit test also selected the e2e file, because the e2e file's `inputs` glob `packages/web/src/**` covers the unit test. `b199` added the reporter's deletion of a module and its test in the same step, plus same-bytes rewrites at 1 s intervals. The unit test passed again, because no rewrite landed inside its ~1 s run. *Verified by experiment.*

**A rewrite during the edited test's run reproduces it.** `drive-touch.sh` makes the edit. It waits until `status --json` shows a file running, rewrites `packages/server/dist/*` once with the same bytes (no file in any test's closure), then waits on the named file. The unit test sleeps 4 s so that the rewrite lands inside its run. Results, all on fresh fixtures:

| Fixture | Squeal | Policy | Edit | Rewrite mid-run | Edited test afterwards |
|---|---|---|---|---|---|
| `a199` | 0.1.199 | lookup-only | move | no | pass |
| `c199` | 0.1.199 | lookup-only | move + delete | yes | `unknown`, unqueued; still so 35 s later |
| `dhead` | HEAD | lookup-only | move + delete | yes | `unknown`, unqueued |
| `ehead` | HEAD | lookup-only | move + delete | no | pass |
| `fhead` | HEAD | default, baseline ran | move + delete | yes | `unknown`, unqueued |
| `ghead` | HEAD | lookup-only | no move, a comment added | yes | `unknown`, unqueued |

On HEAD, the named wait gives the reporter's exact first line:

```text
Named test files have no verdict: 1 test file without a current result at revision 1 (1 unknown)
...
Test files without a result: 6 (nothing current at their inputs, none queued)
  web: packages/web/src/lib/nav-contract.test.ts: no result: vitest: vitest adapter: packages/server/dist/m1.js, ...
       packages/server/dist/m9.js was written during this run and ended as it was; the run may have executed bytes no check key names (task 001-159)
```

`file-state.sh` gives `{"revision":1,"unknown":{"ran":false,"reason":"vitest: vitest adapter: packages/server/dist/m1.js, ..."}}`. `why <path>` gives "No check matches", the reporter's line, because a dropped run stores no checks. Recovery needs a key change: in `fhead`, a comment added to the test (revision 2) ran it and it passed. *Verified by experiment.*

**The code path.** A same-bytes write is handed to the runner as a touch (`src/core/scheduler/scheduler.ts:231`, `src/runners/vitest/adapter.ts:280`). A run that heard one is reported by `withoutTouched` (`src/runners/vitest/moved.ts:77`) with no file completed. `recordTier` puts each file that did not complete into `unknown` (`src/core/scheduler/tiers.ts:444`). `markUnknown` then sets `unknownKey` to the file's current key and takes it off the queue (`ledger.ts:373`). `settle` leaves a file alone when its key is its `unknownKey` (`ledger.ts:205`). The spec says so too. D4 "Touched files": "A run under the old instance when the touch is heard makes all its files not completed ...; the scheduler records them `unknown` (D5)". D5: "An unkeyed or `unknown` file is always work to do: baseline and `run --all` include it". A content change during a run is different: it is "discarded and re-queued" (D5, `Ledger.discard`). *Read in source code and the spec at 25d65b2d.*

**Why the reporter saw no reason.** A named wait prints no reason; `gapText` is only used by `run --all --wait` (`src/cli/run.ts:137`). The status body lists at most `UNKNOWN_FILES_LISTED` = 20 unknown files from the whole worktree, in path order (`src/core/status/unknown-files.ts:22`). In cezar, 660 unknown files under `lookup-only` put `api-client`, `contract` and `root:test:unit` ahead of `web`. The reporter's saved `/tmp/cezar-1141-squeal-status.json` lists 20 of 654, none of them `web`. *Read in source code; verified in the reporter's saved file.*

### 1a. The reporter's session

The Codex rollout `~/.codex/sessions/2026/10/16/rollout-2026-10-16T21-13-20-…jsonl` (worktree `a409e9bb`, 0.1.199) has one command at 19:14:57 UTC. A Python script moved the helper, edited both importers, deleted four modules and a test, and edited `index.css`; then `npm run typecheck:web` and `npm run build` ran. Squeal's own lines from that session:

```text
19:15:33 revision 3: Squeal saw your edit and queued 101 test files ... Test files without checks: 90 pending, 656 unknown.
19:15:54 Revision: 4 ... 90 test files without checks yet: 4 running, 86 queued
19:17:17 Revision: 5 ... Test files without checks: 86 pending, 660 unknown
         Named test files have no verdict: 1 test file without a current result at revision 5 (1 unknown)
```

So the edit queued the test files it reached. Four files that were running at revision 4 ended `unknown` and unqueued. That fits a 4-file tier dropped as above. In the cezar store, runs `ac1c069a` (worktree `9941e3ee`, 19:15:14 to 19:15:27) and `b31e8e4e` (worktree `18d62e02`, 19:16) ended with "vitest adapter: packages/cezar/dist/... was written during this run and ended as it was". This shows that cezar builds trigger the rule. `packages/cezar/dist/**` is a declared input, so it is hashed and its rewrites count (D4). Which run held `github-nav-contract.test.ts` is not determined: worktree `a409e9bb` has no rows left in `runs`, `revisions` or `worktrees`, and no run log on disk names the file before 20:03. *Inferred.*

### Reporter claims, sorted

| Claim | Status |
|---|---|
| "did not queue an edited web unit test" | Not supported. It was queued and then dropped; see the timeline above and every fixture. |
| repeated exact-file waits stay unknown | Confirmed: the file stays unknown until its key changes. |
| 660 unknown and not queued; daemon alive | Expected under `lookup-only` for untouched files (D11). The edited file is the defect. |
| `why` says no check matches | Expected: the file has no checks; `why` takes a check. |
| crossing the `slow.include` boundary may be the cause | Refuted: `ghead` reproduces with no move. |
| "Selected: ... precisely the unit test" | Not matched in the fixture, where the e2e file was selected through its `inputs`. Why cezar selected only the unit test was not determined. |

## Recommendation for Squeal

The coordinator should file this as a defect against D4/D5 as specified: an unrelated build can turn a file an edit caused into a silent `unknown` with no automatic retry. The tradeoff that decides the fix is between D4's caution and D5's promise that edited files get results. A withheld run's bytes may be wrong, so storing them stays ruled out. Re-queuing the files, as a content discard is re-queued and counted toward `MAX_DISCARDS`, keeps D4's guarantee and ends the silence. A second, independent gap is that the named wait should give each selected unknown file's reason. One acceptance test should be `drive-touch.sh` as a scheduler test: the edited file is current after one more run, and stays `unknown` with its reason after `MAX_DISCARDS` touched runs. The issue's own acceptance criterion about relocating a dependency tests the wrong cause.

## Open questions

- Is a re-queue on touch safe against a build that rewrites its output during every run? `MAX_DISCARDS` would bound it, but this was not measured.
- Why did cezar's named wait select only the unit test when the e2e `inputs` cover it?
- Whether 001-364 (cancelled backlog tiers losing results on a `dist` edit) should be fixed together with this, since both come from builds writing `dist` during a run.

## Sources

- https://github.com/hearsay-tools/squeal/issues/10 (read 2026-10-16).
- Spec 001 D2, D4 "Touched files", D5, D11, D12 and `status.md` (001-159, 001-168), at 25d65b2d.
- `src/core/scheduler/{ledger,tiers,scheduler,bootstrap}.ts`, `src/runners/vitest/{adapter,moved}.ts`, `src/core/status/unknown-files.ts`, `src/cli/{verdict,run}.ts`, at 25d65b2d.
- `docs/board.md` rows 001-159, 001-168, 001-364, 001-403; `docs/vision.md` decision filter.
- The reporter's Codex rollout above, `/tmp/cezar-1141-squeal-status.json`, the cezar store `~/projects/cezar/.git/squeal/store.sqlite` read only, and run logs `~/projects/cezar/.git/squeal/runs/{ac1c069a,b31e8e4e}*`.
- Probes: `probes/issue-10/README.md`.
