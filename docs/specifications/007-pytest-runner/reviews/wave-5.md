# 007 wave 5 review: live pytest config relisting

Candidate: `cand/0.1.191` at `41979b98887bdd773e3b1f87f5bcbe76929c88ec` (`41979b98`). Review baseline was this exact commit with a clean tree. Scope: 007-42 (`4f9adc4e`, picked from `382d253e`), wave 4 S1, the config/list/graph/scheduler seam, and the candidate's key re-pin and generated bundle delta. Earlier wave 4 blockers are outside this bounded review.

## Verification

```text
$ git rev-parse HEAD
41979b98887bdd773e3b1f87f5bcbe76929c88ec
$ git status --short
[no output]

$ npm ci
added 196 packages, and audited 197 packages in 16s
32 packages are looking for funding
found 0 vulnerabilities
[exit 0; npm warned about node-domexception and six install scripts not covered by allowScripts]

$ npm run lint
> squeal@0.1.191 lint
> biome check .
Checked 1272 files in 9s. No fixes applied.
[exit 0]

$ npm run typecheck
> squeal@0.1.191 typecheck
> tsc --noEmit
[exit 0]

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Test Files  4 failed | 607 passed | 1 skipped (612)
     Tests  4 failed | 5094 passed | 10 skipped (5108)
  Start at  10:14:04
  Duration  1208.92s
[exit 1]
```

The independent gate waited about 18 minutes for the shared lock, then ran once. Sampled one-minute host load during it ranged from about 52 to 244. No pytest test file failed. All four failures were outside the candidate's product delta; each exact failed case passed when run individually at unchanged `41979b98`:

| Failed test (full name within the named suite) | Full-run observation | Fails alone? |
| --- | --- | --- |
| `test/e2e/opencode.test.ts:299`, `the shipped OpenCode package, installed with opencode plugin > run: news at the end of the turn is stored in the session, and run --continue reads it once` | Expected one stored Squeal failure message; received zero. | No: 1 passed, 7 skipped, 19.59 s. |
| `test/e2e/stop-gap.test.ts:47`, `a daemon stalled between its socket and its lock, claude-code > stop waits for its lock, and the replacement a SessionStart spawns serves` | Expected the stalled daemon's write lock; lock lookup returned `none`. | No: 1 passed, 1 skipped, 9.79 s. |
| `test/evals/run-cell.test.ts:154`, `run-cell.mjs with fake harnesses > tears down the session, the daemon and the scratch when the runner is terminated (S2)` | A recorded harness/daemon PID still answered the liveness check after termination. | No: 1 passed, 6 skipped, 697 ms. |
| `test/harness/opencode-dispose.test.ts:193`, `a report held while dispose meets newer input > serve: an abort of the new turn, then the old Stop's answer, stores nothing` | The `answered` barrier was not seen within the 30-second poll. | No: 1 passed, 1 skipped, 8.04 s. |

The isolated commands and output were:

```text
$ npx vitest run test/e2e/opencode.test.ts --maxWorkers=4 -t 'run: news at the end of the turn is stored in the session, and run --continue reads it once'
Test Files  1 passed (1)
     Tests  1 passed | 7 skipped (8)
  Duration  19.59s
[exit 0]

$ npx vitest run test/e2e/stop-gap.test.ts --maxWorkers=4 -t 'claude-code.*stop waits for its lock'
Test Files  1 passed (1)
     Tests  1 passed | 1 skipped (2)
  Duration  9.79s
[exit 0]

$ npx vitest run test/evals/run-cell.test.ts --maxWorkers=4 -t 'tears down the session, the daemon and the scratch when the runner is terminated \(S2\)'
Test Files  1 passed (1)
     Tests  1 passed | 6 skipped (7)
  Duration  697ms
[exit 0]

$ npx vitest run test/harness/opencode-dispose.test.ts --maxWorkers=4 -t "serve: an abort of the new turn, then the old Stop's answer, stores nothing"
Test Files  1 passed (1)
     Tests  1 passed | 1 skipped (2)
  Duration  8.04s
[exit 0]
```

The last two filters were supplied as regex-escaped structured subprocess arguments. An earlier, over-specific `stop-gap` filter selected zero cases (two skipped); it is excluded from the evidence above. The corrected filter executed the failing Claude Code case and skipped only the Codex variant. Reruns were sequential, with one selected test per invocation. The full run remains recorded as exit 1; these isolated recoveries are the evidence for reporting its misses as transient, not a claim that the full run was green.

Squeal's separate background baseline also reported `vacant-wait` failures at lines 180/188, OpenCode wake/dispose misses, and `environment-growth-siblings:155`. Their `why` reports were read. All but the abort-dispose case recovered through subsequent Squeal results before the independent gate ended; abort-dispose passed in the isolated run above. Those background observations are not substituted for this independent gate.

`npm run build` was not run, as the brief explicitly requires. Bundle regeneration and build drift are therefore **unverified**, not a finding. Source and generated CLI diffs contain the same new relist predicate; that inspection does not substitute for the build. All product verification ran at `41979b98` before this report was written. No product files were changed. Throwaway probes ran outside the worktree and were removed.

## Verdict

**PASS `41979b98`**. Zero blocking findings, zero new should-fix findings, zero nits. Wave 4 S1 and 007-42's live recursion done-when are proven closed. The full gate had four transient failures, each named above with its passing isolated rerun. The broader claim about dynamically changing `testpaths`/`python_files` coverage is limited as explained below.

## Blockers

None.

## Should-fix

None introduced by this repair. The pre-existing setup/include limitation is recorded below as an informational scope note.

## Nits

None.

## What fits

### Wave 4 S1 is closed: one live adapter follows both directions

**Proven.** At `src/runners/pytest/adapter.ts:220`, invalidation compares the worktree-relative changed path with the newly read config path and also relists when settings require a rebuild. A changed list reaches `built.graph.setTestFiles` at line 227. The committed regression at `test/runners/pytest/adapter-files.test.ts:118` keeps one adapter open rather than reopening it after the edit.

An independent probe used `include = ["probe/**/test_*.py"]`, `probe/test_keep.py`, `probe/build/test_a.py`, and an existing `pytest.ini`. It began with default `norecursedirs`, then changed that same config with invalidation kind `change` three times:

```text
setting                 testFiles()
default                 [probe/test_keep.py]
norecursedirs =          [probe/build/test_a.py, probe/test_keep.py]
norecursedirs = build    [probe/test_keep.py]
norecursedirs = .*       [probe/build/test_a.py, probe/test_keep.py]
```

The sequence passed with no environment and with separately synced Python 3.10 and 3.13 environments. At each step `affected(["probe/build/test_a.py"])` included the file only while admitted, proving the graph followed the list. With both ready environments, running the two admitted files returned `end: completed`, no failure, both completed files, and `test_a: pass`, `test_keep: pass`.

The same probe against the adapter source immediately before `4f9adc4e`, with its imports directed to the unchanged candidate dependencies, failed at the first allow step: actual `[probe/test_keep.py]`, expected `[probe/build/test_a.py, probe/test_keep.py]`. This discriminates the repair from the original failure without modifying the candidate.

### A relist does not itself discard results or move keys

**Proven.** `src/runners/pytest/adapter.ts:225` retains the existing list and graph membership when `sameList` holds. `src/core/scheduler/revision.ts:148` removes only identities absent from a successful listing and adds only new identities. Existing files retain their scheduler state.

For the no-environment adapter and both ready Python versions, an invalidation of unchanged config content returned `recreatedProjects: []` and kept the file list, closure, runner environment, and content key equal. An unrelated `touch`, which also causes a relist through the existing predicate, likewise kept these values equal.

A separate real-daemon probe baselined the two simple pytest files on Python 3.13, saved identical `pytest.ini` bytes and requested reconciliation through the daemon socket. Before/after database snapshots had identical `test_file_keys`, `known_states`, and run count; status kept the same revision, four current checks and zero known failures:

```text
real daemon unchanged config save:
sameRevision=true sameFileKeys=true sameKnownStates=true noExtraRuns=true
current=4 knownFailures=0
```

A genuine config byte change still recreates and re-keys a ready project. Adding only a comment preserved the list and closure but changed the environment/content key on both Python versions. This is the existing D2 contract, which explicitly hashes the pytest config bytes, not needless invalidation introduced by relisting. No-environment adapters reported no recreate for these recursion-only edits, but updated their own list and graph before any sync.

### A newly preferred config relists too

**Proven.** `src/runners/pytest/adapter.ts:203` reads settings before the new relist condition; `sameSettings` compares the config identity as well as graph settings (`adapter-config.ts:65`). A probe began with `pyproject.toml` setting `norecursedirs = []`, then created a higher-precedence `pytest.ini` with default recursion and invalidated it as `add`. The build file disappeared. Deleting `pytest.ini` and invalidating it as `delete` restored the file under the TOML config. Both transitions returned the recreated project, so the scheduler's listing-read condition (`src/core/scheduler/refinement.ts:115`) also holds. No restart was used.

### `testpaths` and `python_files`: scope of the fix

**Proven, informational; pre-existing behavior outside the repair delta.** At `src/runners/pytest/adapter-files.ts:55`, listed membership is `include` minus `exclude`; line 68 adds such a file regardless of `python_files`. The latter is read at line 88 to decide whether a skipped directory deserves a note (line 58), not to filter listed files. `testpaths` is not read by this listing. Setup uses both settings to seed the persisted include globs once (`src/cli/pytest-seed.ts:106`).

A real Python 3.13/pytest probe started with `testpaths = old`, `python_files = test_*.py`, and persisted include `["old/**/test_*.py"]`. After changing the live config to `testpaths = new` and `python_files = check_*.py`, invalidation recreated the project, but the list remained `[old/test_one.py]`. Default pytest collection reported `new/check_two.py::test_ok`; pytest explicitly passed the adapter's listed path still reported `old/test_one.py::test_ok`. Both collected one test successfully.

Thus 007-42 repairs a stale listing when the effective recursion policy changes. It does **not** dynamically regenerate include/exclude from `testpaths` or `python_files`. The broad outcome sentence in the brief overstates that behavior. This is not a new D5 invalidation gap: D5 requires resolver invalidation/re-resolution for config changes, which still happens, while D3 explicitly defines discovery by the persisted include/exclude globs and D6 passes those files explicitly to pytest. Under those contracts, the adapter must not silently replace the configured scope when pytest's default collection scope changes. There is nevertheless a pre-existing setup-to-live-coverage limitation: a newly configured directory outside the saved globs remains uncovered until the Squeal config is updated. The review does not claim that limitation is fixed.

## Inputs for the next wave

- No repair is required for wave 4 S1 or this relisting delta.
- Describe 007-42 as live recursion/config relisting within configured include/exclude. If live regeneration from pytest defaults is wanted, first specify how it interacts with user-authored globs and exclusions, then give it its own row and a test that changes `testpaths` to a directory outside the old include. Reading `testpaths` and intersecting it with old include would not admit that directory.
- The landing note must carry the four full-run failures and their isolated passes above. Build/drift verification remains the coordinator's check; it was expressly excluded here.
