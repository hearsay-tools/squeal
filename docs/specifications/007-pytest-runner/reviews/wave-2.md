# 007 wave 2 review

Candidate: `62b9ea96dcdcb617d260e2266a3841aa1ce6a886`.
Range: `34ce2b57..62b9ea96dcdcb617d260e2266a3841aa1ce6a886`.
Rows: 007-14, 007-15, 007-19. Reviewer: Codex, 2026-10-14.

**FAIL: five proven blockers; no should-fix findings or nits.** Accepted plugin bundle and key-format drift are not findings. The review changes no product code.

## Verification

The checkout equals the dispatched candidate and had no tracked changes throughout the checks and probes. Dependencies were installed from the lockfile. The independent Vitest run is the reviewer gate required by `docs/process.md` and `/reviewer`, rather than a Squeal checkpoint. Build was explicitly excluded by the dispatch; its absence is **unverified**, not a finding. Bundle smoke tests build into temporary directories without modifying committed bundles.

```text
$ git rev-parse HEAD
62b9ea96dcdcb617d260e2266a3841aa1ce6a886

$ npm ci
added 58 packages, and audited 59 packages in 2s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.166 lint
> biome check .
Checked 1087 files in 2s. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.166 typecheck
> tsc --noEmit
exit 0

$ npx vitest run
FAIL test/policy/repository-inputs.test.ts:99 (afterAll): Hook timed out in 10000ms
FAIL test/harness/plugin.test.ts (1 test): committed bundle drift
FAIL test/harness/codex/plugin.test.ts (1 test): committed bundle drift
FAIL test/keys/key-format.test.ts (3 tests): accepted key-format drift
Test Files  4 failed | 502 passed | 1 skipped (507)
Tests       5 failed | 4287 passed | 10 skipped (4302)
Start at    14:27:43 Europe/Warsaw
Duration    508.45s
exit 1
```

The five assertion failures are the accepted bundle/key drift. One additional suite failed its unchanged cleanup hook at `test/policy/repository-inputs.test.ts:99`; this is outside the range and is reported as a verification limitation, not a wave finding. The focused rerun on the clean candidate passes:

```text
$ npx vitest run test/policy/repository-inputs.test.ts
Test Files  1 passed (1)
Tests       4 passed (4)
Start at    14:39:20 Europe/Warsaw
Duration    3.90s
exit 0
```

This rerun qualifies the cleanup timeout; it does not turn the full-suite result green. No pytest adapter, runner, environment, bundle smoke, setup, command-recognition or integration assertion failed in the independent full run.

Live probes used `test/helpers/pytest-env.ts` to sync temporary copies of the small fixture with Python 3.13 / pytest 9.1.1. Each probe stopped its daemon and removed its fixture, logs and temporary runtime directory. Admission's 20-second limit was tested with a controlled clock and a real fingerprint change at every simulated 200 ms poll; the separate startup and execution probes used real time. These are **proven** results on the candidate. Python 3.10 coverage comes from the independent suite; pytest 8 compatibility remains the assigned wave 3 obligation.

## Blockers

### B1. Proven: an installed-package change can leave old passing results current

Locations: `src/runners/pytest/adapter-environment.ts:123`, `src/runners/pytest/adapter.ts:167`. The caller contract is `src/core/scheduler/scheduler.ts:208`: a reconciliation with no content change or touched path does not invoke the adapter. This is an assembly finding against the new adapter, not a request to re-review that existing scheduler rule.

D2 says the environment hash includes the sorted site-packages entries, every `.pth` and `direct_url.json`, and that a change recreates project state before the next tier. The Testing section explicitly requires an installed plugin upgrade to re-key every file. Vision principle 2 forbids old results posing as current truth.

The new adapter exposes only the config, plugin source closure, `pyvenv.cfg` and `pytest/__init__.py` as environment files. Its other installed-set inputs are read only when `invalidate` is called. A normal dependency install need not modify either watched environment file. `.venv` is ignored, so even an explicit reconciliation can find no changed candidate and never call `invalidate`.

**Reproduction:** sync the small fixture; create `site-packages/reviewdep/__init__.py` with `VALUE = 1` and `reviewdep-1.0.dist-info`; add `test_installed_dependency` to `tests/test_resources.py`, importing reviewdep and asserting its value is 1. Ignore `.venv`, commit the fixture, and start the source daemon with the ordinary three-file pytest project. After its passing baseline, replace the dist-info directory with `reviewdep-2.0.dist-info` and change the installed module to `VALUE = 2`. Change no worktree source, config, `pyvenv.cfg` or pytest marker. Request three daemon `sync` passes. A fresh environment read and adapter run see the new installed set and failing test.

```text
daemon baseline: revision 0; current 12, pending 0, stale 0, unknown 0; known failures 0
fresh environment hash after install differs from the baseline environment hash: true
daemon after reconciliation: revision 0; current 12, pending 0, stale 0, unknown 0; known failures 0
fresh adapter run: test_values=pass; test_installed_dependency=fail
```

**Worker-sized fix:** connect the entire D2 environment fingerprint to change detection, including site-packages entry additions/removals and `.pth`/direct-url byte changes. A bounded environment recheck during reconciliation can cover directories and declared external environments that a fixed file list cannot watch. On a change, make old states noncurrent, re-read the environment and re-resolve/re-key the project's files before execution or inheritance. Add a daemon regression with no unrelated source edit, covering a real installed-set upgrade and a `.pth` change. Do not hash the lockfile as a substitute.

### B2. Proven: admission does not enforce the one-second stability rule

Locations: `src/runners/pytest/adapter.ts:105`, `src/runners/pytest/adapter.ts:169`, `src/runners/pytest/adapter-run.ts:122`.

The dispatch explicitly requires admitting an environment only once pytest is installed and its fingerprint has held for 1 s, waiting at most 20 s. Commit `552f5fe2` describes this same contract. This is an additional review requirement even though the current `status.md` does not yet record it as a dated amendment.

The initial adapter read admits `ready` immediately; only a later signature change in `invalidate` calls `quiet`. In addition, `quiet` returns `void` both after a stable second and after an unstable 20-second timeout. `invalidate` unconditionally reads and admits the resulting environment in both cases.

**Reproduction:** immediately after writing a fingerprint input (`review.pth`) into a synced environment, create the adapter and read its environment. In two real-time probes it returned `runnerVersion: 9.1.1` after 279 ms and 518 ms, without a stable second. Separately, create the adapter, change that `.pth`, then invalidate while a controlled clock advances 200 ms and rewrites the `.pth` at every poll. The last poll is itself a fingerprint change.

```text
startup after fingerprint input write: ready in 279 ms / 518 ms
invalidate with fingerprint changing at every poll:
  simulated elapsed: 20000 ms
  recreatedProjects: [small]
  runnerVersion: 9.1.1
  fingerprint changed at the last poll: true
```

No 1 s quiet interval occurred in the timeout probe, yet the environment is admitted. Before/after-run fingerprint equality does not establish that an environment had settled before it was keyed, and inheritance can happen without a run at all.

**Worker-sized fix:** make initial admission and every re-admission share one bounded stabilization path. Return an explicit stable/timeout outcome and the exact stabilized fingerprint; keep a timeout nonready, unknown, with one sync note and no inherited or stored result. Re-read and compare the environment used for admission with that stabilized fingerprint. Add controlled-clock regressions for startup, successful stabilization, a change near the final read, and continuous changes through the 20 s limit. Preserve pytest-installed admission and the existing checks around execution.

### B3. Proven: module-level skip discards previously observed parameter identities

Locations: `src/runners/pytest/adapter-run.ts:77`, `src/runners/pytest/adapter-run.ts:88`; downstream `src/core/scheduler/records.ts:84` and `src/core/scheduler/ledger.ts:284` explain the result.

D6 says: “a module-level skip skips the file's known checks.” D7 says: “After the file has run, the observed node IDs stand.” The adapter's `skipKnown` instead enumerates the current source and emits a skip for each static base name. It has no access to the previously observed or inherited check identities.

**Reproduction:** add this file to the synced fixture and run it through one adapter:

```python
import pytest
@pytest.mark.parametrize("x", [1, 2])
def test_param(x):
    assert x > 0
```

Prepend `pytest.skip("no service", allow_module_level=True)` after the import, invalidate the file and run it again.

```text
first report: test_param[1]=pass; test_param[2]=pass
second report completedFiles: [tests/test_review_skip.py]
second report results: test_param=skip
second report fileErrors: []
```

Both known parameter IDs are missing. The scheduler does not expand a module skip as it expands collection errors: the no-file-error path returns the synthetic skip plus a passing file-level check. `applyResults` retires the absent parameter checks. Ordinary unparametrized module-skip tests pass while this contract remains broken. Generated or inherited identities have the same problem.

**Worker-sized fix:** carry a file-level skip marker to the part of the pipeline that knows previous checks, or supply those identities to the adapter through an agreed contract. Expand the skip to every previously observed/inherited test ID, retaining static enumeration only for an unseen file. Do not invent a nonparametrized result for a known parametrized test. Add a daemon regression after a passing parametrized baseline and a fresh-worktree regression using inherited IDs. If this requires a `RunReport` or `RunnerAdapter` amendment, take that decision to the coordinator before implementation, as `status.md` requires.

### B4. Proven: the deny resolves bare pytest to a configured subset and hides an uncovered failure

Locations: `src/harness/shared/test-command-files.ts:77`, `src/harness/shared/test-command-files.ts:81`, `src/harness/shared/test-command-pytest.ts:61`.

007 D8 extends 005 D8's “resolve or fall through” rule. 005 D8 step 3 says: “One file pending, stale, unknown, unlisted or outside Squeal's runners, and the command runs.” The hook must resolve the files the actual command would run, not just the subset Squeal was configured to validate.

For no path, `pytestFiles` returns every listed file of that one project. For a directory, it returns only listed descendants. Neither case establishes that pytest's own discovery is fully covered by the configured `include`/`exclude`. The pytest branch also precedes the omitted-file guard used for Vitest.

**Reproduction:** sync the small fixture, replace `tests/test_resources.py` with a failing `test_uncovered`, and configure:

```json
{
  "pytest": [{ "name": "small", "include": ["tests/unit/test_core.py"] }],
  "testCommand": { "denyWhenCurrent": true }
}
```

Start the daemon; its configured file passes. Register a Claude Code session, then issue `PreToolUse` for `Bash` command `pytest` at the root. The live hook returns:

```text
permissionDecision: deny
The command did not run. Squeal holds current results at revision 0 for the 1 test file it runs
(tests/unit/test_core.py): 7 checks passed, no known failures, none inherited.
```

The same interpreter's actual `python -m pytest -q` exits 1 with:

```text
FAILED tests/test_resources.py::test_uncovered - assert False
```

The configured subset does not describe what bare pytest runs. A directory argument such as `pytest tests` has the same resolution gap.

**Worker-sized fix:** fall through for no-path and directory commands unless complete pytest discovery coverage can be established from the configuration and listing without collecting. Preserve denial of individually named covered files/node IDs when all files are current. Add hook regressions for narrower `include`, an excluded failing file, and a directory containing an unlisted test; all must run normally. Keep recognized invocation forms and the existing unsupported-flag/chain/assignment fall-through cases intact.

### B5. Proven: dynamically imported startup-plugin modules never enter a key

Locations: `src/runners/pytest/adapter.ts:235`, `src/runners/pytest/adapter.ts:252`, `src/runners/pytest/adapter-run.ts:80`.

D2 places the worktree closure of `pytest11` and `-p` plugins in the environment key. Goal 5 requires imported paths missed by the static graph to be stored, to block inheritance on a content difference and to schedule work on an edit. The library already returns these startup observations in `PytestRun.session`, separate from each completed test file's observations. The adapter consumes only `run.observed`; it neither records `session` nor reports it through the existing `RunReport.environmentObserved` mechanism.

**Reproduction:** in the synced small fixture, replace its registered `other.plugin` with:

```python
import pytest
import importlib
name = "other.hidden"
hidden = importlib.import_module(name)
@pytest.fixture
def other_fixture():
    return hidden.VALUE
```

Create `packages/other/src/other/hidden.py` with `VALUE = 2`. Configure the project to run `tests/test_entry_plugin.py`, whose fixture assertion expects 2. Run it, then change only hidden.py to `VALUE = 3` and invalidate that path.

```text
baseline outcome: pass
library run's session includes hidden.py: true
adapter environment files include hidden.py: false
adapter file closure includes hidden.py: false
adapter observed store: {}
after hidden.py edit:
  recreatedProjects: []
  affected: {direct: [], transitive: []}
  environment unchanged: true
actual next run: test_entry_plugin=fail
```

The reporter saw the import; assembly drops it. The hidden module is neither a closure nor an environment input, so the current key has not changed and a worktree with different hidden.py can inherit that pass. This reproduction changes worktree source, unlike B1's ignored installed set.

**Worker-sized fix:** persist startup-plugin observations per project, merge them into `environment().files` and carry newly observed session paths through `RunReport.environmentObserved`. Follow the existing node:test environment-growth contract: do not commit a result under an environment key missing a startup input; re-key and rerun with bounded growth. Merge shared observations transactionally and register any new shared meta key. Add the dynamic-entry-point reproduction, selection on its edit, and a second synced worktree whose hidden module differs. Cover `-p` startup plugins too. Keep environment-directory paths covered by the fingerprint rather than adding all site-packages source files to closures.

## Should-fix

None beyond the blockers.

## Nits

None.

## What fits

- **Proven by the independent integration test:** a synced second worktree inherits the baseline with no completed pytest runs, an unsynced one retains unknown pytest files, and observed-only edits re-key/select their file and block a differing worktree from inheriting. Claude Code and Codex hooks receive the pytest `PASS -> FAIL`. These existing cases pass but do not exercise B1 to B5.
- **Proven by source:** `pytestObservedStore.write` reads/merges the shared `pytest.observed.<project>` key and unions additions into the stored closure inside one `Store.transaction`. Concurrent worktrees do not replace each other's observations. The adapter explicitly unions those observed paths into `closure`, refreshes shared growth and reports it in `affected`.
- **Proven by live probe:** when the environment fingerprint changes during execution, the adapter returns a crashed report with empty `results` and `completedFiles` and the sync note. It records no observation from that run. The before-spawn comparison uses the fingerprint of the environment that was keyed, not merely two arbitrary fresh snapshots.
- **Proven by source:** the runner filters observations to `completedFiles` before the adapter records them. The adapter passes completed files, collection errors, durations, run endings and notes through; it does not turn a call pass into a completed file. Batch concurrency is bounded by the daemon's tier size, slow-lane files run alone, and cache/pycache live under the state directory.
- **Proven by source:** config collection names, pythonpath, import mode and worktree plugin closures are wired into enumeration/graph/environment. Environment signature changes report project recreation and force structural graph invalidation; changed graph settings rebuild the graph. B1 is the missing change-detection trigger, not absence of that recreation path.
- **Proven by source and tests:** repositories without pytest retain the prior Vitest construction predicate and options. A pytest-only repository suppresses the unused Vitest adapter when Vitest is not detected; detected Vitest still runs beside pytest. The pytest-only live probes validate that construction path.
- **Proven by source:** the residual all-skipped note from wave 1.5 now requires a completed tier, no failure/refusal, and every requested file completed. A partial crash cannot meet that guard.
- **Proven by source and tests:** invocation recognition rejects unsupported flags, chains, `cd`, assignments, foreign cwd, ambiguous projects and explicit project environment mismatches. Setup seeds two independently configured projects, derives globs from `testpaths`/`python_files`, preserves declared projects and reports refused `addopts`. Both skills and the primer/instruction block name pytest. B4 concerns completeness of the resolved file set after recognition.

## Inputs for the fix wave and proof

1. Repair B1 and B2 together or on an explicit shared environment-admission seam. Stabilization must run before key lookup/inheritance and must not rely solely on an eventual test process to detect installs. The 20 s limit bounds waiting; it is not permission to admit an unstable environment. Record the admission rule in D2/status as the dispatch already requires it.
2. B3 needs the core's known check IDs, especially after inheritance. Agree the smallest skip-report contract before changing the shared interface; preserve the existing collection-error and `completedFiles` contracts.
3. B4 can be repaired conservatively by letting commands with uncertain discovery run. Do not use pytest collection to decide whether to stop a command.
4. B5 belongs on the plugin-environment observation seam. `RunReport.environmentObserved` already exists; use its scheduler growth handling instead of treating startup observations as a test file's private inputs.
5. Keep the existing observed-path transaction, explicit closure union, across-run fingerprint check, persistent cache and partial-completion handling. Rebuild/re-pin only at coordinator landing, as dispatched.
6. Wave 3 still owns pytest 8, the shipped harness entry points and real-project dogfooding. The wave 2 integration exercises one pytest project beside Vitest; the spec's mixed repository with two pytest projects remains a proof case. The bundle smoke test builds the Claude Code CLI; the Codex bundle's equivalent live loading remains proof work.
