# Wave 13 re-review: batch repairs

FAIL 7827ce9341ed01c38520d2522ad5049a777af715

One proven blocker remains: B2, recovery of completed outcomes after a batch stops. B1, B3, B4 and B5 are closed by the checks below. No other should-fix findings or nits. No product code was changed.

This is a bounded re-review of the five blockers in `wave-13.md`, report commit `babd4e8ba`, against the exact repaired candidate `cand/0.1.564`. The repair delta is `2057c83f4..7827ce934`. The original corrected wave range began at `1e010804ed8ca4cb04b0e165e41a96cb54cbf2ca`. The prior report's settled cases remain settled unless the repair changes their boundary.

## Verification

Code checks and independent probes ran at the exact candidate on a clean tracked tree, before adding this report. Dependencies were supplied by Squawk; installation was not repeated. No full suite ran locally.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch origin`; `git checkout --detach 7827ce9341ed01c38520d2522ad5049a777af715`; `git rev-parse HEAD`; `git status --short` | Exact candidate; clean. |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3746 files in 3s. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0. |
| `timeout 600 pnpm run build`; `git status --short` | Exit 0; all four plugin builds completed; no drift. |
| Focused Squeal wait below | Exit 0, returned on quiet at revision 5 (`7827ce93 + 0`) after 53.4 s. All eight selected test files current and passing. No known failures. Whole worktree: 624 of 1992 files not current, 339 queued and 285 unknown. |
| Broader `squeal status --wait 60000`, twice | Both returned on timeout, after 61.6 s and 61.3 s. Latest read at report-only revision 6: 161 of 164 affected test files pending, no known failures; whole worktree 515 of 1992 not current (230 queued, 285 unknown). Broader affected coverage remains incomplete. |
| Independent Git/Vitest probes | Eight bounded jobs exited 0: `b1`, `grown`, `concurrent`, `unkept`, `cleanup`, `union`, `scope`, `proof`. Their observed product failures are recorded under B2; a probe's exit 0 is not a candidate pass. |
| `timeout 600 pnpm run check:private`, before the report | Exit 0: `5438 added lines in 76 files over 1e010804ed8ca4cb04b0e165e41a96cb54cbf2ca, ok`. Warning: empty private denylist, rule skipped. |
| `timeout 600 pnpm run check:private`, with the report committed | Exit 0: candidate plus report checked, 77 files. The empty-denylist warning remains. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44417337973) | In progress at the last read before filing. The Node 24 lint/typecheck/version-sensitive/build job passed; six Node 22/26 shards were running. Full-suite result unverified. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44417338240) | Completed successfully at the exact candidate. |

Focused command, with the session launcher shown using `~`:

```sh
timeout 600 ~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/status-at-review13.test.ts test/cli/status-at-run-budget.test.ts \
  test/cli/status-at-paths.test.ts test/cli/proof-control.test.ts \
  test/cli/proof-conditions.test.ts test/cli/proof-report.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts
```

Each independent case used a Squawk job running:

```sh
timeout 600 node --import ./node_modules/tsx/dist/loader.mjs \
  --disable-warning=ExperimentalWarning "$TMPDIR/w13r-probe.mjs" <case>
```

The script created real Git repositories, private HOME directories, caches and markers under `$TMPDIR`. It imported the candidate source commands and used the committed Claude Code CLI bundle for gate children. Its injected installer linked the candidate's Vitest into each temporary checkout. Frozen installation was not independently tested. Mutation and cleanup cases used `batchFiles: 1` to exercise several batches without depending on the host's CPU count. The production sizing rule is unchanged: machine parallelism first, then measured batch times. The default remains 300 s.

Each finished fixture checked the Git worktree count. The concurrency case retained only its two original worktrees before removing the peer. All fixture directories were removed. All eight jobs exited, and the final process scan found no fixture process. The temporary probe script was removed before commit. One full proof ran independently; the optional by-hand e2e suite was not repeated. Pending or unknown checks are verification limits, not blockers.

## Blocker

### B2. Proven, still open: stopped-run recovery loses completed outcomes

Location: `src/cli/status-at-run-outcome.ts:122`, especially lines 130–134. The query it calls is defined at `src/core/store/repos/results.ts:51`.

Contract, P3: “Every test file that completes before the budget ends is kept (stored when the checkout allows) and reported” and “no completed result is lost to a kill.” The original B2 repair also requires preserving completed but unstored outcomes. A key lookup must identify this run's completed work before choosing an outcome.

The isolated original fixture is fixed. A test imports a source and reads a tracked data file at runtime, so the kept key grows past the static key. A global teardown holds close for 600,000 ms. A 20 s run now reports the completed pass at `80691b35…`, stored, and the immediate lookup agrees. The pre-run key was `ebefafc2…`. This also exercises a stopped first batch.

Two requested boundary cases still fail.

**Concurrent worktrees sharing one store.** Create commit A with `src/a.ts` exporting 1, tracked `data/a.txt` containing `a`, and this test:

```ts
import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { value } from '../src/a';
const text = readFileSync(new URL('../data/a.txt', import.meta.url), 'utf8').trim();
it('runtime', () => expect([value, text]).toEqual([1, 'a']));
```

Use a Vitest global setup whose returned teardown writes a marker in the throwaway HOME and waits 600,000 ms. Commit B changes the data to `b` and removes that hold. Create a linked worktree at B. Start A's `--run --all-missing --timeout 30`. Wait for its teardown marker and stored pass. While A remains held, run B from the linked worktree with `--run --all-missing --timeout 20`. Then let A reach its hard stop.

Actual fixture commits: A `59c3eef1ec88a860d1d16085d344adfbecca6c58`, B `0ac3734fb196aa71ee8c03d583f468f88bec56c5`.

| Observation | Actual result |
| --- | --- |
| A before B runs | Stored pass at `d6989926…`, writer `3fa38f96e58be2e5`. |
| B completes in 3.0 s | Stored assertion failure at `c9155641…`, writer `1d880592e02c87f0`. |
| Store history after B | Both keys and their file rows remain present. A's pass was not deleted. |
| A stops after 29.9 s | `at: {state: "not run", reason: "budget"}`, `ran: 0`, `stored: 0`, `notRun: 1`. |
| Immediate A lookup | Exit 0: A's pass at `d6989926…`, with A's writer and commit. Current B side correctly fails at `c9155641…`. |

`newestForTestFile` chooses the newest key across all writers first. The later provenance check correctly refuses B's rows, but cannot recover A's older key. Thus A loses its own completed stored result from the report. This probe did not attribute B's failure to A and did not prove a wrong write key.

**Completed, unstored file.** In a separate real Git fixture, disable coverage with `{"coverage":{"enabled":false}}`. A test writes a finished marker and asserts `1 === 1`. Hold global teardown as above. At a 20 s budget, the marker exists, but the report after 19.5 s says `not run (budget)`, `ran: 0`, `stored: 0`. The file completed well before the stop. Its outcome is lost because no store row can recover it. The repair notes acknowledge this missing progress seam; that does not meet P3 or close the original B2 requirement.

**One-worker repair:** persist per-run, per-project completion records before close, including the outcome, whether it was kept, and its actual kept key when present. Recover the stopped batch from that run's records. A writer-scoped query must constrain the writer before choosing a key; choosing a global key then checking provenance is insufficient. Store history alone also cannot recover unstored outcomes. Preserve the provenance guard and the gate's actual key; do not substitute another writer's result or the pre-run key. Add both cases above. Require the stopped report to retain A's pass despite B's newer different key, and to report completed unstored files with the correct storage reason.

## Closed blockers and retained behavior

- **B1, cross-batch mutation: closed.** Four one-path batches: the first rewrites `src/a.ts`; the next three pass against that changed source. Only the first result stores. The later three read `not comparable`, `ran: pass`, with `changedBy: "run"`. An isolated control at the requested commit fails and stores at the original key. A separate last-batch variant imports the original source and rewrites it during the test: its pass stays unstored with the gate's changed-input reason. No later batch is needed for that guard.
- **B3, per-batch process cleanup: closed.** Three one-path batches. The first starts an unreferenced interval child. The second checks that PID is absent or a zombie before it completes. All three pass and store in 4.4 s. The spawned child is no longer live after the command. No manual kill was needed. `runInChild` now stops the group before returning on every answer path.
- **B4, base-only source reader: closed.** A test imports `src/a.ts` at A and `src/b.ts` at HEAD. Seed HEAD's pass. Selecting A by `src/a.ts` now gives the same current pass and key as selecting the test by name. With daemon registration and a current test-key row, the source selection retains that pass and reports `now.kind: "daemon"`, revision 2. This independent probe seeds the daemon rows; it does not start a live daemon.
- **B5, unrelated execution: closed.** Two disjoint source closures; both sources change at HEAD. Ask only for `src/a.ts`, with and without `--all-missing`, in separate fixtures. Both select, run and store exactly one file. The B marker is absent; B's commit-side lookup remains `no result`; only A appears in `files`.
- **023-20, P7/P9:** focused condition, control and report tests are current passes. The independent dependency proof returns conditioned red assertion failure, conditioned green pass, and unconditioned red assertion failure. It exits 0 with `verdict: "proven"`, `controlReading: "red without them too"`, and reason `the conditions are not shown to matter`. The unconditioned control stores; both conditioned sides stay unstored. This continues to prove the stated red/green claim and explicitly limits the claim about conditions. No wrong proof was observed. The repair did not change the proof wording or verdict code.
- P5's starting-daemon fallback, P6 grouping and P8 proof pointers remain covered by the earlier review. The current path tests pass; the repair does not reopen their report contracts.

## Input for the next repair

Repair B2 across the gate-to-parent completion boundary, including completed unstored files. Keep B1's checkout check before each later batch, B3's cleanup before advancing, and B4/B5's separation of listing, selection and state lookup. Preserve the actual project and kept-key identity in the completion record. Re-review B2 with the isolated grown-key case, concurrent writers at different keys, and coverage-off completed work. No full-suite request is needed for that bounded review.
