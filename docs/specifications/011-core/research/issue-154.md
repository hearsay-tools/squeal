# Explain group-request acceptance delays before changing priority

**Verdict: partial reproduction on 0.1.407.** A real isolated daemon produced
issue #154's pending-request deadline after a deliberately delayed startup.
The original docs-only incident, its 2,466 lint checks and its cause were not
reproduced. Preserve the no-verdict result; make the reason for delayed
acceptance observable before deciding whether priority must change.

## Questions and answers

The brief names one investigation. These questions separate its claims.
All source findings examine Squeal **0.1.407**, checkout
`073202425b43dff08117739a086d5395e08b5b8e`.

| Question | Answer and evidence tag |
| --- | --- |
| Q1. Can `run lint --wait 60000` expire before acceptance? | **verified by experiment, 0.1.407:** yes, with a deliberately delayed Vitest configuration. Exit 3 at 60,139 ms. This is a synthetic trigger on a real daemon. |
| Q2. Does the request survive the CLI deadline? | **verified by experiment, 0.1.407:** yes in this run. The same ID was pending after CLI exit and accepted after startup resumed. No second request was needed for acceptance. |
| Q3. What can delay acceptance, and does this output identify it? | **read in source code, 0.1.407:** acceptance awaits daemon startup, then the scheduler mutex. The pending response exposes neither blocker nor queue position. **verified by experiment, 0.1.407:** the output did not name the deliberately held startup. |
| Q4. Does this prove backlog priority or lint execution caused the incident? | **Not determined, because** the issue has no daemon timeline, revision, request-status trace or incident store. A running test tier does not itself hold the scheduler mutex for its whole run. |
| Q5. What contract applies? | **read in official docs (repository specifications), 0.1.407:** 019 D6 says a named group runs regardless of its moment and `--wait` waits for results. C15's detailed promotion/standing rules concern named test-file waits; they do not establish lint-request priority. |

## Experiment

Ran on Linux, Node **v24.22.1**, on 2026-11-06 at approximately 07:34–07:35
Europe/Warsaw. Initial host load was **0.55/24 CPUs**. The probe's own entry
check was **1.02/24**. Both permitted live work under the brief's load rule.

Exact commands (from this checkout):

```sh
gh issue view 154 --repo hearsay-tools/squeal --json title,body,comments,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
node docs/specifications/011-core/research/probes/issue-154/startup.mjs 60000
```

For the recorded run, stdout/stderr of the last command were redirected to
`/tmp/issue-154-probe.jsonl`; that temporary output is not a deliverable.
The committed probe contains every fixture creation and child command.
It executes `node plugins/claude-code/dist/cli/squeal.mjs` by absolute path,
with these arguments in the temporary repository:

1. `daemon <fixture-root>`; wait until the Vitest config enters its file gate.
2. `run lint --wait 60000`.
3. Socket `run-group-status` with the returned request ID; `status --json`.
4. Release the gate; poll that **same** request ID.
5. `run lint --wait 10000`; `stop <fixture-root>`.

The fixture has a separate Git common directory, store and `XDG_RUNTIME_DIR`.
It links existing dependencies, sets `baseline.onStart: "lookup-only"`, and
configures ESLint at Stop. Its one test is trivial. The async Vitest config
waits for a file under `.git`; this is the deliberate delay, not CPU load or
2,466 files of lint. No real project daemon was stopped or reconfigured.

**verified by experiment, 0.1.407:** selected observations:

```text
run lint --wait 60000: exit 3, 60139 ms, stderr empty
Group lint has no verdict: the deadline passed before the daemon took request
76e8ee32-5489-490c-8172-f246a4a2c894; the request is pending, and the daemon
 takes it once its current work allows

same ID before release: requested=null, unknown=false, error=null
status before release: revision=0, daemon.state=alive, testFilesListed=false,
  runsOpen=0, running test files=0, queued test files=0, lint.files=0
same ID after release: requested={revision:0,queued:0}, error=null

control run lint --wait 10000: exit 0, 229 ms
Group lint completed: no lint findings in 3 files
No lint checks of group lint to lint at revision 0: none is pending.

stop: exit 0, 191 ms; daemon process exit 0
```

The long output line is wrapped above for reading. The incident quoted slightly
different wording (“request remains pending”); this bundle uses “the request
is pending, and the daemon takes it once its current work allows”. The meaning
and exit code match. The retained request's `queued:0` is an acceptance result,
not evidence it never waited. The later control establishes a real lint verdict
for three fixture files. It says nothing about the incident head's lint result.

## Source evidence and contract

**read in source code, 0.1.407:**

- `src/core/daemon/run-group.ts:54–95`: `groupRequests.start()` records an ID,
  calls the handler without awaiting it, and returns `requested:null` until
  that promise resolves. CLI timeout does not cancel the request. Records are
  in memory and bounded by a maximum count; survival is not guaranteed across
  daemon exit or eviction.
- `src/core/daemon/daemon.ts:968–973`: `#requestGroup()` first executes
  `await this.#starting`, then calls the scheduler. This is the gate exercised.
- `src/core/scheduler/scheduler.ts:666–685`: `requestGroup()` takes `#lock`,
  releases pending lint paths and returns a count. It nudges the pass without
  waiting for lint execution. `mutex.ts` runs tasks “one at a time, in call
  order”. Batch reconciliation also takes that lock (`scheduler.ts:386`).
- `scheduler.ts:958–970` and its pump: selection and recording hold the lock;
  test execution and stability re-stat do not. An active tier alone therefore
  does not prove why a group request was not accepted.
- `src/cli/run-lint-group.ts:60–109`: the same deadline covers discovery,
  request and acceptance polling. The `late` branch says the request is pending
  and returns no verdict. `src/core/types/daemon.ts:294–302` carries only the
  group, ID, acceptance result, unknown flag and error, without a blocker.
  `test/cli/run-lint-group.test.ts:247–267` already covers this generic wording
  with a stand-in socket. That test was read, not run in this investigation.

**read in official docs (repository specifications), 0.1.407:** 011 C4 ties
validity to a check's key and defines scheduling; C6 requires honest incomplete
status; C9 separates a serving daemon from its startup work; C10 keeps policy
and capacity explicit. C15 describes reasons and bounds for pending selected
**test files**, not lint acceptance. 019 D1/D4 adds lint at pause/Stop; D6 says
“`--wait` waits for its results.” 017 D8 distinguishes lint findings, pending
state and Stop news. The 019 amendment for 019-45 matters when reading 017 D8's
older generic statement that Stop does not wait for an unstored lint result.

**inferred, 0.1.407:** the useful first decision is whether to expose the
acceptance blocker. Priority cannot bypass startup that has not produced a
scheduler. This experiment supports better evidence, not a blanket priority
change. Reporting no verdict remains correct when no result exists.

## Recommendation, limits and open questions

Treat #154 as a proven diagnostic gap with a partial symptom reproduction.
A request can be received while its scheduler acceptance is still blocked.
Keep those two facts distinct. The deciding tradeoff is actionable evidence
versus naming an active tier as the cause without proof. No product design,
implementation, policy change or removal of existing holds is authorized here.

The incident cause remains open: startup, reconciliation/mutex delay, another
blocked operation, or different runtime behavior. Obtain its daemon version,
phase/timeline, revision and request acceptance times before attributing it to
background-tier priority. This probe does not reproduce the 46.5-second Stop,
a docs edit re-keying 2,466 lint checks, or Cezar PR 2755's exact head. It does
not exercise Codex Stop, compare harness bundles, or run a full suite.

## Verification

`node --check docs/specifications/011-core/research/probes/issue-154/startup.mjs`
and `git diff --check` exited 0. The live probe exited 0.
The affected read used:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/probes/issue-154/startup.mjs
```

It exited 3 at revision 2: “No verdict: no test file's closure holds” the
probe path; “known failures 0; all 1471 test files current”. That is no automated
coverage of this throwaway script. The direct probe and syntax check are its
verification. No test suite was run or claimed as a new pass.

## Sources

- Issue fetched with `gh` above: <https://github.com/hearsay-tools/squeal/issues/154>.
- Version-pinned source tree (paths and lines above):
  <https://github.com/hearsay-tools/squeal/tree/073202425b43dff08117739a086d5395e08b5b8e/src>.
- Local specs: `docs/vision.md`; `docs/specifications/011-core/spec.md`
  C4/C6/C9/C10/C15 and `status.md`; `019-run-triggers/spec.md` D1/D4/D6 and
  `status.md`; `017-lint-checks/spec.md` D8 and `status.md`.
- Reproducible source: [probe README](probes/issue-154/README.md),
  [startup.mjs](probes/issue-154/startup.mjs). Runtime:
  `plugins/claude-code/dist/cli/squeal.mjs` in the pinned checkout.
