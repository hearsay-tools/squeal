# Wave 4.5 re-review: candidate 0.1.183

FAIL 6b43de6729a6705c3c4dfbb8bd3f20c302ff84a1

One proven blocker remains from wave 4 B1. B2 is repaired. S2 is resolved by suppressing a fresh start's ready note, as the status amendment requires. The original `left.json`/`right.json` reproduction now passes, but the replacement scrubber still merges meaningful names ending in digits. This candidate must not land on this review.

## Verification output

The reviewed HEAD was `6b43de6729a6705c3c4dfbb8bd3f20c302ff84a1`. The worktree stayed clean during checks and probes. Scope is the two repair commits, the unchanged pytest e2e file, and the rebase from `bd86815c` onto `ef4e5c78`. S1 stays with 007-42; the remainder of wave 4 was not re-reviewed.

```text
$ git rev-parse HEAD
6b43de6729a6705c3c4dfbb8bd3f20c302ff84a1
$ git status --porcelain
[no output]

$ npm ci
added 196 packages, and audited 197 packages in 21s
found 0 vulnerabilities
[exit 0; npm also listed six install scripts not covered by allowScripts]

$ npm run lint
> squeal@0.1.183 lint
> biome check .
Checked 1214 files in 1415ms. No fixes applied.
[exit 0]

$ npm run typecheck
> squeal@0.1.183 typecheck
> tsc --noEmit
[exit 0]

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
[not run: cancelled while queued for the host lock; no Vitest output]
[flock exited 143 after SIGTERM]
```

`npm run build` was not run, by explicit instruction; the candidate's committed bundles were left unchanged. Bundle regeneration and drift remain unverified by this reviewer. The independent full suite was not run. The coordinator explicitly directed cancellation while it was queued because the proven B1 collision already settled the verdict and the host was loaded. The queue was cancelled before Vitest started. Therefore there is no independent full-suite verdict, no key-pin test result, and no rebuilt-bundle pytest e2e result from this review. These are unverified, not additional findings. No Squeal checkpoint substitutes for them. Probes used helper-synced fixture environments outside the worktree, with `UV_LINK_MODE=hardlink`, Python 3.10 and 3.13 and pytest 9.1.1.

After the findings file was written, Squeal reported one unrelated background-baseline failure in `test/e2e/pi.test.ts`, "rpc: the agent's own edit failing after its run settled wakes it with the PASS -> FAIL, once": `timed out after 20000 ms waiting for the slow re-run to start` at `test/e2e/support.ts:43:13`. The baseline was still incomplete (380 test files pending). This is recorded as an out-of-scope observation, not investigated or counted as a finding against these repairs, and supplies no full-suite verdict.

## Blockers

### B1. Proven, blocker, still open: scrubbing treats semantic trailing digits as pytest counters

Location: `src/runners/pytest/run/basetemp.ts:44`, the replacement expression introduced by `87a86efc`, called by `run/report.ts` before failure fingerprinting.

The optional numbered component matches any first child ending in digits, including a direct file with no pytest-generated counter. Its lazy prefix consumes none of the trailing digit sequence, so `data1` and `data2` both become `data<n>`. This is the same lost-diagnostic and merged-fingerprint defect as wave 4 B1, narrowed to numeric names. It violates 007-41's outcome, "two different failures never share a fingerprint", and the vision's rule, "FAIL -> FAIL: quiet, unless the failure itself changed".

The original probe was rerun through `readEnvironment` and `runPytest`, using this unchanged file and changing only project `env.WHICH` between runs:

```python
import os

def test_missing(tmp_path_factory):
    open(tmp_path_factory.getbasetemp() / os.environ["WHICH"])
```

Both Python versions produced:

```text
WHICH=left.json
message: [Errno 2] No such file or directory: '<basetemp>/left.json'
fingerprint: FileNotFoundError: [Errno 2] No such file or directory: '<basetemp>/left.json' @ tests/test_tmp_collision.py:4:1
WHICH=right.json
message: [Errno 2] No such file or directory: '<basetemp>/right.json'
fingerprint: FileNotFoundError: [Errno 2] No such file or directory: '<basetemp>/right.json' @ tests/test_tmp_collision.py:4:1
WHICH=data1
message: [Errno 2] No such file or directory: '<basetemp>/data<n>'
fingerprint: FileNotFoundError: [Errno 2] No such file or directory: '<basetemp>/data<n>' @ tests/test_tmp_collision.py:4:1
WHICH=data2
message: [Errno 2] No such file or directory: '<basetemp>/data<n>'
fingerprint: FileNotFoundError: [Errno 2] No such file or directory: '<basetemp>/data<n>' @ tests/test_tmp_collision.py:4:1
```

Thus the required left/right check passes; the same check with two semantic numeric filenames fails. The probe also verified the basetemp scratch directory was empty after the runs. Existing added tests discriminate only non-numeric filenames; they cannot detect this remaining collision.

Fix for one worker: replace only positively identified generated counters, retaining direct child names and the complete user-supplied factory basename, including its digits. A textual trailing-digit heuristic cannot establish that provenance. Carry generated-directory information from the pytest runtime if needed. Add live regressions for direct `data1` versus `data2`, and factory basenames ending in digits, while keeping repeated and reordered `tmp_path` fingerprints stable and basetemp cleanup intact.

### Narrowest B1 repair and the cost of each option

**Record each test's actual `tmp_path`: smallest repair for 007-37's demonstrated stability requirement.** Observe the returned `tmp_path` fixture through pytest's fixture hook, retain its resolved value with the node ID, and add that mapping to the event stream before it can be lost during teardown or a later crash. Scrub only that exact path, at a path boundary, plus the run's basetemp prefix. Then a real `tmp_path` can use a stable token while `getbasetemp()/data1` and `/data2` retain their full names. The mapping must survive setup/call/teardown reporting; do not force fixture creation just to collect it.

Cost: a fixture hook and small per-item metadata in the existing Python event stream, plus event/report plumbing and regressions across both supported pytest majors. Space and output grow with tests that actually request the fixture. No new process or dependency is needed; overhead has not been measured. This does not normalise arbitrary `tmp_path_factory.mktemp` calls, session fixtures' factory directories, or legacy `tmpdir` unless separately recorded. Choosing it therefore narrows the current factory-counter promise. If that narrower promise is accepted, this is my preferred minimum: leave unknown paths intact rather than guess.

**Record only numbered directories pytest actually creates: smallest repair that keeps the full current factory promise.** Observe `TempPathFactory.mktemp` calls and record the resolved returned directory, the exact requested basename, and `numbered`. Replace a recorded `numbered=True` directory by `<basetemp>/<requested-basename><n>`; keep `numbered=False` names unchanged. Retaining the requested basename is essential: `mktemp("data1")` can return `data10`, whose semantic `1` must survive while only the appended counter is removed. Do not infer provenance from digits or filesystem presence. Preserve path boundaries and apply specific directory mappings before the broader basetemp prefix.

Cost: more invasive runtime instrumentation around factory creation, including calls from other fixtures, with lifecycle cleanup and compatibility tests on pytest 8 and 9. There is no dedicated hook for every `mktemp` call in the current runtime, so wrapping the factory method needs explicit ownership and restoration. Metadata grows with created numbered directories, rather than just tests using `tmp_path`; no new process or dependency is needed, and overhead is unmeasured. It covers the ordinary `tmp_path` fixture as well as explicit factory use, while leaving direct filenames alone. I recommend this option if 007-41 retains its existing promise to normalise factory counters. The two options need not be built together.

## Should-fix

None added. Wave 4 S1 remains assigned to 007-42 and outside this re-review.

## Nits

None.

## What fits

### B2. PASS: the latest note of the topic controls replacement

`986e9c25` carries `latestNote(topic)` from `daemon.ts`, through `createPytestRunners`, into the adapter. The daemon reads the latest-per-topic status view and matches the topic exactly. An unrelated untagged note no longer suppresses a tagged replacement.

The reviewer's mixed-version probe was rerun on both Python versions through a real adapter and `appendNote`/`readDaemonNotes` over an in-memory meta backing:

1. Seed the legacy untagged ready note.
2. Move `.venv` aside and start the adapter. Its latest `pytest-environment:small` note says no environment.
3. Restore `.venv` and invalidate `.venv/pyvenv.cfg` as an add. The latest tagged note says ready; the missing note leaves the listed view.
4. Append a tagged missing note with the environment already restored, simulating sync while the daemon was down. A new adapter start replaces it with ready despite the legacy untagged ready note.
5. Restart once more. The stored history of that topic is unchanged.

```text
Python 3.10 and 3.13:
B2 live missing->ready:
  [untagged] pytest project "small": its Python environment is ready
  [pytest-environment:small] pytest project "small": its Python environment is ready
B2 startup replacement and unchanged restart: PASS
```

The legacy ready record remains historical; it no longer decides the topic's state. The added regression tests use the real SQLite store, as read in source; they were not executed in this review. The live review probe independently exercised both the transition and startup paths.

### S2. PASS by runtime probe; unchanged rebuilt-bundle e2e unverified

The repair implements the recorded alternative to changing the e2e assertion: at start, a ready environment emits a note only when its topic already has a stored note to replace. The probe started the ready adapter with an empty note store on both Python versions and found no ready note and no environment topic. `test/e2e/pytest.test.ts` is byte-for-byte unchanged from `bd86815c` (`git diff --exit-code bd86815c 6b43de67 -- test/e2e/pytest.test.ts` exits 0).

The startup behavior therefore satisfies the status amendment in the live probe. The unchanged e2e file was not executed: the coordinator cancelled the queued independent run after B1 settled FAIL. Its four harness/Python transition-and-inheritance scenarios remain unverified by this re-review.

### Rebase comparison: no original implementation patch lost

```text
$ git range-diff cffbb8af..bd86815c ef4e5c78..6b43de67
3e931a4a -> 2c883cbb  007-37 basetemp
41e9a9b6 -> f47754ed  pytest[].batchSize
5549816c -> 4b8ccaf6  environment install guidance
1a70fbc0 -> a374155f  environment admission
85aa5c21 -> c0e2f737  note topics
e4871cd6 -> c4aaadf9  startup replacement
```

For each of those six pairs, the range-diff shows only the added cherry-pick trailer; `git show --pretty=format: <commit> --` also gives byte-identical patches. The two repair commits follow them. The old status amendment commit is picked again as `6d665708`; main already holds the review-triage amendment, which records S2's different resolution. The old review brief and host-policy docs are inherited unchanged. Key format remains 10, intentionally re-pinned by `fa6c2294`; the old build is replaced by `6b43de67`, with version 0.1.183 and rebuilt bundles atop main's changes. No additional source/test delta appears after the six picks except the two repairs and that key pin. The key-pin test and bundle regeneration remain unverified here.

## Inputs for the coordinator

1. B1 remains a proven blocker in the repaired candidate. This is the second FAIL, so process step 6 sends the decision to the human. Do not land `6b43de67` on this review.
2. For B1, choose the exact-`tmp_path` minimum only with the stated factory-scope reduction; otherwise record generated factory directories and their requested basenames. Keep B2's exact topic lookup and startup-only replacement behavior. B2 and S2 do not need another architectural review if those paths stay unchanged.
3. Preserve the unchanged pytest e2e expectations. The full suite and this file still need execution for a future repaired candidate, under the host's locked, four-worker gate. Build/drift remains the coordinator's check.
4. Keep the live `norecursedirs` repair in 007-42; it was not reopened here.
