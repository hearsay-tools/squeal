# Wave 16 rebase check

**PASS aa2f681e7**. Zero blockers, should-fix items or nits.

Candidate: `cand/0.1.577`, full SHA
`aa2f681e7bb5fde59ae4edbf4c5d3756e8fa45cb`.
Range: `c078de900..aa2f681e7`.
Prior PASS: `wave-16-third.md`, candidate `fb1179a3c` on base `294c8ac41`.

This check follows process step 6. It covers only the shared file after the
rebase onto main 0.1.575: `src/cli/main.ts`. The earlier review's settled
behaviour and carried limits are not reopened.

## Verification

Fetched `cand/0.1.577` and checked out the exact candidate on this review branch.
The tree was clean for the checks and before writing this report.

| Check | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `aa2f681e7bb5fde59ae4edbf4c5d3756e8fa45cb` |
| `git status --short` | Empty. |
| `git diff fb1179a3c aa2f681e7 -- 'src/cli/status-at*' 'src/cli/proof*' src/cli/wait/named.ts 'src/cli/named-*.ts'` | Empty. All requested paths are byte-identical. |
| Product-path intersection: `294c8ac41..c078de900` with `c078de900..aa2f681e7` | Only `src/cli/main.ts`. |
| `git diff --check` | Exit 0, no output. |

```sh
timeout 600 pnpm exec vitest run test/cli/main.test.ts test/cli/subcommand-help.test.ts --maxWorkers=2
```

Exit 0: **2 files, 72 tests passed**, 12.08 s. Both test files are unchanged
from the prior PASS. The checks cover main dispatch, public help, per-command
help, unknown flags and help without work. The job ended, and its PID is gone.
No review process remains running.

**Affected checks: unverified.** The installed launcher ran `squeal checks`
and `squeal status --wait 60000 src/cli/main.ts`. Status exited 3 at revision 0:
`Named test files have no verdict: no daemon is running`. The launcher used
0.1.572, so it supplies no evidence for this candidate. The task-required direct
source tests above provide the bounded test evidence.

**CI: pending, unverified.** Exact-candidate
[CI 44730924692](https://github.com/hearsay-tools/squeal/actions/runs/44730924692)
was `in_progress` when checked.
[Private material 44730924672](https://github.com/hearsay-tools/squeal/actions/runs/44730924672)
was `completed`, `success`. This report does not claim a full-suite or bundle
build pass. No full suite, build or version raise ran for this review.

## Shared-file result

Relative to the prior PASS, `main.ts` adds only the store-process import and
its hidden command-table entry. It dispatches `store-process` to
`storeProcessCommand`. The implementation equals main's version; its import of
`CliIo` is type-only. Importing the CLI does not start the service.

Relative to the new main base, `main.ts` changes only the status-at help text.
It retains the working-tree comparison description, the missing-results
`--run` hint, and the clean-HEAD refusal with exit 2 and `HEAD~1` advice.
The hidden service command has no public help entry. The status-at dispatcher
still uses `asksAt`, `parseAt` and `statusAtCommand` in the same order.

The rebase preserves both changes. The byte-identical status, proof and named
wait files retain the prior PASS, including the closed B1/B2 reproductions.
There is no new shared seam in those paths.

## Blockers and next input

None. No fix row is required. Exact-candidate CI remains evidence for the
coordinator to obtain before release. This narrow check adds no benchmark
requirement: it changes no store, daemon, scheduler, hook or delivery mechanism.
