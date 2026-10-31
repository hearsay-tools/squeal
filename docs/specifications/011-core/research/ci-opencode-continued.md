# Diagnose the first idle before choosing a CI repair

Row 011-284, wave 63 R2. Examined 2026-10-31. **Verdict:** the failed assertion waits for the first continuation, before the recovery edit. A missed 500 ms idle deadline can reproduce it. A real transition-loss window after the delivery commit is also proven. The failed CI log cannot distinguish these paths, so its exact cause remains **not determined**. Increasing the 30 s assertion timeout is not an evidence-backed repair.

Versions: failed CI `6ceaf9b85abac7d2410b201042e22654f31f7f6e`; local `33cdf29a1bf59087f11deb6b5ef4220f075f599a` (Squeal 0.1.384), Node 24.22.1, Vitest 5.0.3, OpenCode 1.18.35. `git diff 6ceaf9b85 HEAD` is empty for the continued test, its OpenCode helpers/provider, `src/harness/opencode/`, shared Stop, delivery implementation and default policy used below. All source findings below apply to both commits; experiments ran on the local commit.

## Questions and answers

| Question from R2 | Answer | Tag and version |
| --- | --- | --- |
| 1. Which wait failed, and what ran long? | Line 90's 30,000 ms poll saw one planned model request instead of two. The first reply had finished. No timestamp identifies a slow internal step. | **verified by experiment**: recorded CI execution, `6ceaf9b85`, Node 24.22.1 / Vitest 5.0.3 |
| 2. Is this a test timing bound or a missed notice? | Exact CI cause not determined: the log lacks idle, bridge and prompt timestamps. The 500 ms product deadline is a plausible trigger. Forced delays prove both a deferred notice and a consumed-but-unreceived transition. | **inferred** for CI; **verified by experiment** for probes, `33cdf29a1`, OpenCode 1.18.35 |
| 3. What is the smallest repair? | First preserve failure diagnostics in the fixture. Do not change timeouts or infer a test-only flake. For the proven loss window, retain the owed report across bridge failure; its storage/acknowledgement rule needs a separate coordinator decision. | **inferred**, from both source revisions and the probes |
| 4. What test proves it? | Hold Stop before its handler, then after its delivery commit. Both miss the same deadline. Assert the next user prompt receives the transition exactly once in both cases. The second currently does not. | **verified by experiment** for current behavior; **inferred** repair criterion, `33cdf29a1` |

## 1. What CI actually records

**verified by experiment**, CI execution at `6ceaf9b85`. The fetched [job log][ci] reports:

| UTC timestamp, 2026-10-31 | Recorded fact |
| --- | --- |
| 09:50:37.2459438 | Node `v24.22.1` |
| 09:50:57.6512168 | Vitest `v5.0.3` starts |
| 10:14:43.9717981 | File completes: two tests, one failed, 49,692 ms |
| 10:14:43.9747179 | First case: failed, 38,917 ms |
| 10:14:43.9748523 | Aborted-continuation case: passed, 9,126 ms |
| 10:25:02.7274264 | End-of-suite failure stack points to `opencode-continued.test.ts:90:85` |
| 10:25:02.7312182 | Cause: `Matcher did not succeed in time.` |

These are reporter timestamps, not the start/end times of the poll or bridge. Subtracting 30 s from the 38.917 s case leaves 8.917 s for all other work and scheduling, not one identified slow step. The later stack timestamp is not a second execution. The [preserved excerpt](probes/ci-opencode-continued/ci-excerpt.txt) retains the surrounding lines.

**read in source code**, both revisions, `test/harness/opencode-continued.test.ts:90` and `test/helpers/opencode.ts:219`. The poll runs inside `afterReply`, after the first HTTP message response. `r.queue("k2")`, `r.apply(r.pass())`, releasing the continuation, the 4 s quiet period and the final prompt all come later. Thus this failure says nothing about recovery delivery or whether a continued idle remained silent. The fixture writes the failure into a seeded store; it waits for no actual Vitest rerun.

## 2. The shorter deadline and two distinct outcomes

**read in source code**, both revisions. The first case leaves `stop.waitMs` at its default zero (`src/core/types/policy.ts:337`). `hooks.ts:126` gives idle `stop.waitMs + 500 ms` for lookup, Stop and `promptAsync`. `callBridge` kills the bridge group at that deadline and returns `null` (`bridge-client.ts:124`). Spec 008 D4 explicitly requires silence on a deadline miss. The second, passing test sets `stop.waitMs: 1500`, so its idle budget is 2 s. This difference supports a hypothesis, not a diagnosis of the failed job.

**verified by experiment**, `33cdf29a1`, Node 24.22.1 / OpenCode 1.18.35. The [throwaway probe](probes/ci-opencode-continued/README.md) wraps private built files in `/tmp`. It adds an asynchronous 700 ms delay, never CPU load. It keeps the default policy and the original 30 s poll.

| Case | First idle duration | Outcome at the poll | Next user prompt |
| --- | --- | --- | --- |
| No delay | 71 ms; second request seen at +205 ms | Two requests | Continuation contains `PASS -> FAIL` |
| Delay before Stop handler | 502 ms | One request after 30,006 ms; view `pass`, state `fail`; idle with no waited-for files | Receives `PASS -> FAIL` |
| Delay after handler, before stdout | 502 ms | One request after 30,002 ms; view `fail`, state `fail`; still `in-turn` | Does **not** receive `PASS -> FAIL` |

For the third case, exact UTC marks are 13:58:26.242 idle entry, 13:58:26.301 report prepared, 13:58:26.744 idle return, and 13:58:56.246 poll expiry. No `promptAsync` call occurred. The prepared report contains the missing transition. See [local-results.txt](probes/ci-opencode-continued/local-results.txt).

**read in source code**, both revisions. The loss path is:

`turns.idle` → bridge `stop` → `stopTurn` → `newsText` → `delivery.onToolBoundary` → transaction writes the consumer view → bridge stdout → `callBridge` → `say`.

`delivery.ts:260` advances the view before the bridge writes its answer. A kill in that gap leaves the committed view. `turns.ts:281` receives no report, so `say` never holds it in `turn.held`. It arms the idle waiter; the stored turn remains `in-turn`, where idle delivery is silent (`delivery.ts:223`). A later prompt compares the failing state with the already failing view and has no transition to send. This proves transition loss under the injected condition, not loss of the underlying stored failure or this condition in CI.

**inferred**, both revisions. A pre-handler miss is sufficient to reproduce the CI assertion while preserving the transition. A post-commit miss produces the identical assertion while losing it. Therefore a larger poll timeout or an isolated green rerun cannot decide between them. Other silent bridge failures and a refused continuation are also not excluded by the CI log.

## 3. Recommendation, proof and open questions

**inferred**, from the evidence above. The smallest justified change is test diagnostics: on the failed continuation poll, retain the provider requests, OpenCode stderr, plugin idle and `promptAsync` timings, bridge start/answer/exit outcome, and consumer view/turn state. Today `runOpenCode` removes the fixture and rethrows the assertion; its stderr is included only for its own timeout. Keep this assertion failing and keep every bound unchanged. A fixture test that deliberately fails `afterReply` should prove that its diagnostic payload survives cleanup.

For the independently proven loss window, the smallest repair scope is the bridge's delivery handoff: a committed report must remain owed until its receipt is established. Merely re-arming the waiter cannot recover a report already marked delivered. Do not implement a storage or acknowledgement scheme from this research report; the coordinator must settle its scope and duplicate-delivery rule. The decisive regression test uses a barrier after the view commit but before stdout, lets the existing deadline expire, then sends a user prompt. It must receive the transition once; a following prompt must not repeat it. The retained probe currently asserts the observed loss; a repair test must reverse that assertion.

Open questions: which phase failed in CI; whether the first hook registered successfully; whether Stop committed its view; whether `promptAsync` ran or failed. None is recoverable from the fetched log. The report does not close row 011-284 as a test-only timing issue or claim a product repair is proven for that job.

Verification: unchanged original file, **2/2 passed**, 18.15 s. Corrected probe, **3/3 passed**, 74.63 s. The first probe run had a probe-only `ConsumerRecord`/`.consumer` error in its diagnostic read (1 passed, 2 failed); [its output is retained](probes/ci-opencode-continued/initial-probe-error.txt). The original file ran once; the probe ran twice, serially with one worker, below 24 CPUs in load. Every test command cleared `PLUGIN_ROOT` and `PLUGIN_DATA`. No full suite or product edits. `squeal status --wait 60000` on the report and probe sources returned exit 3: no test closure holds those research files; known failures 0, all 1,347 test files current. This is no affected verdict for the research, not a newly run suite. Lint and typecheck exclude `docs/`; the probe was verified by its explicit run. `git diff --check` passed.

## Sources

- [Failed job][ci], fetched with `gh run view 41190295201 --log-failed` and `--log`; [excerpt](probes/ci-opencode-continued/ci-excerpt.txt).
- [Test at failed commit](https://github.com/hearsay-tools/squeal/blob/6ceaf9b85abac7d2410b201042e22654f31f7f6e/test/harness/opencode-continued.test.ts); local `test/harness/opencode/real.ts`, `test/helpers/opencode.ts`, `test/fixtures/opencode/scripted-provider.ts`, `test/harness/helpers.ts`.
- [Idle hook source](https://github.com/hearsay-tools/squeal/blob/6ceaf9b85abac7d2410b201042e22654f31f7f6e/src/harness/opencode/hooks.ts); local `turns.ts`, `bridge-client.ts`, `bridge.ts`, `bridge-turn.ts` in that directory; `src/harness/shared/stop.ts`, `src/core/delivery/delivery.ts`, `src/core/delivery/turn.ts`.
- [OpenCode spec D3–D5](../../008-opencode-adapter/spec.md), its `status.md`; 011 C8 and wave 63 R2. These are repository documents, not external API documentation. No recalled API or open-web source was used.

[ci]: https://github.com/hearsay-tools/squeal/actions/runs/41190295201/job/124505534282
