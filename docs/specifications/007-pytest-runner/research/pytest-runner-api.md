# pytest runner API findings

2026-10-13, row 007-01. **Verdict: prefer fresh pytest processes over selected file batches, with a streaming `-p` reporter.** Startup is expensive, but reusing imported project/plugin state gave stale results.

Evidence tags: **E** = verified by experiment; **D** = read in official docs; **S** = read in source code; **I** = inferred. Unless qualified, E/S refer to pytest **8.4.2**, CPython **3.10.20 and 3.13.14**, Linux x86-64. Installed plugins: xdist 3.8.0, timeout 2.4.0, json-report 1.5.0, asyncio 1.2.0, anyio 4.11.0, django 4.11.1 / Django 5.2.7, syrupy 4.9.1, cov 7.0.0. Exact installs, commands and raw evidence: [probe README](probes/pytest-runner-api/README.md). No product code changed.

## Questions answered

| Brief question | Finding | Evidence |
|---|---|---|
| 1. Fresh, warm or forked runner; costs | Fresh sees edits; repeated main and contaminated forks do not. Startup dominates a trivial test. | E/S/D, F1 |
| 2. Result transport and completeness | Hooks retain phases and incomplete prefixes; neither JSON nor XML produces a complete killed-run verdict. | E/S, F2 |
| 3. Collection and identity | Collection imports code; default IDs mostly stable, custom IDs need not be. Collection errors normally stop execution. | E, F3 |
| 4. Config and options | Let pytest resolve config; keep a declared invocation boundary and explicitly handle selection/mutation flags. | E/S/D/I, F4 |
| 5. Parallelism | Batching amortizes startup; xdist preserves phase reports but changes collection and fixture/process semantics. | E/D/I, F5 |
| 6. Timeout and exit | Distinguish reported failures from interrupted/incomplete work; kill process groups. | E/S/I, F6 |
| 7. Plugin and filesystem edges | Normal async, unittest, Django and snapshot cases work; configuration can skip tests or mutate the tree. | E/D/I, F7 |

## Findings per question

### F1. Lifetime and cost

**E**, `warm-*.json`, `edges-*.json`: repeated `pytest.main()` after edits returned **0, 1, 1**, while matching fresh processes returned **0, 0, 0**. Application and explicitly loaded plugin modules retained old values. Non-package `conftest.py` refreshed, and its session fixture ran anew; a packaged conftest retained its old value. **S**, `_pytest/config/__init__.py:get_config,_importconftest,import_plugin`, `fixtures.py:FixtureDef.finish`: each call creates a new plugin manager, but registers modules from Python's cache; non-package conftest receives special cache deletion. Fixture cached values are cleared on finalization. Session scope is not a persistent-worker cache guarantee, and module globals are not reset. **D**, pytest 8.4.2 usage explicitly discourages repeated main calls because they “will not reflect changes to those files”.

**E**: forks after project/plugin imports inherited stale values. A clean server importing only pytest passed after both edits, taking 161–305 ms per fork/run, with plugin autoload disabled. This is not a like-for-like speedup over the full plugin fixture. Reload changed `app.VALUE`, but an earlier `from app import VALUE` stayed old and a removed name survived. **D**, Python 3.13 importlib/os docs confirm these reload limits and warn that fork with threads is unsafe (detectable warning since 3.12). **I**: pre-importing arbitrary project plugins cannot be treated as sound: imports may freeze environment, load project modules, or start threads/resources. A constrained clean fork server needs a separate compatibility contract; no general plugin-safe fork protocol was established.

**E**, five-sample medians in milliseconds, subprocess launch included:

| Operation | Python 3.10 | Python 3.13 |
|---|---:|---:|
| Interpreter `-c pass` | 65 | 62 |
| Interpreter + `import pytest` | 730 | 722 |
| `pytest --version --version`, autoload disabled | 872 | 730 |
| Same, installed plugins enabled | 1,473 | 1,206 |
| One fixture test, full process | 1,619 | 1,412 |
| Collect 20 files without bodies | 1,474 | 853 |

The trivial test's measured **call** was 0.24/0.19 ms, setup 1.32/1.12 ms. Plugin-enabled startup added roughly 0.48–0.60 s against disabled autoload. These are local costs on a busy 24-CPU host (initial load 18.5/21.1), not latency guarantees or a clean Python-version comparison.

### F2. Reports

**E**, `outcomes`: `pytest_runtest_logreport` supplies setup/call/teardown outcome and duration. A setup failure has no call; a successful call can still fail teardown. Skip is skipped setup; xfail is skipped call with `wasxfail`; non-strict xpass is passed call with `wasxfail`; strict xpass is failed call with textual `[XPASS(strict)]`, without `wasxfail` or a traceback crash object. `report.location` is the test/decorator's **zero-based** source line; `longrepr.reprcrash.lineno` is the failing helper/fixture's **one-based** line. Keep both, and tolerate string/tuple longrepr and absent traceback locations.

**E/S**, `outcomes`, `_pytest/junitxml.py`, `pytest_jsonreport/plugin.py`: JUnit XML summarizes testcase duration, collapses phases, and renders non-strict xpass like pass; default xunit2 omits the test's file/line attributes. JSON-report preserves per-stage details, node IDs, zero-based test line and xfailed/xpassed/error classification. Both normally write at session finish. SIGTERM/SIGKILL and timeout's thread method produced neither artifact. The flushed hook file retained start/setup events, without completion. Early usage errors produced no hook file. No transport can truthfully supply the missing outcome of a killed/hung call.

**I**: use dedicated JSONL outside captured stdout, with collection/error, phase and final-session records; supplement the four named hooks with collection inventory and test start/finish hooks. Aggregate phase failures before accepting a test result. A final marker, process termination and accounted-for selection must agree; exit zero alone is insufficient (`-p no:reporter` ran successfully with no events). A passed call before killed teardown is not a completed test/file. The exact file-completion rule belongs in the spec.

### F3. Collection and identity

**E**, `collect1/2`, `collect_sideeffect`: `--collect-only` emitted nested class and parameterized node IDs without executing bodies, but executed an import-time file write. It is executable discovery, not file-only enumeration for goal 4. The ordinary eight-item collection took 1.30/1.65 s including reports/startup. Prefer hook item IDs/locations to parsing terminal trees.

**E**: default object parameters became `value0`, `value1`; duplicate explicit `same` IDs became `same0`, `same1`; nested identity included `TestOuter::TestInner::test_nested`. These IDs stayed equal between runs without `-k`. Explicit `ids=repr` embedded changing addresses, and xdist rejected the differing worker collections. IDs based on position also cannot promise identity across parameter insertion/reordering (**I**). Rootdir participates in paths; preserve project identity and treat the remaining node ID as opaque.

**E**, `broken`, `broken_continue`, `module_skip`: a bad import produced a failed collect report with collector node ID and traceback; ordinary invocation exited **2** and ran no healthy tests. `--continue-on-collection-errors` ran the healthy file, retained the collection error and exited **1**. Module-level skip produced a skipped collector and exit **5**, without runtest reports. Thus a missing test report is neither a pass nor automatically a failing test; distinguish failed collection, skipped collection, deselection and interrupted execution.

### F4. Configuration and arguments

**D/S**, pytest 8.4.2 config docs and `config/findpaths.py`: discovery depends on cwd and supplied paths; at a candidate directory precedence is `pytest.ini` (even empty), `pyproject.toml` with `[tool.pytest.ini_options]`, `tox.ini` with `[pytest]`, then `setup.cfg` with `[tool:pytest]`. Configs never merge. `-c` selects the file and its default root; `--rootdir` alone does not select that config or change Python import paths. **E** confirmed precedence over tox/setup, empty ini winning, explicit `-c`, and a second monorepo package selecting its own config when run there. Combined invocation selected the outer config. `testpaths` supplied no-argument targets; `python_files` filtered traversal, but an explicitly named `odd_name.py` still ran.

**E/S**, `import_*`, `duplicate_*`, `_preparse`: `pythonpath` made a support module importable while editable `src` packages remained available. Prepend/append use `sys.path` insertion at the front/end; importlib uses path-based imports without that insertion. Equal unpackaged test basenames collided under prepend/append, but passed under importlib. Append also failed this nested unpackaged conftest fixture with `ImportPathMismatchError`. Preserve the project's mode, not an adapter-wide override.

**E**, option probes: `-x` stopped after the first failure; later `--maxfail=0` ran all eight tests. `--lf` selected the cached failures; disabling cacheprovider while retaining `--lf` exited 4. Clearing ini addopts with `-o addopts=` restored all tests, but left environment `PYTEST_ADDOPTS=-k test_pass` active. `-n 0` overrode `-n 2`, and `--no-cov` overrode `--cov` with these plugins installed. `-s` left the separate hook stream intact. **S**, `_preparse`: effective ordering is config addopts, environment addopts, explicit arguments, with plugin loading during parsing; blocking a plugin while retaining its options can make parsing fail.

**I**: declare project cwd/interpreter/intentional semantic arguments, ask pytest for resolved config in the execution environment, and stabilize that config/root across selected batches. Reading config alone misses plugin options/hooks, environment addopts and path-sensitive discovery. Asking pytest costs startup and executes plugin/conftest code; it cannot supply fresh-worktree keys without execution. A declaration alone can drift from the project's normal command. Preserve import/settings/fixture options and required plugins; explicitly remove or reject selection/early-stop, nested parallelism, coverage artifacts, snapshot updates and interactive debugger options, including their environment/config forms. Blanketing all addopts loses semantics such as `--ds`; accepting unknown plugin flags cannot guarantee whole-file execution. The supported argument boundary remains a spec decision.

### F5. Parallelism

**E**, 20 files × one 50-ms test, three-sample median seconds:

| Execution | Python 3.10 | Python 3.13 |
|---|---:|---:|
| One sequential batch | 2.64 | 2.33 |
| xdist, four workers | 3.53 | 3.96 |
| Twenty fresh processes, four at once | 7.43 | 6.83 |
| Four fresh five-file batches, four at once | 1.34 | 2.17 |

**E/D**, xdist 3.8.0: controller hooks received all 60 phases, including fixture errors and xfail flags in the outcome probe, but no ordinary controller collection inventory. Each worker collects independently; the extra xdist collection hook supplied worker IDs. Docs require identical ordered collections. **I**: independent processes give simpler failure attribution but repeat startup and session fixtures; batches amortize both while sharing globals/resources and delaying attribution of session teardown. xdist adds collection duplication and worker crash/restart semantics. Avoid automatically multiplying Squeal concurrency by inherited `-n`. These tiny tests do not settle the crossover for slow real suites or expensive session fixtures.

### F6. Deadlines and exits

**E/S**, all standard exit codes reproduced: **0** completed without failures (also all-skipped tests), **1** reported failures, **2** collection abort or KeyboardInterrupt, **3** internal hook error, **4** usage/config failure, **5** no collected tests. Plugins may supply other codes. Collection reports distinguish import failures from an interrupt even when both exit 2. **I**: preserve trustworthy reported failures and file errors; incomplete execution is unknown, not a passing or ordinary failing test. Internal/usage errors are runner problems. Exit 5 requires explaining empty selection or module skip rather than claiming validation.

**E**, hanging test with a spawned child: SIGINT produced interrupt/session-finish records and exit 2; SIGTERM/SIGKILL produced no session finish and signal exits. pytest-timeout's signal method produced a failed call and complete reports (exit 1); its thread method terminated the interpreter (exit 1) without teardown/final reports. In every parent-only termination/timeout case the child remained alive. A separate Linux process-group SIGTERM ended parent and child. **D**, timeout 2.4.0 documents hard-exit loss of teardown/XML. **I**: Squeal needs its own process-group deadline and kill escalation irrespective of plugin timeout settings. Escaped process groups, native-code hangs and non-Linux termination were not determined, because these probes cover normal inherited children on Linux only.

### F7. Sharp edges

**E**, `async_unittest`, `django_*`, `doctest`, `snapshot_*`, `writes`: marked asyncio and AnyIO tests (asyncio backend) plus unittest methods produced ordinary phases. Django with `--ds=django_settings` passed; missing settings **skipped**, still exit 0. Text doctests ran with node ID/location. Missing syrupy snapshot failed; `--snapshot-update` wrote it and passed; subsequent normal execution passed. `PYTHONDONTWRITEBYTECODE=1` produced no fixture `.pyc`; disabling cacheprovider did not prevent an explicit test write. These flags are not a filesystem sandbox.

**D**, asyncio 1.2.0 strict mode only owns explicitly marked tests/decorated async fixtures; auto mode takes ownership more broadly. Django 4.11.1 settings precedence is `--ds`, environment, config. **I**: retain these project semantics and distinguish skips from successful assertions; forbid automatic snapshot updates, and keep caches/report output away from watched inputs where possible. Data/snapshot/settings dependencies cross into the sibling graph/environment topics. Trio, real Django databases/migrations, custom doctest collectors and arbitrary plugin mutation were not determined, because the generic fixture does not exercise them.

## Recommendation for Squeal

**I**, from F1–F7: start with fresh processes and a small streaming reporter, running only selected files and amortizing startup with bounded batches where file completion is provable. Preserve pytest's config resolution and project plugin semantics behind an explicit supported invocation boundary. Treat incomplete streams as unknown. Keep xdist and warm/fork servers optional future investigations; neither is necessary to meet affected-file selection. This is evidence for the coordinator, not an interface or batching design.

## Open questions

- **Not determined, because assigned to `python-module-graph`:** file-only discovery/enumeration before a run; conftest/plugin/settings/snapshot closure and observed import attribution across batches.
- **Not determined, because assigned to `python-environments`:** interpreter discovery, installed-plugin fingerprint, editable-worktree identity and environment invalidation. The probe's editable installs demonstrate execution only.
- **Not determined, because policy belongs to the spec:** supported pytest/plugin versions, argument allow/reject rules, xpass mapping into existing outcomes, identity treatment for unstable parameter IDs, and completion of a file before shared session teardown. `RunnerAdapter` changes are not presumed.
- **Not determined, because not measured:** slow-suite parallel crossover, arbitrary plugin-safe fork, pytest 9+, other operating systems and descendants escaping process groups.

## Sources

- [Probe README and artifacts](probes/pytest-runner-api/README.md): `results-{3.10,3.13}.json`, `warm-*.json`, `edges-*.json`, `packages-*.txt`. [Fetched excerpts](probes/pytest-runner-api/sources.json), [installed-source excerpts](probes/pytest-runner-api/source-code.txt).
- pytest 8.4.2 official [usage](https://github.com/pytest-dev/pytest/blob/8.4.2/doc/en/how-to/usage.rst), [configuration](https://github.com/pytest-dev/pytest/blob/8.4.2/doc/en/reference/customize.rst), [hooks](https://github.com/pytest-dev/pytest/blob/8.4.2/src/_pytest/hookspec.py); installed `_pytest/{config/__init__.py,config/findpaths.py,pathlib.py,fixtures.py,junitxml.py}`. json-report 1.5.0 installed `pytest_jsonreport/{plugin.py,serialize.py}` from the pinned PyPI distribution; its attempted versioned README URL returned 404, so no finding relies on it.
- Python 3.13 official [reload](https://docs.python.org/3.13/library/importlib.html#importlib.reload) and [fork](https://docs.python.org/3.13/library/os.html#os.fork); docs fetched 2026-10-13.
- Pinned official docs: [xdist 3.8.0](https://github.com/pytest-dev/pytest-xdist/blob/v3.8.0/docs/how-it-works.rst), [timeout 2.4.0](https://github.com/pytest-dev/pytest-timeout/blob/2.4.0/README.rst), [asyncio 1.2.0](https://github.com/pytest-dev/pytest-asyncio/blob/v1.2.0/docs/concepts.rst), [django 4.11.1](https://github.com/pytest-dev/pytest-django/blob/v4.11.1/docs/configuring_django.rst), [syrupy 4.9.1](https://github.com/syrupy-project/syrupy/blob/v4.9.1/README.md).
