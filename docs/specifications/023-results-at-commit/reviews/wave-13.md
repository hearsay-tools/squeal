# Wave 13 review: dogfood follow-ups

FAIL 2057c83f4c7263ef642a900eaff06f90a206755b

Five proven blockers. No other product should-fix findings or nits. No product code was changed.

Scope: `cand/0.1.564`, corrected range `1e010804ed8ca4cb04b0e165e41a96cb54cbf2ca..2057c83f4c7263ef642a900eaff06f90a206755b` (13 commits). The coordinator's correction supersedes the brief's older base. Rows 023-19 and 023-20, versions and bundles are reviewed against `tasks/wave-13.md`, spec D3–D6, lessons P3–P9, and both worker notes. The wave-7 and wave-11 reports supply the provenance and cleanup bar. Their settled cases are not reopened; the new batch and source-selection boundaries cause the failures below.

## Verification

All code checks and probes ran at the exact candidate on a clean tracked tree, before this report was added. Squawk supplied the dependency install (`pnpm install --frozen-lockfile`, reported 1 s); it was not repeated. No local full suite ran.

| Command or evidence | Actual result |
| --- | --- |
| `git rev-parse HEAD`; `git status --short`; `git log --oneline 1e010804..HEAD` | Exact candidate; clean; the corrected 13 commits. |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3745 files in 2s. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`. |
| `timeout 600 pnpm run build`; `git status --short` | Exit 0; all four plugin builds completed; no tracked or untracked drift. |
| Focused Squeal wait below, first read | Exit 3 at revision 0 after 61.3 s: nine current passes; key-format still running; no known failures. |
| Same focused Squeal wait, second read | Exit 0 at revision 0 after 2.8 s: all ten named files current, no known failures. Worktree: 732 of 1991 files not current, 60 queued and 672 unknown. |
| Affected-source Squeal wait below | Exit 3 at revision 0 after 61.6 s: 319 selected files, 44 current passes, 52 queued, 223 unknown. No known failures. Broader affected coverage is incomplete. |
| Final `squeal status --wait 60000`, after adding only this report | Exit 0, returned on quiet at revision 1 after 3.2 s. No affected tests pending and no known failures; whole worktree still has 728 of 1991 files not current (56 queued, 672 unknown). Supplemental report-only evidence, not a complete candidate gate. |
| Independent probes | Nine bounded jobs exited 0: `partial`, `mutation` (initial forced-batch probe and two natural-batch controls), `union`, `grown`, `cleanup`, `proof`, `scope`. Actual candidate failures are detailed below. |
| `timeout 600 pnpm run check:private`, before the report | Exit 0: `4924 added lines in 73 files over 1e010804ed8ca4cb04b0e165e41a96cb54cbf2ca, ok`. Warning: the private denylist is empty, so its rule is skipped. |
| `timeout 600 pnpm run check:private`, with the report committed | Exit 0; candidate plus report checked. The empty-denylist warning remains. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44411527243) | Still in progress at the last read before filing. The Node 24 lint/typecheck/version-sensitive/build job passed; six Node 22/26 test shards were still running. Full-suite result unverified. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44411526935) | Completed successfully at this exact candidate. |

The focused command used the session launcher, shown with `~`:

```sh
timeout 600 ~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/status-at-paths.test.ts test/cli/status-at-run-batches.test.ts \
  test/cli/status-at-run-budget.test.ts test/cli/status-at-report-files.test.ts \
  test/cli/proof-control.test.ts test/cli/proof-report.test.ts \
  test/cli/proof-conditions.test.ts test/proof/verdict.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts
```

The affected-source command used the same launcher, timeout and wait with these explicit paths: `src/cli/status-at-run.ts`, `status-at-run-child.ts`, `status-at-run-outcome.ts`, `status-at-now.ts`, `status-at-commit.ts`, `status-at-report-files.ts`, `proof.ts`, `proof-files.ts`, and `src/core/proof/verdict.ts`. The abbreviated CLI paths in this sentence all lie under `src/cli/`.

Each probe ran through a Squawk job with `timeout 600 node --import ./node_modules/tsx/dist/loader.mjs --disable-warning=ExperimentalWarning "$TMPDIR/w13-probe.mjs" <case>`. The two natural mutation controls and the cleanup probe added `taskset -c 0` before `node`, so Node reported one available CPU and the production batch rule selected one path first. They passed no `batchFiles` override. This tests the machine-derived rule without changing product code or loading the host.

The script created real Git repositories, a private HOME, cache and markers under `$TMPDIR`. It imported the candidate's source commands and used its committed Claude Code CLI bundle as each gate child. The injected installer linked this checkout's Vitest, as the repository's real-adapter fixtures do. Frozen installation itself was not independently tested. Each completed fixture asserted that only its original Git worktree remained. Fixtures were removed. The leaked child in B3 was explicitly killed. A final process scan found no process with a working folder under a probe fixture.

Only one full proof was run independently. The optional by-hand e2e suite was not repeated. The worker's e2e evidence used an uncommitted build at another commit; it is not an independent exact-candidate gate here. Pending or unknown checks are verification limits, not blockers.

## Blockers

### B1. Proven: later batches can certify modified source as the requested commit

Locations: `src/cli/status-at-run.ts:167` and `:174`.

Contract: goal 3 and D4.7 require results at the commit's keys. Vision principle 2 forbids a result from another code state posing as that commit's result. This is the wave-7 changed-checkout failure reopened between batches.

Create one commit with these files, a module package, `squeal.config.json` equal to `{}`, and a Vitest include of `test/*.test.ts`:

```ts
// src/a.ts
export const value = 1;

// test/a.test.ts
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
it('changes next batch input', () => {
  writeFileSync(new URL('../src/a.ts', import.meta.url), 'export const value=2;\n');
});

// test/z.test.ts
import { it, expect } from 'vitest';
import { value } from '../src/a';
it('must fail at base', () => expect(value).toBe(2));
```

With one-CPU affinity, run `status --at HEAD --run --all-missing --timeout 90 --json`. Natural sizing makes two batches of one path. Batch one changes the tracked source. Batch two starts a new gate and keys the changed source as its starting state. `changed` still holds only the pre-run checkout check, so storage remains enabled.

Actual final control at fixture commit `38ce2018b`:

| Call | Actual result |
| --- | --- |
| Both files with `--run --all-missing` | Both **pass**, `run.ran: 2`, `run.stored: 2`, `changed: null`. Z is attributed to the requested commit at key `778b2675…`. |
| Same commit, Z only, lookup | **No result**, at its real commit key `61986ade…`. |
| Same commit, Z only, `--run --all-missing --timeout 40` | **Fail**, `must fail at base`, stored at `61986ade…`. |

The first call takes 3.5 s. It does not reach a budget boundary. Its exit 3 is due to the unknown current-side snapshot; that does not make its commit-side pass truthful. The wrong pass is stored under the modified content key, not the original commit key. No poisoning of the original content key is claimed.

**One-worker repair:** carry the expected commit tree across all batches. Before another gate may run and store, establish that its inputs still match that tree. If an earlier test changed them, refuse the affected work or restore a verified checkout after stopping that batch's processes. Do not merely relabel a modified-key pass or switch storage off while still calling it the commit's result. Add the two-batch mutation and isolated failing control.

### B2. Proven: a stopped batch loses a completed result stored at a grown key

Location: `src/cli/status-at-run-outcome.ts:121`.

Contract: P3 requires “Every test file that completes before the budget ends is kept ... and reported” and “no completed result is lost to a kill.” Wave 11 requires reading the keeper's actual key, not a guessed key.

Use one passing test which imports `src/a.ts` and reads tracked `data/a.txt` through `readFileSync(new URL('../data/a.txt', import.meta.url), 'utf8')`. Its assertion checks both values. The static closure lacks that runtime read. Add a Vitest `globalSetup` whose returned teardown waits 600,000 ms. This holds close after the completed result is kept. Run `status --at HEAD --run --all-missing --timeout 20 --json`, then look up the same file without `--run`.

Actual results at fixture commit `8b35acbaf`:

| Call | Actual result |
| --- | --- |
| Budget-limited run | Ends in 19.7 s: `at: {state: "not run", reason: "budget"}`, `ran: 0`, `stored: 0`, `notRun: 1`. |
| Immediate lookup | Exit 0: **pass** on both sides, key `f7f1fcb2…`, stored origin at the same commit. |
| Pre-run key | `be91ae55…`, distinct from the stored key. |

The keeper correctly grew the key to include the runtime read. The stopped-child branch looks only at the pre-run key and never sees the completed result. The run's pass is not absent from storage; the report loses it. The new regression uses a static-key test, so it cannot detect this case.

**One-worker repair:** persist completed per-project outcomes and confirmed kept keys while a batch runs, before its final answer and close. Recover from that run's completion record after a hard stop. Preserve outcomes for completed but unstored files too. Do not re-key the mutated checkout after the run or store at the old key to make recovery work. Add the grown-key/held-close case and require the first report to agree with the next lookup. No stale-result substitution was observed in this probe; the proven break is the lost outcome at the wrong lookup key.

### B3. Proven: an earlier batch's child survives the whole command

Locations: new batch loop `src/cli/status-at-run.ts:167`; `src/cli/status-at-run-child.ts:153` and `:170`.

Contract: D4.8 and D6 require process cleanup. The brief explicitly asks for process cleanup per batch. Moving from one child per checkout to several must preserve ownership of every group.

Use two passing test files and one-CPU affinity, so production sizing makes two batches. The first test starts:

```ts
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
  stdio: 'ignore',
});
child.unref();
writeFileSync(process.env.HOME + '/child-pid', String(child.pid));
```

The second test only asserts `1 === 1`. Run `status --at HEAD --run --all-missing --timeout 40 --json`.

Actual: both batches pass and store; the command finishes in 3.3 s; only the original Git worktree remains. The spawned PID is still **S**, with init/subreaper parent and the first batch's process group, after checkout removal. It is a live process, not a zombie. The reviewer killed it with SIGKILL.

`runInChild` clears its timer and returns after normal exit without stopping the remaining group. The next batch overwrites the marker's single group. Final checkout removal stops only the last recorded group. The original one-child cleanup therefore no longer covers the earlier batch.

**One-worker repair:** complete group cleanup before returning from each batch and before replacing its marker ownership. Preserve ownership through error and parent-death paths as well. Cover a test-spawned child in the first of two normally completed batches, and check its process state after the first batch and after final removal. Do not limit the assertion to the runner worker or the last batch.

### B4. Proven: a base-only source reader loses a known current pass

Locations: `src/cli/status-at-now.ts:142`–`:156`; the same selected-only state cache is at `:88`–`:107` for daemon rows. `listLate` at `:172` cannot repair the no-daemon case.

Contract: P4 selects the tests whose closure at the commit holds the source path. D3 then compares each selected file with its actual current state. Being outside the current source selection does not mean a runner does not list the test.

Commit A has `test/a.test.ts` importing `src/a.ts`. HEAD changes only that import to `src/b.ts`; both sources export 1 and the test expects 1. Store HEAD's pass by naming the test file. Compare A twice:

| Selection | Actual current side |
| --- | --- |
| `status --at A src/a.ts --json` | **not determined (no runner lists it)** |
| `status --at A test/a.test.ts --json` | **pass**, key `816fc4fe…`, HEAD's stored origin |

Both reports contain the same test. The first already keys every listed current test to discover source readers, but caches states only for the current source selection. The base-selected test falls through to a false unlisted diagnosis. With daemon rows, the same filtering also means `unlisted(ref)` can be false while `state(ref)` says the daemon does not list it; that branch follows directly from the code, but was not separately probed.

**One-worker repair:** resolve the current state for the final union of selected refs, keeping full listing membership separate from selection membership. Reuse the keys already computed for source lookup. Preserve the live daemon's state when it actually lists the file. Add a reader that stops importing the named source between A and HEAD, with a known current pass, both with and without daemon rows.

### B5. Proven: naming a source path runs unrelated tests hidden from the report

Locations: `src/cli/status-at-commit.ts:62` and `src/core/commit/at-keys-narrow.ts:60`, where source lookup returns all adapters; the existing `selector` hook consumes those unnarrowed keyed files before `commitSide` filters its reported refs.

Contract: D1 says “Paths narrow the test files.” P3's narrowing hint must reduce the run, not only the printed file list. P4's full keying is needed to discover readers; it is not permission to run every keyed file.

Commit A has independent `src/a.ts` and `src/b.ts`, each with one test importing only its corresponding source. HEAD changes both sources. The B test writes a marker into the private HOME when it runs. Ask only for `src/a.ts`:

```sh
squeal status --at A src/a.ts --run --all-missing --timeout 40 --json
# Repeat on a fresh fixture without --all-missing.
```

Both variants actually run and store **two** files (`selected: 2`, `ran: 2`, `stored: 2`). Both reports' `files` arrays contain only **test/a.test.ts**. The B marker exists in both fixtures. The ordinary diff-selected run also escapes scope, so this is not an interpretation of `--all-missing` alone.

The commit side keys everything for closure discovery. Its `whileOpen` hook selects missing files from that entire set. Only after the hook runs does the commit-side report filter to source readers. In a large cold store this can turn the new narrowing hint into the broad run P3 was meant to avoid.

**One-worker repair:** determine the user's selected refs from paths and keyed closures before the run-selection hook executes. Intersect diff/all-missing selection with those refs, preserving project/path identity and sibling safety. Keying an unrelated file must not enqueue it. Add two disjoint source closures and assert the unrelated test never executes, is not stored, and is absent from run counts, with and without `--all-missing`.

## What fits

- **P3 budget and batch size:** the default is 300 s. Initial width comes from `availableParallelism() - 1`; later sizes use observed batch times and a fitted start/per-path cost. The constants express budget shares and startup amortization, not measurements of this host. The narrowing estimate precedes large runs. Each gate gets the remaining budget less a bounded margin; the parent hard stop uses the remaining budget. The ordinary partial-run control kept and reported the quick file while another file waited, finishing in 20.0 s of a 25 s budget. B1–B3 concern the seams between batches, actual kept keys and cleanup.
- **P4/P5:** basic source-reader selection, unmatched-path text, empty-daemon fallback and partial-list fallback have current passing regression results. The code uses working-tree keys for missing daemon entries. The worker diagnoses the original node:test case as a late listing rather than a project-name mismatch. That private-project diagnosis was not independently rerun. B4 and B5 are distinct new source-selection failures.
- **P6/P8:** grouped unknowns retain all files in JSON and behind `--full`; new files get the proof pointer. Their current tests pass. Changed known files remain separate from grouped unknowns.
- **P7:** the side-not-run text now states why and what it means. It no longer equates an unread green side with a pass. The report and verdict regressions are current passes.
- **P9:** the independent dependency proof returned conditioned red assertion failure, conditioned green pass, and an unconditioned red assertion failure. It exited 0 with `verdict: "proven"`, `reason: "red without the conditions too: the conditions are not shown to matter"`, and `controlReading: "red without them too"`. The control ran once and was stored; the conditioned sides were not stored. This proves the specified red/green claim under the conditions and explicitly declines the stronger claim that the conditions caused red. Retaining exit 0 does not hide a wrong proof in this case. It must not be described as proof that the condition matters.
- The control uses `NO_CONDITIONS`, the original environment and HOME, and the same deadline and repeat rules. Its inconclusive or budget-cut state stays explicit. The current control and condition tests pass. A new verdict or exit code for a negative control is not required by this brief.

## Inputs for the repair wave

Stop every batch's processes before advancing. Re-establish the expected committed inputs before the next batch keys or runs. Preserve completed outcomes, actual write keys and project identity durably before close, so a killed child needs no inferred pre-run or post-run key. Keep changed and conditioned work unstored and do not claim it is the commit's result.

For source paths, discover readers first, constrain execution to the selected refs, then join both sides over the union of those refs. Read the other side's actual state even when its closure no longer reads the source. Preserve the new grouped report, proof pointer, 300 s budget and P7/P9 semantics.

The coordinator still needs to amend spec D4.6 and goal 3 from the old 600 s default to the authorized 300 s default. Broader affected checks and full candidate CI remain incomplete verification. They do not change the five proven blockers. Rebuild/version the repair as required and request a bounded re-review of B1–B5. No full-suite request is needed for that review.
