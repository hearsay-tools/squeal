# 011-411 notes: a named status reads each test file once (gh-250, option A)

Row 011-411 (slice, performance, same output). Worker run `9816f3a5`, wave 124 W1, 2026-11-19. Option A of `research/issue-250-profile.md`: its recommendations 2 and 4. Options B (newest import only) and C (delete replaced imports) were not chosen and are not done here.

## Changes

| File | Change |
| --- | --- |
| `src/core/status/imports.ts` | `hereOf` makes each test file's closure hash, observed hash and its current states counted by import once per read (`memoBy`), not once per stored import. `readImports` keeps its signature. The coordinator gave this file to the row (reply to request `28d0855b`, 2026-11-19): the hashes are made here, not in `snapshot.ts`. |
| `src/core/status/snapshot.ts` | New `buildSnapshotWithReads`: the snapshot and the worktree rows it read (`WorktreeReads`: states, keys, header, open runs, holds, slow slot). `buildSnapshot` returns its `snapshot`. |
| `src/cli/verdict.ts` | `readVerdict` takes optional `reads` (states, keys, header). With them it reads no state, key or header again: it takes the named files' key rows from `reads.keys`, and the header from the snapshot. |
| `src/core/status/standing.ts` | `readNamedFiles` takes optional `reads` and passes them to `standingsOf`, which already took them (row 011-29). |
| `src/cli/wait/snapshot.ts` | The snapshot's one read (`readOnce`) builds the snapshot with its rows and gives them to `readVerdict` and `readNamedFiles`. |
| `test/status/import-reads-once.test.ts` | New. Three imports, each keeping the same files apart for another reason (closure list, observed set, content, an adopted equal key). It pins every count and line, and counts one `testFiles.get` per file. |
| `test/cli/named-snapshot-reads.test.ts` | New. A named snapshot on a store with three imports gives the JSON and text that the separate reads (`readVerdict` and `readNamedFiles` without rows, `buildSnapshot`) give. It also counts the whole-worktree `knownStates.list` calls: only the snapshot's. |

## Type changes

All additive:

- `buildSnapshotWithReads(store, root, now, load?, shell?): { snapshot: StatusSnapshot; reads: WorktreeReads }`, exported from `src/core/status/snapshot.ts`.
- `readVerdict(store, worktreeId, files?, fixed?, reads?: Pick<WorktreeReads, "states" | "keys" | "header">)`.
- `readNamedFiles(store, worktreeId, root, files, daemon, now, load?, reads?: WorktreeReads)`.
- `Here.fromImport(id)` in `imports.ts`. This is a module-private interface.

## Decisions

- **The header the verdict uses.** Before, `tally` made a header from all states and the named files' keys only. The verdict uses four fields of it: `revision`, `refinedRevision`, `runnerPartPending` and `awaitingInstall`. `headerWith` reads these fields from their own rows. No state or key row changes them. The snapshot's header was made with the open runs' files (`openFiles`), and `openFiles` changes only the not-current counts. So the snapshot's header gives the same four fields. `standingsOf` reads `installCommand`, `listingRunners` and `slowTier` from it too. `outstandingOf` already passes the same header to `standingsOf`.
- **`readClasses` keeps its own read.** The brief named it. In the snapshot, `readClasses` runs before the snapshot is built: it decides whether the daemon is ready, and the decision gates the hold read. It reads only the named files' states and keys, through the indexed `files` filter: 15 statements and 37 rows on the store copy, under 20 ms in the profile. Reusing the snapshot's 35,640 states would mean building the snapshot first and filtering all states, which costs more CPU. It would also change the read order on the usage-error path. So it stays as it is.
- **One transaction.** Before, the verdict and the named files read the store after the snapshot's read transaction had ended. If the daemon committed between the reads, they could see a newer state than the snapshot. Now they read the snapshot's own rows. This follows C6: "Every status read [...] is one read transaction". On a store that does not change, the output is the same. This is in the proposed amendment below.
- **The named wait's last read is not wired.** `src/cli/wait/named.ts` (its final read, about line 193) belongs to row 023-26 now, so I did not edit it. That read still benefits from the imports change (the snapshot inside it is the same). It still reads all states three times. The next step, after 023-26 lands: call `buildSnapshotWithReads` there and pass `reads` to `readVerdict` and `readNamedFiles`. That is three lines, the same as in `src/cli/wait/snapshot.ts`.
- **`memoBy` key for the closure.** The closure hash depends on the file and on whether the import stored a static-list hash (`STATIC_LIST` prefix) or a whole-list hash. The memo key holds both. The observed hash depends only on the file.

## Store reads, before and after (store copy)

Counted with `probes/issue-250/count-rows.mjs` (a preload that counts SQLite statement calls and rows). One untimed run per bundle. The call is the issue's own two-file named `status --json`. Phase names are frames in the bundle. In the after bundle, the snapshot runs under `buildSnapshotWithReads`, which the probe does not name, so its rows are counted under `other`.

| Phase | Before: calls | Before: rows | After: calls | After: rows |
| --- | ---: | ---: | ---: | ---: |
| Snapshot without imports (`buildSnapshot`, plus `other`) | 78 | 39,577 | 78 | 39,577 |
| Imports comparison (`importsOf`) | 13,058 | 308,980 | 3,320 | 299,242 |
| of it: `test_files` lookups | 10,949 | | 1,211 | |
| Verdict (`readVerdict`) | 15 | 35,649 | 0 | 0 |
| Named files (`readNamedFiles`) | 19 | 37,605 | 3 | 2 |
| Source paths, sync, selection, classes | 23 | 3,955 | 23 | 3,955 |
| **Total** | **13,193** | **425,766** | **3,424** | **342,776** |

What remains is the 289,524-odd `import_files` rows. They are read once per import. Options B or C remove them.

## User CPU before and after

Setup as in `research/probes/issue-250/README.md`. I took a consistent copy of the cezar store (6.3 GB) with `VACUUM INTO` from a read-only connection, because its daemon was running and the store had a `-wal`. The copy's layout is compacted, so its absolute times can differ from the 011-408 copy. Before and after ran on the same copy. The store held 188 imports and 35,640 states for the worktree `a41de0395ad10bfe`. `prepare-store.mjs` moved those rows to the scratch clone's id and cleared every socket. The clone is at `9b5394c4a`, which is the store's head for that worktree. Every call went through `run.sh`: `env -i`, `HOME`, `XDG_*` and `TMPDIR` in scratch, `timeout 180`, `/usr/bin/time -v`. No daemon ran on any store.

Bundles:

- Before: `plugins/claude-code/dist` at the base `b213fdfbb`, as committed. CI checks that it matches the build.
- After: `tsx src/harness/claude-code/build.ts` in a scratch copy of the branch head (`git archive`, `node_modules` linked). There was no build in the worktree.

Call: `squeal status --json packages/cezar/src/core/runner-skill-trigger-omp-parity.test.ts packages/cezar/src/core/runner-skill-trigger-pi-parity.test.ts`. Every run exited 3, with both files current/pass and "no verdict" (no daemon), as in the issue.

Set 1, 2026-11-19 about 22:39 to 22:44 UTC, before and after interleaved. The host's own load was 96 to 126 on 24 CPUs, made by other sessions. I made none.

| Run | Before user s | Before wall | Load (1 min) | After user s | After wall | Load (1 min) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 10.70 | 32.7 | 120.0 | 5.61 | 17.5 | 126.2 |
| 2 | 10.57 | 34.1 | 123.3 | 5.61 | 16.6 | 123.7 |
| 3 | 10.87 | 22.6 | 117.2 | 6.42 | 13.2 | 109.6 |
| 4 | 11.02 | 18.4 | 104.2 | 5.45 | 8.5 | 98.7 |
| 5 | 10.41 | 24.9 | 96.0 | 5.60 | 10.5 | 102.5 |
| **Median** | **10.70** | **24.9** | | **5.61** | **13.2** | |

Set 2, 2026-11-19 about 23:22 to 23:25 UTC, interleaved, at the host's own load of 46 to 56:

| Run | Before user s | Before wall | Load (1 min) | After user s | After wall | Load (1 min) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 8.82 | 10.7 | 48.1 | 4.54 | 5.7 | 47.3 |
| 2 | 10.05 | 12.6 | 45.6 | 5.15 | 7.4 | 52.2 |
| 3 | 9.45 | 11.5 | 53.5 | 5.26 | 7.1 | 53.9 |
| 4 | 9.16 | 11.0 | 54.3 | 4.64 | 6.1 | 54.4 |
| 5 | 8.97 | 11.4 | 56.3 | 4.54 | 6.1 | 55.6 |
| **Median** | **9.16** | **11.4** | | **4.64** | **6.1** | |

User CPU fell by 5.1 s (48 %) in set 1 and by 4.5 s (49 %) in set 2. Wall time fell from 24.9 to 13.2 s and from 11.4 to 6.1 s. The profile inferred up to about 2.5 s of 7 s at load 20. Why the cut is larger here is `inferred`, not measured: at load above 100 each CPU-bound step costs more user time, and this copy holds 188 imports, not 185. What is left grows with the number of imports: the `import_files` rows and the per-file reason, which options B and C address.

Other single runs on the same copy, at load 105 to 121: the text form (no `--json`) took 10.30 s user before and 5.31 s after. Pathless `status --json` took 8.79 s before and 5.44 s after.

All runs are in `$S/out/runs.log` in the task scratch (throwaway, not committed).

## Identical output

- On the store copy, `cmp` of before and after stdout: the text form is byte-identical. The pathless `--json` is byte-identical. The named `--json` differs only in `waitedMs`, which is the call's elapsed time (26,322 ms before, 13,905 ms after). That field differs on every run.
- `test/cli/named-snapshot-reads.test.ts` (case 1): on a store with three imports, one pending, one passing and one failing named file, the JSON and `namedText` match the separate reads. Case 2 counts the whole-worktree state reads: 1 with this change, 3 with the old `src/cli/wait/snapshot.ts` swapped in (the case then fails with `expected 3 to be 1`).
- `test/status/import-reads-once.test.ts`: with the old `imports.ts` swapped in, the output case passes (same counts and lines) and the count case fails with B 2 and C 3 lookups instead of 1 each.

## Proposed spec amendment (011 C6; the coordinator lands it)

> Amended 2026-11-19 (the human, gh-250 option A "cheaper reads", row 011-411, `research/issue-250-profile.md`): a status read compares each test file this worktree lists with the stored imports once per read, not once per import: its closure hash, its observed hash and its current results by import are made once and serve every import (018 D5, unchanged output). A named snapshot's verdict and named files read the rows its snapshot read, in the snapshot's read transaction, not every state again. The named wait's last read takes the same reads once row 023-26 lands. Output is unchanged. On a copy of a store with 188 imports, a two-file named `status --json` fell from 10.7 s to 5.6 s user CPU (medians of 5, at load 96 to 126 on 24 CPUs).

Spec 018 D5 and D19 stay unchanged: every import is still listed and compared.

## Verification

- `pnpm exec tsc --noEmit -p .` passed with no output. `pnpm exec biome check src test/...` reported no fixes.
- The direct runs of the two new test files passed (2 and 2) on this branch. Their red checks against the old code are above.
- `squeal status --wait 60000 <5 changed src paths> <2 new tests>`, last read at 23:26 UTC, at load about 55: 173 affected files pass, 485 are still queued (Squeal's queue moved slowly at load 50 to 120), and 3 failed, all timeouts under load (below). It gave no verdict.
- Direct run instead of waiting for that queue: every test file that imports a changed module (108 files, from `grep` of `test/` outside `test/e2e`) plus `test/cli/codex.test.ts`, with `timeout 1800 node_modules/.bin/vitest run --maxWorkers=2`, at load 49 to 65: 108 files and 758 tests passed. The 485 queued files read the changed modules only through other modules; CI's full suite covers them.
- Squeal's three failures:
  - `test/cli/codex.test.ts` (`squeal init --harness codex`) timed out at 60 s at load 112. It passed in the direct run.
  - `test/cli/status-paths-paused.test.ts` has a 1.3 s wall-clock bound, and it failed under load. It passed directly on this branch and on the base (2 of 2 each).
  - `test/daemon/start-mark.test.ts` timed out at 5,000 ms. A direct run on this branch failed the same way. A direct run on the base `b213fdfbb`, from a scratch `git archive`, also failed the same way at load about 105. In the later direct run at load 49 to 65 it passed on this branch. So host load causes it, not this change.
- `test/e2e/torn-status.test.ts` is the only `test/e2e` file that imports a changed module (`buildSnapshot`). It is an opt-in probe, and it was skipped without `SQUEAL_PROBE_TORN_STATUS` (2 skipped). I did not run it with the probe on, because it busy-waits on purpose. `buildSnapshot`'s signature and behaviour are unchanged.
- I did not run a full suite, a version raise or a build in the worktree.
