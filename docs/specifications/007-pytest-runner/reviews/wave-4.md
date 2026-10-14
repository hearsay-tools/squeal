# Wave 4 review: candidate 0.1.181

FAIL bd86815c75dd9a95a90b3be1bdcab0bcd9377906

Two proven blockers in the candidate, two proven should-fix findings, one in the landed 0.1.178 range, no plausible findings or nits. The candidate should not land until B1 and B2 are repaired. S1 becomes a repair row and does not block this candidate, as the brief requires.

## Verification output

Reviewed HEAD was `bd86815c75dd9a95a90b3be1bdcab0bcd9377906`; the tree was clean throughout the checks and throwaway probes. `cand/0.1.181` was not a local ref, so the supplied SHA identifies the candidate. `origin/main` had advanced to `71fe87f9`; its common ancestor with the candidate is `cffbb8af970bb8f2559d2706d173433e21c7d4bb`. The candidate range reviewed is therefore `cffbb8af..bd86815c`. The separate landed range is `c84f3720^..a2904a98`.

```text
$ git rev-parse HEAD
bd86815c75dd9a95a90b3be1bdcab0bcd9377906
$ git status --porcelain
[no output]

$ npm ci
added 196 packages, and audited 197 packages in 11s
found 0 vulnerabilities
[exit 0; npm also listed six install scripts not covered by allowScripts]

$ npm run lint
> squeal@0.1.181 lint
> biome check .
Checked 1183 files in 522ms. No fixes applied.
[exit 0]

$ npm run typecheck
> squeal@0.1.181 typecheck
> tsc --noEmit
[exit 0]

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Test Files  1 failed | 563 passed | 1 skipped (565)
     Tests  4 failed | 4747 passed | 10 skipped (4761)
  Duration  859.43s
[exit 1; all four failures are test/e2e/pytest.test.ts:202]
```

The only independent full-run failures were the four startup-note expectations described in S2. All other loaded test files passed. Before this run completed, Squeal's background baseline also observed `test/integration/pytest.test.ts:198` and a `test/policy/repository-inputs.test.ts` hook timeout; its own reruns recovered both at unchanged inputs, and both files passed this independent gate. Those observations are not findings against the wave.

The four failing cases were then run alone in their file, with the other four cases excluded by the name filter. They failed at the same assertion, so S2 is not attributed to host load:

```text
$ npx vitest run test/e2e/pytest.test.ts --maxWorkers=4 -t 'seeds both projects and delivers their transitions'
Test Files  1 failed (1)
     Tests  4 failed | 4 skipped (8)
  Duration  53.50s
[exit 1; the same four test/e2e/pytest.test.ts:202 failures]
```

The independent full run follows the brief's host policy; Squeal's cached results do not substitute for it. `npm run build` was not run, by explicit instruction. Bundle regeneration and drift remain unverified by this reviewer. The probes below lived outside the worktree and were removed. Their Python environment came from `test/helpers/pytest-env.ts` with `UV_LINK_MODE=hardlink`.

## Blockers

### B1. Proven, blocker: basetemp scrubbing removes meaningful filenames

Location: `src/runners/pytest/run/basetemp.ts:39`, used by `src/runners/pytest/run/report.ts:174` before the core fingerprints the error.

`split(basetemp + "/")` followed by the first-component replacement assumes every child is a disposable fixture directory. A direct child can instead be the actual missing filename. This loses both the diagnostic and the distinction between two failures. It breaks the vision's "FAIL -> FAIL: quiet, unless the failure itself changed" rule and the review brief's explicit requirement to check that 007-37 does not merge different failures.

Live reproduction on the synced small fixture, Python 3.13 and pytest 9.1.1:

```python
import os

def test_missing(tmp_path_factory):
    open(tmp_path_factory.getbasetemp() / os.environ["WHICH"])
```

Run the same file through `runPytest` twice with project `env.WHICH` set to `left.json`, then `right.json`. Each is a genuinely different missing file, at the same source location. Both returned:

```text
message: [Errno 2] No such file or directory: '<tmp_path>'
fingerprint: FileNotFoundError: [Errno 2] No such file or directory: '<tmp_path>' @ tests/test_tmp_collision.py:3:1
```

The same problem also collapses different user-selected `tmp_path_factory.mktemp` directory names; the direct-file case establishes that this is more than removing pytest's counter. Existing tests cover one `tmp_path`, repeated runs and reordered twin tests, but never different semantic children of the basetemp.

Fix for one worker: replace the volatile run/batch prefix without discarding arbitrary child filenames. Limit any additional normalization to pytest-generated fixture names and their changing counters, preserving meaningful factory name prefixes and remaining path components. Add a regression for `getbasetemp()/left.json` versus `getbasetemp()/right.json`, alongside the current repeat/reorder stability test and cleanup assertion. The different filenames must remain visible and produce different fingerprints.

### B2. Proven, blocker: an old untagged ready note suppresses the new topic replacement

Location: `src/runners/pytest/adapter.ts:124`; the text-only predicate is wired in `src/core/daemon/daemon.ts:432` through `persistedNoteTexts`.

The new dedupe asks whether *any* currently listed note has the ready text. An untagged note from 0.1.178 qualifies, even when the latest note of `pytest-environment:<project>` says the environment is missing. The callback then skips writing the replacement and sets `told`, so later calls also skip it. The environment works while status keeps its new, tagged "no Python environment" note.

This breaks 007-39's done-when, "status drops the no-environment note once the environment is ready", 001 D7's latest-note-per-topic contract, and condition 3 of 001's topic agreement: a topic match must not silently drop the replacing note. It differs from the accepted deviation for an old *untagged missing* note: here the missing note has the new topic and should be replaced.

Reproduction used `appendNote` and `readDaemonNotes` with an in-memory `meta` backing, plus a real adapter and a helper-synced Python 3.13 environment:

1. Seed the legacy untagged text `pytest project "small": its Python environment is ready`.
2. Move `.venv` aside and create the adapter with the daemon's `noted` behavior. It writes a missing note with topic `pytest-environment:small`.
3. Restore `.venv` and call `invalidate([{path: ".venv/pyvenv.cfg", kind: "add"}])`.

Observed output:

```text
runnerVersion after sync: 9.1.1
listed notes after sync:
  [untagged] pytest project "small": its Python environment is ready
  [pytest-environment:small] pytest project "small": no Python environment ... Its checks stay unknown until then.
```

A restart also encounters the legacy ready text and skips the same replacement. The new note tests seed only a tagged missing note and omit this mixed-version history.

Fix for one worker: scope dedupe to the latest note of the same topic, rather than every text returned by `persistedNoteTexts`. Carry that topic through the daemon callback, or return the current note of a topic. Add a regression seeded with the legacy untagged ready note, then exercise missing-to-ready and startup-ready replacement. Keep the legacy note as history, but the latest tagged note must say ready; an unchanged subsequent restart should add nothing.

## Should-fix

### S1. Proven, should-fix: a live norecursedirs edit does not update the file list

Location: `src/runners/pytest/adapter.ts:217`, at the listing seam used by landed row 007-35; `src/runners/pytest/adapter-files.ts:51` reads `norecursedirs` only when called.

With `include = ["tests/**/test_*.py"]`, start with default `norecursedirs` and `tests/build/test_a.py`. Change the existing `pytest.ini` to allow that directory:

```ini
[pytest]
norecursedirs =
```

Invalidate `pytest.ini` with kind `change`. The adapter lists files only on an add/delete or when its graph is absent, so the configured file remains invisible. Changing the rule back likewise leaves previously admitted files listed. This is a coverage gap against 007-35's outcome, "a test file that include and pytest's norecursedirs allow is listed and run", and D5's configuration invalidation behavior.

The adapter probe returned:

```text
listing initially: []
invalidate pytest.ini change: { recreatedProjects: [] }
listing after config change: []
listing after restart: [{ project: 'small', path: 'tests/build/test_a.py' }]
```

A second probe with a ready Python 3.13 environment also kept the build test listed after an existing config changed from allowing it to disallowing it. The landed test reopens the adapter after changing the config, which bypasses this failure. The candidate does not worsen the landed behavior, so this finding does not block it.

Fix for one worker: relist on changes that can alter the recursion settings, including a change to the existing pytest config, and propagate additions/removals through the graph and scheduler. Add an adapter regression that changes `norecursedirs` in both directions on one live adapter. Preserve the no-environment case, where a config edit still changes what will be validated once a sync finishes.

### S2. Proven, should-fix: the pytest e2e startup-note assertion predates the ready notes

Location: `test/e2e/pytest.test.ts:202`, reached after `src/runners/pytest/adapter.ts:197` emits the new ready note for each project.

The e2e asserts that the complete startup note list is exactly `[COMPUTED_NOTE]`. Candidate commit `e4871cd6` intentionally adds ready notes for both pytest projects, so the assertion fails for Claude Code and Codex under both tested Python versions. This is an expectation that needs to track the accepted startup behavior; it is not a third runtime defect. It stops each case before its transition and inheritance checks, leaving those later assertions unexercised by this run.

```text
expected [ …(3) ] to deeply equal [ Array(1) ]
+ "pytest project \"python/small\": its Python environment is ready"
+ "pytest project \"python/billing\": its Python environment is ready"
```

Fix for one worker: assert the incomplete-closure note and both project-specific ready notes, including their topics, then let all four e2e variants reach the remaining behavior checks. Keep unexpected startup diagnostics visible to the test; do not simply remove the note assertion.

## Nits

None.

## What fits

- Topics are documented as `<owner>:<subject>`. The raw store retains replaced notes, capped at three per topic, while `readDaemonNotes` exposes only the latest. The spec and status amendments ship together with the core change. A probe that started with 20 unrelated notes and toggled one topic ten times retained 17 unrelated notes and three topic records. The parent clarified that these three occupied slots are intentional; churn beyond them must not consume more. This is not a finding.
- Normal tagged missing-to-ready and ready-to-missing transitions are covered. Startup emits a ready replacement for an earlier tagged missing note; unchanged startup dedupes it. B2 is the mixed-version gap in that path.
- 007-39 validates a positive integer `pytest[].batchSize` and passes it to the adapter, retaining the default of five when absent. Admission polls missing pytest before its quiet-second check and keeps the 20-second bound; the existing moving-environment refusal remains. Lockfile, requirements-file and no-lockfile guidance have targeted tests. The accepted checkpoint deviation is recorded in `status.md`.
- 007-37 puts each batch's basetemp under the run's scratch space and removes it in the run's `finally`. The existing live regression covers an unchanged failure across two runs and a different batch order. B1 concerns lost diagnostic content, not isolation or cleanup.
- 007-36 links parent test packages through the conftest/module that needs them and attributes library-mediated startup imports to the nearest project frame. `observeBatch` follows those edges from each test and its ancestor conftests, while true startup-plugin imports retain the session path. The added tests cover nested conftest selection, library-mediated imports, startup-plugin observation and the closed events file. No missing dependency caused by this attribution change was proven. The recorded 200-file baseline measurement was read, not rerun.
- 007-38 removes versions only for distributions whose `direct_url.json` names an editable inside the real worktree boundary. Other distribution entry names retain their versions; the tests discriminate an editable SCM version change from a third-party version change and a similarly named distribution. No sharing across a real third-party version change was proven in this range. D2 deliberately accepts ignoring the editable distribution's own version.
- Initial discovery honors configured `norecursedirs`, lists the repaired `build` and `venv` examples when allowed, and names skipped matching directories in its note. S1 covers the missing live update.

## Inputs for the repair wave

1. Repair B1 in `run/basetemp.ts` and its report/run tests. Preserve semantic filenames while keeping repeated and reordered `tmp_path` failures stable; keep basetemp cleanup.
2. Repair B2 across the adapter's topic-aware dedupe and the daemon's callback. Agree any callback type change at that seam; prove legacy untagged history cannot suppress a new topic state.
3. Schedule S1 against the landed listing/config invalidation seam. Test one adapter through allow, disallow and re-allow, rather than reopening it between edits.
4. Update S2's e2e startup expectations and rerun that file for both harnesses and Pythons, so the rest of the proof executes.
5. Keep the host's `flock` and `--maxWorkers=4` for the next independent full gate. Build and bundle drift remain the coordinator's check. Scope the re-review to these findings and the repair delta.
