# Re-review of 007-20 (007-21)

## Verdict

**PASS 0013080e37bc06e11165df153e0e6c151fd8e80d.** Zero blocking findings. B1, B2, B3 and S2 are closed. S1 is not fully closed: its original missing note is fixed, but an incomplete run can receive an inaccurate all-skipped note. This is one proven, nonblocking should-fix finding. No new blockers or nits.

Range: `5b50e9dd..0013080e`, the five repair commits only. This is the second and last review of this slice, bounded by `reviews/wave-1.md` and the 007-20/007-21 briefs in `tasks/wave-2.md`. Daemon assembly remains outside this review. Plugin bundle drift and key-format drift are explicitly accepted integration work, not findings here.

## Verification output

Checks and live probes ran on the exact candidate with a clean tracked tree. Only this report was written afterward. The independent full Vitest run was required by the reviewer skill and repository instructions; Squeal's baseline was not substituted for it. Python environments came exclusively from `test/helpers/pytest-env.ts`, using temporary synced copies of `small`. Temporary probes were removed before committing. Output below is excerpted; temporary directory names are shortened to `<root>`, `<cache>` and `<outside>`.

```text
$ git rev-parse HEAD
0013080e37bc06e11165df153e0e6c151fd8e80d
$ git status --short
(empty)

$ npm ci
added 58 packages, and audited 59 packages in 2s
19 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts: @parcel/watcher@2.6.0 and esbuild@0.28.2 have scripts not covered by allowScripts
exit 0

$ npm run lint
> squeal@0.1.163 lint
> biome check .
Checked 1056 files in 639ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.163 typecheck
> tsc --noEmit
exit 0

$ npm run build
NOT RUN: explicitly excluded by the dispatch brief.
```

Build and bundle freshness are **unverified** in this worktree. No product files, bundle files or key pins were edited.

```text
$ npx vitest run
FAIL test/keys/key-format.test.ts > KEY_FORMAT_VERSION > is bumped whenever the guarded sources change
FAIL test/keys/key-format.test.ts > an adapter-only bump > of src/runners/vitest/version.ts keeps the global pin
FAIL test/keys/key-format.test.ts > an adapter-only bump > of src/runners/node-test/version.ts keeps the global pin
Expected current sources hash: daf2262bae811118bd3521a4d63fb5db01f1f7ca614b4db3bd25f75d4917cc8b
Existing pin: bdb35ed477a0995d6eb8941e9b2c41b2b274bd5fc22819c83cb8d46fd27dc2d1
Test Files  1 failed | 492 passed | 1 skipped (494)
Tests       3 failed | 4163 passed | 10 skipped (4176)
Start at    13:36:22
Duration    411.34s (tests 95%, import 3%, transform 2%)
exit 1

$ git status --short
(empty after all verification and live probes)
```

The only failing test file is the accepted key-format drift. There is no pytest graph, runner, environment or oracle cleanup failure. The full gate remains red until the coordinator re-pins it; the bounded review verdict is PASS because the three prior blockers are closed.

## Verdict per prior finding

| Finding | Verdict | Evidence |
| --- | --- | --- |
| B1: ancestor config absent from key | **Closed, proven** | On Python 3.10 and 3.13, both parent configs produce the same environment hash and a passing test. The run loads the owned empty config, not the ancestor. Parent `pythonpath` and a raising parent conftest cannot affect it. |
| B2: one global basedir loses a local import | **Closed, proven** | Both helper origins are present files in both static closures. Each helper edit selects both consumers. Live observed paths are contained in the static closure in both orders and at batch sizes 1 and 2. Paths and content hashes remain equal with `.venv` present and moved away. |
| B3: editable URL follows a symlink outside | **Closed, proven** | The actual Python import resolves outside, and `readEnvironment` now returns `editable-outside`, naming `app` and its real outside path. A worktree root reached through a symlink remains `ready`. |
| S1: all-skipped run lacks a note | **Not fully closed, proven** | The original ordinary skip and xfail-only runs receive one note; mixed outcomes receive none. A partial crash still receives that note, described below. |
| S2: oracle cleanup exceeds 10 seconds | **Closed, proven** | The hook has an explicit 60-second budget and keeps cleanup exceptions visible. The independent full run has no oracle assertion or cleanup failure. |

### B1 live reproduction

Locations: `src/runners/pytest/run/command.ts:106`, `src/runners/pytest/run/run.ts:238`, `src/runners/pytest/environment/config.ts:39`.

After syncing, park `pyproject.toml` so `environment.config` is null. Write `tests/test_simple.py` with a passing assertion that `parent_only` cannot be imported. Above the worktree, write `parent_only.py` and a conftest that raises immediately. Run first with parent `pytest.ini` containing `addopts = -k nonexistent` and `pythonpath = .`, then with just `[pytest]`.

```text
Python 3.10 / pytest 9.1.1 and Python 3.13 / pytest 9.1.1:
first config: null
first stdout configfile: <cache>/no-config/pytest.ini
first report: end=completed, test_simple=pass, failure=null
second stdout configfile: <cache>/no-config/pytest.ini
second report: end=completed, test_simple=pass, failure=null
first environment hash equals second: true
```

The `-c` argument prevents discovery above the tree; `--rootdir` and `--confcutdir` keep rootdir and conftest discovery at the project. No ancestor config bytes need to enter the key because they no longer change these runs.

### B2 live reproduction and hash equality

Locations: `src/runners/pytest/graph/search-path.ts:82`, `src/runners/pytest/graph/resolver.ts:127`, `src/runners/pytest/graph/resolver.ts:170`.

Add the review's `tests/a/helper.py` and `tests/b/helper.py`, with distinct `VALUE` values and literal `import helper` in each test. The original equality assertions pass when each file runs alone on Python 3.13. Both observe their own helper and both static closures include that helper. For the batch matrix on both Python minors, allow either value in the assertion so the module cache's legitimate first-import choice does not itself fail the test.

```text
For both graph test-file listing orders [a,b] and [b,a]:
closure(a).complete = true; present origins = [tests/a/helper.py, tests/b/helper.py]
closure(b).complete = true; present origins = [tests/a/helper.py, tests/b/helper.py]
affected([tests/a/helper.py]).direct = [tests/a/test_a.py, tests/b/test_b.py]
affected([tests/b/helper.py]).direct = [tests/a/test_a.py, tests/b/test_b.py]

Live on Python 3.10 and 3.13, pytest 9.1.1:
order a,b; batch size 1: a imports a/helper.py; b imports b/helper.py
order a,b; batch size 2: a imports a/helper.py; b imports a/helper.py
order b,a; batch size 1: b imports b/helper.py; a imports a/helper.py
order b,a; batch size 2: b imports b/helper.py; a imports b/helper.py
Every run: two passing results, failure=null, observed paths outside static closure=0

Both listing orders and both Python minors, after moving .venv away:
closure paths with environment equal paths without environment: true
closure content hashes with environment equal hashes without environment: true
a: e311000ed4b84d80cd397d76098a31bb5bf8e34d727cbefd9f08d9cd4e1778fd
b: b8f3e605eef5f1604875505fb39e2b0f70d3e633543df85e48f8e656d2cdd78e
```

A basedir hit is a **possible origin**, not a missed import or an absent candidate: `findTop` pushes its `Spec`, continues through other possible basedirs to the stable fallback, and `origins` returns every in-worktree origin. Dotted lookups follow each possible package's search locations. The live helpers are existing files in `closure.paths`, are parsed as dependencies, and are selected on edit. The extra origins deliberately cover batch order and Python's module cache; they do not make an otherwise literal closure incomplete.

The existing oracle independently checks the amended candidate rule and equal hashes with and without an environment on the ordinary fixture. The live probe above adds that equality check to the specific two-basedir failure case.

### B3 live reproduction

Location: `src/runners/pytest/environment/states.ts:80`.

Move `src/` outside the worktree, symlink `<root>/src` to it, and point app's editable `direct_url.json` at `file://<root>/src`. Ask the synced interpreter for `realpath(app.__file__)`, then call `readEnvironment`.

```text
Python 3.10 and 3.13, pytest 9.1.1:
actual app import is outside the worktree: true
readEnvironment.state: editable-outside
editables: [{distribution: app, path: <outside>/src}]
note names app and its resolved outside path: true
worktree root itself reached through a symlink, after restoring src: ready
```

The target is canonicalized before containment, so this environment cannot be admitted as `ready` to a runner. No test batch was launched from the refused state. Library callers must still admit only `ready`, as the original review specified for 007-14.

## Blockers

None. All three previously blocking reproductions are closed.

## Should-fix

### S1. Proven, nonblocking: the all-skipped note can describe an incomplete run

Location: `src/runners/pytest/run/run.ts:197`, interacting with `src/runners/pytest/run/batches.ts:74`.

D3 says: "A project whose run skipped every collected test gets one note, since pytest exits 0 then." The original S1 fix request also requires distinguishing incomplete runs. The ordinary skip and xfail-only reproductions now receive one note, and a mixed pass/skip run receives none. However, `ending` intentionally returns `end: completed` with a non-null failure when some files completed and another file did not. The new guard tests only `end`, and the helper sees only the completed subset.

Live reproduction on both Python minors: run these two files in one batch, skip first.

```python
# tests/test_skips.py
import pytest
@pytest.mark.xfail(reason="expected")
def test_xfail():
    assert False

# tests/test_exit.py
import os
def test_exit():
    os._exit(2)
```

```text
end: completed
completedFiles: [tests/test_skips.py]
failure: pytest ended without a complete report for tests/test_exit.py (exit code 2)
notes: [pytest project "small" skipped every collected test (1 skipped) in its one file; pytest exits 0 then, so check what skips them (a missing setting or service often does).]
```

The second test was collected and did not skip; this process exited 2. The report retains the earlier skip and honestly names the incomplete file, so this diagnostic defect does not produce a false passing result and remains nonblocking. The new tests cover empty, mixed and collection-error cases, but do not exercise this partial completion path.

**Worker-sized fix:** emit the note only for a fully completed tier with no runner failure or refusal and every requested file completed. Add the live partial-crash regression, preserving the earlier skip result and non-null failure while asserting there is no all-skipped note. Keep the ordinary skip, xfail-only, zero-collection, collection-error and timed-out cases covered. This review does not change the intentional partial-completion contract in D6.

## Nits

None. The dispatched checkout equals the candidate. The prior documentation-only HEAD mismatch is not repeated.

## What fits

- **Proven:** B1's no-config execution contract matches the environment's null config and the graph's lack of ancestor config inputs.
- **Proven:** B2's conservative origins represent both standalone resolution and batch cache reuse, without losing selection or the amended synced/unsynced hash equality in the named reproduction.
- **Proven:** B3 refuses the symlink escape and preserves a legitimate symlinked worktree root.
- **Proven:** ordinary all-skipped and xfail-only runs now receive exactly one note, while mixed passing runs receive none.
- **Proven:** S2 raises only the fixture cleanup budget; cleanup still throws on failure. No oracle cleanup failure occurred in the independent full-suite run.

## Inputs for integration and the next wave

1. The three prior blockers need no further repair on this slice. Carry the residual S1 diagnostic as nonblocking work; this is the last review round requested for 007-20.
2. Rebuild plugin bundles and update the key-format pin at integration, as assigned to the coordinator. This review does not claim a green full-suite gate while that accepted drift remains.
3. The runner's internal `CommandInputs` now requires `emptyConfig`; `runPytest` supplies it. The public `runPytest`, graph and `readEnvironment` signatures are unchanged. No core runner-interface amendment is needed.
4. The original review's adapter obligations still apply: only `ready` environments may run, check the fingerprint across a run, persist observed-only paths transactionally, and use `completedFiles` as the commit boundary. They were not re-prosecuted in this bounded repair review.
5. Pytest 8 and daemon/harness assembly remain **unverified** here. Live fixtures install pytest 9.1.1; compatibility and integration belong to the previously assigned proof rows.
