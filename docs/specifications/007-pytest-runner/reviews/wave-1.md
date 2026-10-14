# Review of 007 waves 0 and 1 (007-16)

## Verdict

**FAIL a67407f85d5894f604bb94d8e9290f67b5f82046.** Three proven blockers, two proven should-fix findings, one proven verification-context nit. Review range: `638fb159..a67407f8` (0.1.161 and 0.1.163). Pytest is reviewed as a library; daemon assembly and agent surfaces belong to 007-14 and 007-15 and are not judged here. Interleaved 005 setup changes have their own reviews; this review follows 007-16's named seams.

## Verification output

The dispatched branch started at `557fd25a`, two documentation-only commits after the candidate. `git diff --name-only a67407f8 557fd25a` lists only `docs/board.md`, `docs/specifications/005-agent-adoption/status.md` and `docs/specifications/007-pytest-runner/tasks/wave-2.md`. Verification and probes ran detached at the exact candidate, with no tracked changes. The branch was restored before committing this file. No product, board or spec changes were made.

```text
$ git rev-parse HEAD
a67407f85d5894f604bb94d8e9290f67b5f82046

$ npm ci
added 58 packages, and audited 59 packages in 2s
19 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
exit 0

$ npm run lint
> squeal@0.1.163 lint
> biome check .
Checked 1054 files in 720ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.163 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.163 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.163 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(empty; build produced no tracked drift)

$ npx vitest run
FAIL test/runners/pytest/graph/oracle.test.ts
Error: Hook timed out in 10000ms.
test/runners/pytest/graph/oracle.test.ts:40:1 (afterAll cleanup)
Test Files  1 failed | 490 passed | 1 skipped (492)
Tests       4148 passed | 10 skipped (4158)
Start at    12:59:46
Duration    375.52s (tests 95%, import 3%, transform 2%)
exit 1
```

This is the required independent Vitest run, not Squeal's checkpoint. All test assertions passed; the full gate failed in the new oracle suite's cleanup hook (S2). A focused rerun was used to discriminate that failure; its output follows:

```text
$ npx vitest run test/runners/pytest test/policy/pytest.test.ts test/policy/node-test.test.ts
Test Files  21 passed (21)
Tests       182 passed (182)
Start at    13:06:24
Duration    32.47s (tests 79%, transform 17%, import 3%)
exit 0
```

Throwaway TypeScript probes ran with `node --import tsx`, imported the candidate's public library functions, and used only `test/helpers/pytest-env.ts` to sync temporary fixture copies. They were removed before committing. Output below shortens temporary paths to `<root>` and `<outside>`; no result values are changed.

## Blockers

### B1. Proven: no-config runs load an ancestor config that is absent from the key

Location: `src/runners/pytest/run/command.ts:101`, with `src/runners/pytest/environment/config.ts:48` and `src/runners/pytest/environment/hash.ts:99`.

D1: "Squeal passes it as `-c <file>` so every batch resolves the same config and rootdir whatever files it names." D2 hashes "the pytest config file's bytes". Goal 2 requires results with equal keys to be transferable; vision principle 2 ties the verdict to the code state.

When `findPytestConfig` returns `null`, the runner supplies only `--rootdir=<cwd>`. That option fixes pytest's root directory but does not stop config discovery above it. The run can apply untracked `addopts`, `pythonpath`, plugins and collection names from another directory, while the environment hash says there is no config and the graph uses none of those settings.

Reproduction on the helper's synced `small` fixture, Python 3.13.14 / pytest 9.1.1:

1. Rename the fixture's `pyproject.toml` after syncing, leaving no pytest config within the worktree. Write `tests/test_simple.py` with one passing test.
2. Write `../pytest.ini` containing `[pytest]` and `addopts = -k nonexistent`.
3. Call `readEnvironment(root, project, fixture.env)`, then `runPytest` on that file. Replace the parent config with `[pytest]` and repeat in a fresh log directory.

```text
first environment.config: null
first pytest stdout: rootdir: <root>; configfile: ../pytest.ini
first report: end=completed, completedFiles=[tests/test_simple.py], results=[], failure=null
second environment hash equals first: true
second report: end=completed, test_simple=pass, failure=null
```

**Worker-sized fix:** explicitly disable ancestor config discovery in the no-config branch, for example by passing an owned empty config plus the intended rootdir. Keep the runner, environment hash and graph's config contract aligned. Add a live regression with a parent config whose `addopts` and `pythonpath` differ, proving that parent changes cannot alter a no-config project's run. Do not silently adopt an unhashed config.

### B2. Proven: one global pytest search path misses a file's actual local import

Location: `src/runners/pytest/graph/search-path.ts:76`, with `src/runners/pytest/graph/graph.ts:93` and `src/runners/pytest/graph/modules.ts:107`.

D4 models "under `prepend` (the default) each test file's basedir ... comes first". D5 schedules closure holders; the Testing contract says a static closure "contains a real run's observed closure". Goals 1 and 2 need correct selection and file-only keys before a run.

The graph inserts every listed test file's basedir into one search path and lets the last insertion win for every module. A file run alone, or first in a batch, sees its own basedir and can import a different existing module. Both files have ordinary literal imports, so the graph marks the incorrect closure complete. This is not an unsupported computed import.

Reproduction after adding these files to a synced `small` fixture (neither `a/` nor `b/` has `__init__.py`):

```python
# tests/a/helper.py
VALUE = "a"
# tests/b/helper.py
VALUE = "b"
# tests/a/test_a.py
import helper
def test_a():
    assert helper.VALUE == "a"
# tests/b/test_b.py
import helper
def test_b():
    assert helper.VALUE == "b"
```

Build with `testFiles: ["tests/a/test_a.py", "tests/b/test_b.py"]`, then run `test_a.py` alone:

```text
graph.closure(test_a).complete: true
graph.closure(test_a): includes tests/b/helper.py; omits tests/a/helper.py
graph.affected([tests/a/helper.py]): {direct: [], transitive: []}
runPytest(test_a): test_a=pass
observed(test_a): includes tests/a/helper.py
```

Changing `a/helper.py` cannot change this static key or select its literal importer before observations have repaired it. The observed-closure mechanism can qualify a first run, but cannot meet the promised static closure or first-use selection on its behalf.

**Worker-sized fix:** resolve test roots and their reached imports with the appropriate pytest import context rather than the union's last basedir. When batch order or Python's module cache can legitimately change the origin, include every possible origin or qualify that ambiguity explicitly. Add the two-helper fixture, both file orders and batch sizes 1 and 2, checking actual imports are represented and edits select their consumers. Preserve the amended synced/unsynced candidate equality.

### B3. Proven: an editable URL through an in-tree symlink bypasses the outside refusal

Location: `src/runners/pytest/environment/states.ts:77`.

D2: "Any `*.dist-info/direct_url.json` with `dir_info.editable` whose `url` lies outside the worktree ... Nothing runs, since the verdict can be wrong either way." Goal 7: "never another worktree's" code.

`outsideEditables` canonicalizes the worktree root but compares the editable target only lexically. A URL such as `file://<root>/src` passes when `src` is a symlink to another tree. Python follows the link; Squeal reports `ready` even though the package's real origin is outside its worktree.

Live reproduction on the helper's synced fixture:

1. Move `src/` to a sibling `<outside>/`, then make `<root>/src` a directory symlink to it.
2. Set app's `direct_url.json` to `{"url":"file://<root>/src","dir_info":{"editable":true}}`. The existing `.pth` still resolves through `<root>/src`.
3. Read the environment and ask its interpreter for `os.path.realpath(app.__file__)`.

```text
readEnvironment.state: ready
actual import: <outside>/app/__init__.py
actual import starts with <root>/: false
```

**Worker-sized fix:** resolve an existing editable target to its real path before containment checks, retaining the original URL for diagnostic context if useful. Add a directory-symlink regression and retain coverage for a worktree root itself reached through a symlink. An outside target must return `editable-outside`, name the resolved package/path, and prevent a run.

## Should-fix

### S1. Proven: a suite consisting entirely of skips gets no note

Location: `src/runners/pytest/run/run.ts:168`.

D3: "A project whose run skipped every collected test gets one note, since pytest exits 0 then." A live file containing one `@pytest.mark.skip` test returned `results=[skip]`, exit 0 and `notes=[]`. Notes currently cover exit 5, refused flags and address IDs, but not all-skipped runs.

**Fix:** emit one project note when a completed run collected tests and every outcome is `skip`. Cover ordinary skips and xfails, and distinguish them from zero collected tests and incomplete runs. Outcomes are already honest, so this missing diagnostic is not a blocker.

### S2. Proven: the oracle cleanup hook fails the independent full-suite gate

Location: `test/runners/pytest/graph/oracle.test.ts:40`, using `test/helpers/pytest-env.ts:93`.

The full run passed all 4,148 assertions, including both oracle tests, but `afterAll` exceeded Vitest's default 10-second hook budget while deleting the synced fixture copies. The failure output is recorded above. This proves a red verification gate, not a graph correctness failure or a consistently reproducible timing fault.

**Fix:** give this filesystem cleanup an explicit budget appropriate to synced environments, following the existing long fixture setup budgets, or make cleanup cheaper. Keep cleanup failures visible. The focused rerun below discriminates the load sensitivity; do not treat a focused pass as a full-suite pass.

## Nits

### N1. Proven: dispatch HEAD differed from the named candidate

The worker started at `557fd25a`, not `a67407f8`. The delta was documentation only; verification was moved to the exact candidate and the review remained bounded. No product repair is needed. Future review dispatches should name both the checkout baseline and candidate when a later brief commit is required.

## What fits

- **Proven:** the `policy-node-test.ts` extraction preserves messages, defaults and the duplicate-name rule. A differential probe compared the pre-range and candidate `nodeTestProjects` outputs on 100 cases: list/type errors, each field's invalid values, defaults, repeated valid names and an invalid entry followed by the same valid name. Every serialized output matched exactly. Existing node:test policy tests were included in verification.
- **Proven:** two real synced copies hash equally on Python 3.10 and on 3.13. Hashes differ across those minors. Synthetic tests cover the `<worktree>` rewrite, a foreign activation, lock-only stability, installed-entry changes and config/argument/environment changes.
- **Proven:** the graph oracle assertions passed on both Pythons, including equal closure hashes with `.venv` moved away. The amended candidate scan, stdlib precedence and `TYPE_CHECKING` body exclusion fit the fixture. B2 concerns a different import-context case the oracle fixture lacks.
- **Proven:** the normal no-environment and direct editable-outside cases have notes and refuse readiness. The fingerprint and `syncNote` library expose the inputs the adapter needs; storing nothing across a sync is still 007-14's assembly obligation, not a library integration claim.
- **Proven:** a live batch with an earlier passing file and a later passing call hung in teardown ended at the 10-second deadline. Only the earlier file survived; the event stream contained the later setup and call passes but no teardown. Recorded and live outcome tests cover setup/teardown failures, xfail/xpass, module skips and collection errors without losing the other files.
- **Proven:** static flag refusal and the runtime `pytest_configure` guard pass the existing tests, including `-o addopts=--lf`. Installed xdist is disabled and `-x` overridden without deleting the project's supported filters. Both built plugin trees contain the reporter and both WASM files, with no build drift.

## Inputs for the next wave

1. Dispatch B1, B2 and B3 as repairs and re-review their delta before releasing this library. These fixes can be separate ownership slices: runner/config boundary, graph import contexts, environment containment.
2. 007-14 must call `readEnvironment` before a tier and admit only `ready`; supply config collection patterns, `pythonpath` and import mode to the graph; add the worktree plugin closure to the core/adapter environment key. A resolved environment is not proof its fingerprint will remain stable during execution.
3. Capture the fingerprint before spawning, compare a fresh fingerprint after every run, and drop the run's results when `syncNote` reports a change. The library runner does not enforce that check itself. Recreate graph/runner state when the environment changes.
4. Persist observed-only paths with stored closures in one transaction, as 003 D3 requires. `graph.recordObserved` affects selection but `graph.closure` is static at this candidate; the adapter must explicitly merge observed paths into its returned/keyed closure. Qualify a first result whose observed closure exceeds the static one.
5. Preserve `completedFiles` as the commit boundary; a call pass is insufficient. The library intentionally retains fully torn-down earlier files without a final session record when a later file is killed. D6's sentence also names a session record as a completion prerequisite: the coordinator should reconcile that wording with its explicit killed-batch requirement rather than making the adapter discard the earlier files.
6. Continue to supply a persistent state-directory cache (status.md, open question 3), bounded batch concurrency, one tier deadline and isolated slow files. Propagate `skippedFiles`, collection `fileErrors`, runtime refusal and run notes.
7. Pytest 8 remains **unverified** in this review: the live locked fixture installs pytest 9.1.1 on both Pythons. A compatibility check on pytest 8 is still needed before claiming the spec's full version envelope. Daemon inheritance, hooks and the bundled CLI's first actual graph load remain wave 2 verification, not claims from copying the runtime assets.
