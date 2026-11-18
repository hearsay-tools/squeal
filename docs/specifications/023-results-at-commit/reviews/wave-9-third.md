# Wave 9 third review: each proof run keeps its first result

PASS ca00d0238479ceacbc074755e42551267a031642

Zero blockers. Zero new should-fix findings or nits. The load-retry defect reported by candidate CI is closed. No product code was edited.

This is a narrow review of `41d4fa9a923f3f27b2dad77e85ef986f44475529`, its callers, tests and rebuilt bundles, since the previous reviewed candidate `6254ae87fb38acbccd910721d4bff1076093ab16`. It checks D5.4's first-failure rule, single runs, conditions, stored outcomes and preservation of D4's `status --at --run` behavior. B1 through B3 remain settled by `wave-9-rereview.md`; their implementation did not change. That review's CI observation was pending evidence: [run 44299153586](https://github.com/hearsay-tools/squeal/actions/runs/44299153586) later failed and exposed this defect.

## Verification

The code checks and probe ran at the exact candidate on a clean product tree, before adding this report. Dependencies were already installed. No setup install or local full suite ran. Direct commands used `timeout 600`.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch`; `git checkout --detach ca00d0238479ceacbc074755e42551267a031642`; `git rev-parse HEAD`; `git status --short` | Exact requested candidate; clean. |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3723 files in 1177ms. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`. |
| `timeout 600 pnpm run build`; `git diff --exit-code`; `git status --short` | Exit 0; four plugin builds completed; no bundle drift or tracked changes. |
| `timeout 600 pnpm run check:version origin/main HEAD` | Exit 0: `0.1.561 -> 0.1.562, ok`; adapter `1.0.3 -> 1.0.3, ok`. |
| Focused Squeal waits | Four named files current at revision 9. Expanded read at revision 11: ten named files current, no known failures, after 2.4 s. Whole worktree still had 89 of 1979 files not current: 12 running, 72 queued, five unknown. |
| Full Squeal wait before the report | Exit 0, returned on timeout after 60.6 s at revision 11. No known failures; 83 affected files still pending. Whole-worktree counts remained 12 running, 72 queued and five unknown. This is incomplete coverage, not a full pass. |
| Independent synthetic-load probe | Completed job exit 0: six proof paths, two subsequent store reads and one `status --at --run` control, using real Git repositories, Vitest and the packaged CLI child. Details below. |
| `timeout 600 pnpm run check:private` | Candidate scan exit 0: 10548 added lines in 74 files, `ok`. Repeated after committing this report: exit 0, 10625 added lines in 75 files, `ok`. The check warns that `SQUEAL_PRIVATE_DENYLIST` is empty, so that rule is skipped. |
| [Candidate CI 44303944719](https://github.com/hearsay-tools/squeal/actions/runs/44303944719) | At the last read, Node 24 checks passed; all six Node 22/26 test shards were in progress. Full-suite result unverified. |
| [Private material CI 44303944664](https://github.com/hearsay-tools/squeal/actions/runs/44303944664) | Completed successfully at this exact candidate. |

The expanded focused read used the session launcher, shown with `~`:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/proof-load-retry.test.ts test/cli/proof-repeat.test.ts \
  test/cli/proof-review9.test.ts test/cli/proof-conditions.test.ts \
  test/cli/proof.test.ts test/cli/status-at-run.test.ts \
  test/cli/status-at-run-env.test.ts test/code/gate/collect-retry.test.ts \
  test/code/gate/lanes-retry.test.ts test/code/gate/keep-early-retry.test.ts
```

An earlier expanded read mistakenly named two nonexistent test paths and returned exit 3. The corrected read above returned exit 0. This was a review-command error, not a candidate failure.

## The retry boundary is complete

**Proven by source inspection and the independent child-process probe.**

- `src/cli/proof-side.ts:157` sends every pending side through `runFiles`. This covers both proof sides, every case, conditions, the default single run and every repeat round. The only proof call of `runInChild`, at `src/cli/proof-run.ts:122`, unconditionally gives `retry: false`. Store eligibility does not alter that flag.
- `src/cli/status-at-run-child.ts:122` serializes the flag into the request. At line 80, the child passes `hostLoad: noLoadRetry` only for explicit `false`. The callback returns `oneMinute: null`. `runGateFiles` forwards it to `collectEvidence` in both the stored and unstored branches. `collectWithStores` preserves that option.
- `src/core/code/gate/lanes.ts` asks `overloadedOf` after each original chunk. `src/core/code/gate/retry.ts:64` refuses a retry when the sampled load is unknown. Thus the proof has no overloaded files, no rerun, no `afterRetry` replacement and no `retrying` files held for a later result by the keeper. Every file's first result stands.
- The separate stored-failure replacement in `afterStoredRerun` has no eligible files here. `runGateFiles` passes neither parts nor `rerunFailures` to `collectWithStores`; the latter defaults to `false`. Chunks divide files into disjoint groups. Joining their logs does not replace the returned test-file evidence. No additional gate rerun or outcome replacement was found on this path.
- The proof repeat loop continues a file only after `pass`. Its first red failure ends red; its first green failure ends green with `not green`. A later retry cannot consume another counter value or turn that failure into a pass.
- `src/cli/status-at-run.ts:127` still omits `retry`. Serialization omits it, and the child leaves the real host-load callback as the gate's default. D4's retry policy is unchanged.

`test/cli/proof-load-retry.test.ts` discriminates the mechanism without creating CPU load. Its real-adapter fixture fails only on its first execution. The supplied overloaded callback produces `passed` through the gate's existing retry; `noLoadRetry` produces `failed`. Its current Squeal result is a pass. The independent probe below also verifies the flag across the actual request file and packaged child, which that direct-gate test does not exercise.

## Independent observations under synthetic overload

The successful job ran `env HOME="$TMPDIR/w9third-bootstrap-home" NODE_ENV=test timeout 600 pnpm exec tsx "$TMPDIR/w9third-probe.mts"`. Every fixture, HOME and counter was under `$TMPDIR`. A child preloader supplied `os.loadavg() = [1000, 1000, 1000]` and synchronized the built-in ESM export. A separate child confirmed the reading. This created no CPU load. The proof parent called the real parser and command; each run used `plugins/claude-code/dist/cli/squeal.mjs`. The fixture installer linked the prepared Vitest, so this does not independently validate package-manager installation.

Counters recorded actual test executions, independently of the report's run count. Test files failed only on specified executions. Coverage was enabled for stored controls and one conditioned control, and disabled for the other controls.

| Control | Actual result |
| --- | --- |
| Single source proof, red fails once and would pass a retry | `proven`; red 1, green 1; one actual execution at each source version. Both outcomes stored. |
| Same command again | `proven`; red 0, green 0; reads stored outcomes; counters unchanged. |
| Single source proof, green fails once and would pass a retry | `not green`; red 1, green 1; one actual execution per side. Both failures stored. |
| Same failed-green command again | `not green`; red 0, green 0; counters unchanged. |
| Test case, red fails only on round 2, `--repeat 3` | `proven`; red 2, green 3; exactly five executions; nothing stored. |
| Source case, green fails only on its round 2, `--repeat 3` | `not green`; red 1, green 2; exactly three executions; nothing stored. |
| Dependency case with `--env W9=on`, red fails once | `proven`; red 1, green 1; exactly two executions; nothing stored. |
| Dependency case with `--env W9=on`, green fails once | `not green`; red 1, green 1; exactly two executions; nothing stored despite coverage being enabled. |
| `status --at <base> --run`, failing-first test | Two actual executions; the first failure is retried and the commit-side state is `pass`. Exit 3 because the current-worktree side has no stored result. |

The initial probe failed before its status control because its two commits were identical. The next attempt asked for the unchanged HEAD without `--all-missing`, correctly selected zero files, and failed the probe's expectation. Both were harness errors. The completed job used a changed test at HEAD and requested the base commit. All controls then passed.

All completed commands left one Git worktree and no temporary checkout. Both earlier probe attempts also removed their fixtures in `finally`. The script, preloader, bootstrap HOME and fixtures were removed. The job exit files confirm all jobs ended; a process inspection found no remaining probe process. Only job logs remain under `$TMPDIR`.

## Inputs for integration

Keep `retry: false` unconditional at the proof's shared child call. A condition or repeat controls store use independently. Preserve the omitted default for `status --at --run`. This review found no further repair to dispatch. The prior HOME-preparation budget note remains unchanged and outside this delta. Release still needs passing full-suite CI for the exact release commit; this review does not supply that evidence.
