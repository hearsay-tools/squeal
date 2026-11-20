# Wave 16 third look

**PASS fb1179a3c**. Zero blockers. B1 and B2 are closed. No new should-fix
items or nits. The two nonblocking limits from the re-review remain below.

Candidate: `cand/0.1.573`, full SHA
`fb1179a3c737b27348907d94d76fd7095785b2be`.
Range: `294c8ac41..fb1179a3c`, rebased onto released 0.1.572.
This review is bounded by `wave-16-rereview.md` (commit `2b770b1c2`), the
two-dot path correction `c9a5f95a9`, and the rebase's named-wait interfaces.

## Verification

Fetched `cand/0.1.573` and checked out the exact SHA on this review branch.
All executable checks ran on a clean candidate before this file was added.
Independent probes lived outside the worktree and imported candidate sources.
Dependencies were already installed; the lockfile is unchanged from the prior
candidate. No install, full suite, build or version raise ran.

| Command | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `fb1179a3c737b27348907d94d76fd7095785b2be` |
| `git status --short` | Empty before checks and before writing this file. |
| `pnpm run lint` | Exit 0. `Checked 3821 files in 5s. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsrs --fast --noEmit`, no diagnostics. |
| `pnpm run check:private` | Exit 0. `6444 added lines in 70 files over 294c8ac418766cfba0f8298cd5a015acdb63ac5a, ok`. The private denylist rule was skipped because `SQUEAL_PRIVATE_DENYLIST` was empty. |
| `git diff --check` | Exit 0, no output. |

```sh
timeout 600 pnpm exec vitest run test/cli/status-at-next.test.ts test/cli/named-wait-starting.test.ts test/cli/named-partial-selection.test.ts test/cli/status-wait-folder.test.ts test/cli/snapshot-selection-shrinks.test.ts test/cli/named-snapshot-reads.test.ts test/cli/status-wait-paused.test.ts --maxWorkers=2
```

Exit 0: **7 files, 45 tests passed**, 21.13 s. This includes the B1/B2
regressions, rows 011-401/403/406, the rebased snapshot-read contract, and both
paused-daemon process-exit checks. The observed one-minute load after this run
was `24.75` on 24 CPUs.

Independent checks used:

```sh
timeout 600 pnpm exec vitest run --config <scratch>/vitest.config.mjs --root <scratch> --maxWorkers=2
```

The scratch config included only `probe.test.ts`. Exit 0: **6 tests passed**,
7.93 s. These cover B1 and its clean/tracked/untracked/ignored/`--run` controls,
both spellings of B2 in both sync modes, and a real outside-root control.
A separate run with `-t ignored-file` checked the known ignored-file limit:
exit 0, **1 passed, 6 skipped**, 10.95 s.

Total: **52 tests passed** on this candidate. All review commands ended. The
scratch probes and their fixture repositories were removed. No review daemon,
runner host or background job was left running.

**Affected checks: unverified.** Ran
`~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000` with
`src/cli/named-listing.ts`, `src/cli/wait/named.ts`, `src/cli/verdict.ts`, and
`src/core/status/standing.ts`. It exited 3 at revision 0:
`Named test files have no verdict: no daemon is running`.
The installed launcher used 0.1.572, not this candidate. Direct source runs
provide the test evidence above.

**CI: pending, unverified.** `gh run list --commit <full candidate SHA>` last
reported [CI 44725056378](https://github.com/hearsay-tools/squeal/actions/runs/44725056378)
as `in_progress`. Exact-candidate full-suite and bundle-build evidence was not
complete. [Private material 44725056490](https://github.com/hearsay-tools/squeal/actions/runs/44725056490)
was `completed`, `success`. This PASS is the bounded code review, not a claim
that pending CI passed.

## Blockers

None.

## Previous findings

### B1 closed, proven

The independent fixture again commits a local submodule and edits its tracked
file. `git status --porcelain` reports ` M dep`; `status --at HEAD --json`
continues the comparison and exits 3 for unknown results, rather than refusing.
A moved submodule commit also passes the refusal guard.

A clean tree still gets the refusal. Ordinary tracked changes and untracked
files prevent it; an ignored file does not. Clean `HEAD --run` continues and
exits 3 for unknown results. `headRefusal` remains before keying and uses
`--ignore-submodules=none`. No B1 code changed since the prior re-review.

### B2 closed, proven, including the two-dot spelling

The independent fixture is the same as the prior B2 reproductions: revision 4
is listed and refined, another test has a key, and a newly written file has no
recorded revision or key. All four waits below return `timeout` at their 300 ms
deadline and print the path-specific unlisted text. None prints a closure claim.

| Path | Sync | Measured wait | Outcome |
| --- | --- | --- | --- |
| `src/new.test.ts` | pending | 324 ms | timeout |
| `src/new.test.ts` | unsupported | 313 ms | timeout |
| `..new.test.ts` | pending | 307 ms | timeout |
| `..new.test.ts` | unsupported | 309 ms | timeout |

For example:

```text
Squeal has not listed ..new.test.ts here yet (0 s); wait again with the same command
```

`insideRoot` now distinguishes a name starting with two dots from a segment
equal to `..`. It also checks the resolved path against the root. A real new
sibling file named through `../<file>` remains `unmatched` with no `unlisted`
marker. Candidate tests also cover nested names beginning with two dots,
absolute paths, parent segments, a listing arriving before the deadline, and
another unmatched path beside the new file.

## Rebase and listed-case contracts

The rebase did not change the wave's `src/cli/wait/named.ts`,
`src/cli/status-at-next.ts`, `src/cli/named-selection.ts` or
`src/cli/named-file-lines.ts` relative to the prior candidate. The product delta
in the repair itself is the `insideRoot` check in `named-listing.ts`.

The optional interfaces on main remain compatible:

- `named.ts:196` calls `readVerdict(store, id, held, fixed)`. The new fifth
  argument is optional. Leaving it absent keeps the prior store-read path.
- `named.ts:201` calls `readNamedFiles` with its original six arguments.
  The seventh remains the default load reader; the new eighth is optional
  cached worktree reads. Neither argument shifts the existing call.
- The rebased snapshot supplies `reads` as `readVerdict`'s fifth argument and
  calls `readNamedFiles(..., now, hostLoad, reads)` in the correct order.
  Those definitions and snapshot calls equal the reviewed main base. Its
  regression compares the complete snapshot payload and text with the separate
  reads and checks that whole-worktree states are read once. Both tests pass.

The named waits retain their existing read transaction and deadline. The listed
cases preserve `at least`, `selection.complete`, stored import-walk readers,
folder kinds and prefix hints. The paused-daemon CLI tests still end with their
outcome rather than leaving sync sockets running. These checks found no new hang
or interface regression from the rebase.

## Carried notes and next input

**N1, proven, nonblocking:** the independent submodule comparison still reports
JSON `dirty: false`. The shared header ignores submodule changes; the refusal
uses its own broader check. This existing header limit remains with its owner.
It does not reopen B1's command rejection or change which files are keyed.

**N2, proven, nonblocking:** the ignored-file control returns at the deadline,
measured 337 ms for a 300 ms wait, and says the named file is not listed yet.
It states no closure fact. An ignored edit may record no revision, so another
wait need not make progress. This known conservative limit is unchanged.

No fix row is required by this third look. The Q1 and proof-report conclusions
settled by the earlier review are not reopened. The paused-daemon file was
rerun here; the older idle-host pass still belongs to `4f1ac0c1f` and is not
claimed for this SHA. Full-suite CI and bundle-build evidence for the exact
candidate remain pending before any release decision.
