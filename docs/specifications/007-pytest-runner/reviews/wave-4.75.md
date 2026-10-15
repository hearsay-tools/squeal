# Wave 4.75 re-review: candidate 0.1.190

PASS 1bedfc23cb5ee4584246d6f103c54086d6235f2f

Zero blockers, should-fix findings or nits within this re-review's scope. Wave 4.5 B1 is closed under the human's option (d), and the rebase preserves the picked changes and daemon wiring. B2, S2 and the rest of wave 4 remain settled by the prior review; they were not re-prosecuted.

## Verification output

The reviewed HEAD was `1bedfc23cb5ee4584246d6f103c54086d6235f2f`. Checks and probes ran before creating this findings file, with a clean worktree. Only this file is committed afterward.

```text
$ git rev-parse HEAD
1bedfc23cb5ee4584246d6f103c54086d6235f2f
$ git status --porcelain
[no output]

$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
[exit 0; npm also listed six install scripts not covered by allowScripts]

$ npm run lint
> squeal@0.1.190 lint
> biome check .
Checked 1250 files in 557ms. No fixes applied.
[exit 0]

$ npm run typecheck
> squeal@0.1.190 typecheck
> tsc --noEmit
[exit 0]

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  602 passed | 1 skipped (603)
      Tests  4970 passed | 9 skipped (4979)
   Start at  09:11:43
   Duration  659.19s (tests 98%, import 2%)
[exit 0]
```

The independent full run reported no failing tests, so there are no failing-test names or isolated rerun results to list. No isolated rerun was needed or performed. By the coordinator's instruction, this locked run also serves as the landing gate.

`npm run build` was not run, by explicit instruction. Regeneration and bundle drift are unverified by this reviewer and remain the coordinator's check. The four committed copies of `dist/pytest/squeal_pytest.py` are byte-identical to the source runtime, including its new `name` field. No Squeal checkpoint substitutes for the independent full run above.

The background Squeal baseline separately reported a failure in `test/integration/pi-events.test.ts:123`, "print: news after the last tool call continues the run once, then silence": `expected '' to contain 'PASS -> FAIL'`. Its `why` output identifies a clean candidate run at revision 0. It then recovered under the same inputs (PASS inherited from the coordinator's clean `1bedfc23` tree), and Squeal labeled it flaky. This Pi integration case is outside the repair and shared-file rebase scope; it is recorded as an observation, not a finding against these changes or a substitute for the independent run.

## Blockers

None.

## Should-fix

None added.

## Nits

None.

## What fits

### B1. PASS: only the failing test's own folder counter is replaced

Locations: `src/runners/pytest/run/basetemp.ts:44`, `run/report.ts:124`, `run/events.ts:39`, and `runtime/squeal_pytest.py:280`.

`df8f2d84` satisfies the human's choice recorded in `status.md`: derive the failing item's folder using pytest's Unicode-aware replacement and 30-code-point cut, then replace only its appended decimal counter at a path boundary. Other children retain their names. The runtime carries `item.name` in `collected`, and `joinPhases` passes that field to the scrubber, so a parameter ID containing `::` does not corrupt the folder name. Collection errors have no item name and receive only the basetemp-prefix replacement. These seams were checked in source.

An independent throwaway probe used `syncFixture`, `readEnvironment`, `runPytest`, and `describeFailure` outside the worktree. Environments used the helper's isolated uv settings and hardlinked packages. The probe exited 0 on Python 3.10.20 and 3.13.14, both with pytest 9.1.1. It removed its fixture copies and scratch directories.

The prior reproduction ran this unchanged source, varying only project `env.WHICH`:

```python
import os

def test_missing(tmp_path_factory):
    open(tmp_path_factory.getbasetemp() / os.environ["WHICH"])
```

Both Pythons produced these fingerprints:

```text
data1: FileNotFoundError: [Errno 2] No such file or directory: '<basetemp>/data1' @ tests/test_tmp_collision.py:4:1
data2: FileNotFoundError: [Errno 2] No such file or directory: '<basetemp>/data2' @ tests/test_tmp_collision.py:4:1
left.json: FileNotFoundError: [Errno 2] No such file or directory: '<basetemp>/left.json' @ tests/test_tmp_collision.py:4:1
right.json: FileNotFoundError: [Errno 2] No such file or directory: '<basetemp>/right.json' @ tests/test_tmp_collision.py:4:1
```

Each pair has distinct fingerprints. For comparison, the original scrubber extracted from `6b43de67` still maps `/s/base/data1` and `/s/base/data2` to the same `<basetemp>/data<n>`; that collision is absent in the live candidate runs.

For stability, each source failed by opening `tmp_path / "missing.txt"`. The probe compared two single-file runs and a third run with a twin file first, forcing pytest's folder counter from 0 to 1. All three fingerprints matched for every row on both Pythons:

| Item | Stable path in failure message |
| --- | --- |
| `test_reads` | `<basetemp>/test_reads<n>/missing.txt` |
| `test_reads1` | `<basetemp>/test_reads1<n>/missing.txt` |
| `test_x[a-1]` | `<basetemp>/test_x_a_1_<n>/missing.txt` |
| `test_reads_a_name_well_past_thirty_characters_2` | `<basetemp>/test_reads_a_name_well_past_th<n>/missing.txt` |
| `test_x[a::b]` | `<basetemp>/test_x_a__b_<n>/missing.txt` |

A Unicode-named parametrized test also stayed stable. The probe required each failure message to contain no cache-directory prefix and the `basetemp-runs` directory to be empty after all runs. Both checks passed on both Pythons.

The accepted residual is unchanged: a test that deliberately names a direct basetemp child exactly like its own generated folder plus digits can still have those digits scrubbed. For example, direct `test_reads0` and `test_reads1` under `test_reads` both become `<basetemp>/test_reads<n>`. This follows from the chosen expression; it was not tested, as the brief directs. A factory folder with another basename keeps its counter. Neither is a new blocker under option (d).

### Rebase. PASS: picked edits and the shared daemon seams are preserved

```text
$ git range-diff ef4e5c78..6b43de67 origin/main..1bedfc23
2c883cbb -> 6ab1c949  007-37 basetemp
f47754ed -> 68ae7971  pytest[].batchSize
4b8ccaf6 -> ba5826eb  install guidance
a374155f -> 856cc303  environment admission
c0e2f737 -> d74ed605  note topics
c4aaadf9 -> 0ad70d4e  startup replacement
6d665708 -> c21d0691  status amendments (range-diff pairs these as removed/added)
87a86efc -> 196bccba  first scrubber repair
986e9c25 -> 06a56850  topic lookup and startup suppression
```

`origin/main` resolved to `24a3f96a8e97c4534c99bb218616a56ea8c14e65`, the re-review brief atop main 0.1.187. For all nine pairs, extraction of each patch's added and removed lines gives identical ordered lists. Five complete patches are byte-identical; the note patches and status amendment differ only in hunk positions/context. Range-diff also shows the new cherry-pick trailers. No picked edit was changed or lost. The old key pin and build were intentionally replaced by `7d9c1ae0` and `1bedfc23`; `df8f2d84` is the additional repair reviewed above.

The final two-way comparisons provide the seam check:

- Against main, `src/core/daemon/daemon.ts` adds only the notes import, topic forwarding, exact `latestNote(topic)` lookup, and optional topic in `#note`. `src/core/types/scheduler.ts` adds only `DaemonNote.topic`.
- Against `6b43de67`, those files add main's repository-root/pool-capacity correction and retry wiring, including `requestRetries`; the note wiring is unchanged.
- The final `createPytestRunners` call passes `note(text, topic)` to `#note(text, undefined, undefined, topic)` and `latestNote(topic)` reads `readDaemonNotes(store, worktreeId).findLast(n => n.topic === topic)?.text`. `pytest-runners.ts` forwards both to the adapter. Main's pool and retry additions remain alongside this path.

## Inputs for the coordinator

1. B1 and the rebase pass at exactly `1bedfc23cb5ee4584246d6f103c54086d6235f2f`. This review introduces no repair row.
2. Keep the human's option (d) scope: test-derived folder counters only, with the direct matching-name residual explicitly accepted. No factory instrumentation is required by this decision.
3. Build/drift stays with the coordinator because this review was explicitly instructed not to build. B2, S2 and live `norecursedirs` row 007-42 are not reopened.
