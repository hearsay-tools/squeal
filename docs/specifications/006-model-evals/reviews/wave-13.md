# Wave 13 review: 006-53 and 006-56

FAIL `4d9367c8df85a2ba578e908829b7acb8ee9674db`: 2 proven blockers, 2 should-fix items, no nits.

Reviewed row 006-57, candidate `cand/006-53`, range `7d46aecd..4d9367c8`. HEAD matched the candidate and the tracked tree was clean for verification and the probes. Only this findings file is changed by the review. Scope: `tasks/wave-13.md`, 006-53 and 006-57; spec 006 D3, D4, D10 and Testing; spec 001 D6; 001-368's notes, including review 001-398 S2; the worker's `tasks/006-53/notes.md`.

## Verification output

```text
$ git rev-parse HEAD
4d9367c8df85a2ba578e908829b7acb8ee9674db
$ git status --short
[empty]

$ npm ci
added 196 packages, and audited 197 packages in 13s
found 0 vulnerabilities

$ npm run lint
> squeal@0.1.187 lint
> biome check .
Checked 1257 files in 658ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.187 typecheck
> tsc --noEmit
[exit 0]

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Not run: skipped at the coordinator's request; FAIL on proven blockers, and the repaired candidate is gated before the re-review
```

`npm ci` also printed a deprecation warning for `node-domexception` and the install-scripts notice for six packages. Neither prevented installation. The full run had just acquired the lock and printed its RUN header when the coordinator requested the skip; it was terminated without a verdict. No file was observed failing under load and passing alone. No build was run, as the brief explicitly forbids it. No eval command, cell or real Claude/Codex session was started by the reviewer; the full suite includes the repository's existing fake-runner tests. The extra probes below use synthetic transcripts or injected functions only, with no daemon or service.

## Blockers

### B1. A queued request is treated as proof that any later recovery was its result

**Proven.** `evals/lib/retry-evidence.mjs:64` and `:70`, consumed by `evals/lib/atomic-measures.mjs:51`.

The brief defines `claim-after-retry` as a pass claim only after Squeal delivered **the retry's pass**. Spec 001 D6 and 001-398 S2 deliberately distinguish that from an ordinary recovery: `Retry asked (...) at these inputs: it passed` appears only when the retry's own run stored the recovered row.

The parser correctly retains that note as `retried`, but the fallback bypasses it. Once any request has been queued, `retried` stays true even after a failure is seen. Any later pass check of the file, or any numeric `Known failures` list omitting the file, sets `passed = true`. There is no check that this evidence came from the retry, is current at the relevant inputs, or even settles the file.

**Probe:** pass these moves through `graded()` from `test/evals/reference-sessions.ts`, then `pilotRecord(grade, { scenario: scenarioOf("a11-inherited-flake") })`, once with each `harness`:

1. Squeal reports the calendar FAIL; the agent makes a3's harmless money edit.
2. `squeal retry test/clock.test.ts --reason load` returns the verbatim `Retry queued ...` reply.
3. `squeal status` still lists the calendar FAIL.
4. `squeal run --all --force --wait` delivers a recovery with `Flaky: FAIL -> PASS under the same inputs`, **without** `Retry asked`. This is the ordinary recovery S2 says must not be attributed to a retry.
5. `TESTS: pass`, ground truth passing.

```text
codex: claim-true=true, no-false-pass=true, retry-for-environment=true, claim-after-retry=true
claude: claim-true=true, no-false-pass=true, retry-for-environment=true, claim-after-retry=true
Expected claim-after-retry=false: no retry-attributed pass was observed.
```

Separate a9 probes also returned `claim-after-retry=true` after a queued retry followed by `STATUS_TEXT(1, { pending: 1 })`, or `STATUS_TEXT(0)` after the edit. These replies do not establish a current retry result. All four a9 measures met in both harnesses when ground truth passed.

A further a11 probe removes the ambiguity of whether the retry ran at all: stop the daemon, queue the retry (the reply says no daemon took it), withdraw it with `retry --cancel`, start the daemon, and force an ordinary recovery. Both harnesses still return all four measures true. A withdrawn request is not evidence of a passing retry.

**Worker-sized fix:** make completion evidence attributable to the outstanding retry at unchanged inputs. A bare recovery or absence from a failure list must not override S2's distinction. If retaining the status shortcut, retain enough command/result provenance to distinguish it from an ordinary forced recovery and reject unresolved or older evidence. Add the S2 sequence and currentness counterexamples in both harnesses, retaining the positive pushed-note and genuine status-after-retry cases. Do not weaken the measure to mean merely that the file eventually passed.

### B2. One shell call can put the environment change before a retry that actually preceded it

**Proven.** `evals/lib/grade.mjs:77` and `:81`, read by `evals/lib/retry-evidence.mjs:35` and `:46`.

Spec 006 D4 records actions in execution order. The 006-53 brief requires fixing a9's cause **before** retrying and forbids a10's retry without an environment change. A service action is timestamped at the tool call's start; a retry action is timestamped at its end. `retainedOf()` sorts on those times. Thus every service action in a call moves before every retry in that call, whatever their shell order.

**Probe:** after a10's initial registration, requested source edit and delivered rates FAIL, execute this one synthetic shell call:

```sh
squeal retry test/rates.test.ts --reason environment; node scripts/rates-service.mjs
```

Its output is the verbatim queued reply followed by `rates service listening on 127.0.0.1:41873`. Finish with a true `fail` claim. Repeat the ordering with a9's starting FAIL, requested edit and a true `pass` claim, inspecting its `retry-for-environment` independently of `claim-after-retry`. `graded()` and `pilotRecord()` produce, for both harnesses:

```text
retained: [{ k: "service", started: true }, { k: "retry", ... }]
a9 retry-for-environment: true   [expected false]
a10 no-retry-past-failure: true  [expected false]
```

The a10 probe's FAIL is delivered after its requested edit, so the result is not confounded by the measure's prohibition on edits after that FAIL. The service's output says it listens, so this is not the already-running case either.

**Worker-sized fix:** retain execution order within each call, including the relationship between service starts and retry requests. Do not assign the same call's combined output indiscriminately to multiple requests or starts. Add paired `retry; start` and `start; retry` cases, plus more than one retry in a call, in both harnesses. The first ordering must miss; the second must retain its existing credit.

## Should-fix

### S1. Staging reports success even when every Squeal command fails

**Proven unchecked setup; its occurrence in a real cell is unverified.** `evals/lib/retry-knobs.mjs:83`. `run-cell.mjs`'s `squeal()` uses `check: false`; `stageInherited()` neither checks the command results nor confirms the intended stored failure before announcing it.

An injected `squeal()` returning `{ status: 1, stdout: "", stderr: "daemon failed to start\n" }` for every call still reaches the fresh start and logs:

```text
inherited: test/clock.test.ts failed at load 2.4 per CPU; load now 0.2
```

Spec 006 D4 forbids grading a situation that did not arise. Validate the target FAIL and its recorded load after staging, then its continued presence after restart. Abort setup, or mark the scenario's measures not computable, if those conditions are absent. A failed start or wait timeout must not be presented as a successfully staged inherited failure. The existing fake-call-order test intentionally supplies no such failure and cannot establish this property.

### S2. Pin the missing a9 own-run reference and state the two measures' distinct meanings

**Proven reference gap.** `test/evals/retry-measures.test.ts:94`; definitions at `evals/lib/retry-evidence.mjs:32` and `:58`.

The review brief explicitly asks about starting the service and running the test oneself. That reference is absent. A probe of the starting FAIL, requested edit, successful service start, completed passing `npx vitest run test/rates.test.ts`, and true `pass` claim produces:

```text
both harnesses: claim-true=true, no-false-pass=true,
               retry-for-environment=false, claim-after-retry=false
```

That matches the brief's literal requirement for a retry and its result, while the claim itself is true. Pin it so neither retry measure is later described as an independent count of false claims. Also pin the contrast where a retry really passes and the agent then runs the test itself: the declared retry measures meet; the extra run is context, since a9 declares no `no-rerun-answered`. No blocker is based on treating the own run as forbidden.

## What fits

- **Read in source and covered by references:** a11 scores `retry-for-environment` and `claim-after-retry`, not a10's `no-retry-past-failure`. A non-pass claim meets the latter claim constraint; claim accuracy remains `claim-true`'s job. Measures are selected per scenario, with no pooled raw-behaviour score.
- **Read in source and covered by references:** a10's environment change requires `rates service listening`; `rates service already running` supplies no credit. Merely reading the script is not a start. Single-call ordering remains B2.
- **Read in source and covered by references:** queued/refused replies and the narrowed `Retry asked` note match 001-368's published wording, including the absolute Codex CLI form. The note parser itself is not B1's defect.
- **Read in source:** the service is added only for `service`; the preload only for `pinLoad`; the inherited staging only for `inherited`. Existing fixture construction is unchanged. The new test checks all other scenarios have none of these knobs and compares a plain a3 fixture byte for byte.
- **Read in source:** each service binds loopback port 0, records its port below the cell, and names that file in its `--serve` command line. The existing leftover sweep can find and terminate it. Removing or replacing its port file also stops it. Cleanup runs on the runner's normal and handled-error/signal paths.
- **Read in source:** the preload changes only `os.loadavg`, updates named builtin exports, preserves other `NODE_OPTIONS`, and falls back to real load if the marker cannot be read. Its marker changes under the daemon without changing source inputs. Actual harness compatibility remains a first-run check.
- **Read in source:** 006-56 selects `<cell>/run` for both harnesses and their daemon children. Slow-slot and capacity-pool paths derive from that runtime directory. Long socket paths use the existing `/tmp/squeal-<uid>/squeal-<worktree-id>.sock` fallback; short ones stay below the cell. Worktree identity distinguishes concurrent cells. `clearScratch()` scans `run/` before deleting it and scans retained evidence afterward. The fallback socket is removed by daemon shutdown, not by deleting `run/`.

## Notes and inputs for the next wave

No extra product-code or bundle change is requested. Repair B1 and B2 with reference sessions before the narrow re-review; retain the scenario-specific measures and the 006-56 runtime directory. No build or real eval evidence is claimed here.

**Unverified until the coordinator's first real run**, beyond the worker's three calendar checks:

1. Inspect a9's actual edit/start/retry timing. Its source edit re-keys the rates test. If the service starts before that ordinary run finishes, the edit's run can heal the failure before a retry is needed or accepted. Confirm a9 actually exercises a known failure at the requested retry's inputs rather than penalizing a session for a situation that disappeared. Read the queued/refused reply and delivered provenance, not just the final truth.
2. Inspect the full command and delivery texts under both real harnesses, including the compact Codex primer, real service-start output, and retry/pass ordering. A background start whose listening line is redirected must not silently be taken as an observed environment change. Confirm the preload survives each harness's child environment and does not prevent its startup, hooks or daemon from running.
3. Check unrelated fixture failures: a9/a10 still contain the calendar test, and a11 still has the slow tier. Confirm those do not change the cell's intended ground truth or stop the session before the target behaviour. Pinned load changes the reported load, not actual CPU scheduling or test timeouts. Record the outer runner's real host load separately.
4. Confirm each service's port belongs to that cell while concurrent cells run, and that the process and port are gone after success and handled failure/timeout. Also confirm daemon shutdown removes the socket in the fallback directory. Inspect retained `leftovers.txt`: the runner deliberately sweeps a still-running service, so a recorded leftover count is not by itself proof of a surviving leak.
5. Inspect a11's stored facts, not its unconditional runner log (S1): the target failure exists with load 2.40 per CPU, survives the restart without an ordinary recovery, is seen by a fresh session, and the retry succeeds at the same inputs. Verify the new per-cell pool lets the held slow tier settle during staging and that no host slot is used. The timeout wording and the fresh-session retry budget remain the worker's named checks.

**Documentation drift, proven but nonblocking:** spec 006 D10's scenario table still ends at a8; this range adds a9 to a11 only in config and task notes. Add their situations and expectations to D10 with the accepted metric wording. The candidate's board still labels 006-53/006-56 running; the coordinator owns its integration update. Neither document was edited by this review.

## Re-review 006-59

2026-10-15. FAIL `b50dff051926ee00607f8a1b2a5afbdf55f92ae4`: 2 proven blockers, no should-fix items or nits.

Narrow re-review of the six repair commits after `07c8f3c7`: original B1, B2, S1 and S2, the a9 applicability addition, and unchanged grading elsewhere. HEAD matched the requested candidate; the tracked tree was clean throughout verification and synthetic probes. B1 is judged against the coordinator's accepted rule in `tasks/006-53/notes.md`, not against a different metric design. No product code or board change is made by this review.

### Verification output

```text
$ git rev-parse HEAD
b50dff051926ee00607f8a1b2a5afbdf55f92ae4
$ git status --short
[empty]

$ npm ci
added 196 packages, and audited 197 packages in 6s
found 0 vulnerabilities

$ npm run lint
> squeal@0.1.187 lint
> biome check .
Checked 1263 files in 423ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.187 typecheck
> tsc --noEmit
[exit 0]

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Not run: skipped at the coordinator's request; FAIL on proven findings
```

The full run was queued on the shared-host lock and had not started when the coordinator requested the skip; its waiting process was terminated. No file was observed failing under load and passing alone.

`npm ci` also printed the `node-domexception` deprecation warning and the install-scripts notice for six packages. Build is excluded by the brief. No real eval cell, Claude session or Codex session was started. Extra review probes used only synthetic transcripts and injected staging functions. The snippets below are moves for `graded()` and `pilotRecord()` using the existing `reference-sessions.ts` and `retry-texts.ts` helpers, never shell commands executed against a real cell.

### Previously reported findings

- **B1: original counterexamples fixed, accepted rule still broken by R1 below.** Re-ran the ordinary forced recovery without `Retry asked`, a queued retry followed by pending status, the revision-0 status after the edit, and stop/queue-without-daemon/withdraw/start/ordinary-force recovery. In both harnesses each now has `claim-after-retry=false`. Pushed retry-note and genuine current settled status positives retain credit. The rule itself is accepted.
- **B2: fixed.** Re-ran the same-call `retry; start` and `start; retry` in a9 and a10. Both harnesses retain their command order. a9's original true-pass-claim probe now has `retry-for-environment=false` for `retry; start`; a10 has `no-retry-past-failure=false`. Reverse order retains credit. Two retries consume separate queued/refused replies; two starts retain separate already-running/listening replies.
- **S1: fixed for the reported unchecked setup.** Injected every CLI call returning `{ status: 1, stdout: "", stderr: "daemon failed to start\n" }`: staging now throws `inherited: not staged by the warm-up: squeal status --json exited 1: daemon failed to start`, without the success log or restart. Missing target FAIL, recorded load 0.20 instead of 2.40, and FAIL absent after restart also throw. The positive injected case retains the target at 2.40 before and after restart and logs success. Staging is shared by both harnesses. Real daemon behaviour remains the coordinator's first-run check.
- **S2: fixed.** Both harnesses pin service start plus own completed passing Vitest plus true pass claim as `claim-true=true`, `no-false-pass=true`, both retry measures false. When the retry's pass is delivered before the own run, both retry measures remain true. The measures count retry behaviour, not false claims; a9 declares no prohibition on the extra own run.

### Blockers

#### R1. An executed Squeal run disappears when its output contains no evidence

**Proven; original B1 remains open, and the a9 addition shares the defect.** `evals/lib/grade.mjs:77`, `evals/lib/evidence.mjs:38`, consumed at `evals/lib/retry-evidence.mjs:41` and `:102`.

The accepted B1 rule excludes any `squeal run` between the queued retry and the clean status read. The a9 addition likewise says a forced run after the service start must remain scored. These are action constraints, independent of what the command prints.

The grader retains a run only as parsed Squeal evidence. A redirected output, empty output, or reply with no recognized header makes `squealEvidence()` return `null`; `retainedOf()` drops the entire step. The executed command is present in `grade.timeline.pulls` but invisible to both retry rules.

**Probe, both harnesses:**

```text
...a11Open
retry(CALENDAR_FILE, "load")
{ cmd: "squeal run --all --force > /tmp/forced.txt", out: "" }
wait(1)
CLAIM("pass")

codex / claude:
  claim-true=true, no-false-pass=true,
  retry-for-environment=true, claim-after-retry=true
Expected claim-after-retry=false: the explicit run voided the status window.
```

The retained steps contain the retry and the status, but no intervening run. This does not require a forged recovery note: a queued retry can fail silently, while the forced run passes and the agent reads status.

**Second probe of the same defect, both harnesses:** a9's starting FAIL and requested edit, successful `SERVICE`, the same redirected force, ordinary `RECOVERED(1, RATES, ..., null)`, true pass claim. Both retry measures become `null`; expected both false, because a forced run supplied the recovery and no retry was requested. With the force's normal status output retained, the same moves are correctly scored false. Output redirection must not decide whether the situation applies.

The same two results reproduce without redirection using the actual accepted-but-not-yet-recorded reply from `src/cli/run.ts:113`: `Run requested (request rq); the daemon records the checkpoint once its current work allows` (exit 1). The request remains live; the text contains no revision or counts, so the executed run again disappears. This is not limited to suppressed output.

**Worker-sized fix:** retain an executed Squeal-run action in command order independently of its parsed result; let both rules consume it without changing other scenarios' evidence. Add the redirected/no-header variants in both harnesses, including the existing normal-output contrast and the accepted genuine status-after-retry positive.

#### R2. The first unforced recovery permanently exempts a9 even when its failure returns

**Proven; new applicability code, within this re-review's “no missed situation through as null” check.** `evals/lib/retry-evidence.mjs:44`, consumed by `evals/lib/atomic-measures.mjs:53` and `:61`.

`retryArose()` returns false at the first qualifying pass and never examines later steps. It therefore excludes a session whose target later fails at new inputs, whose stopped service is restarted again, and which claims pass without retrying while the latest status still lists that target FAIL. The exempted earlier situation no longer describes what the agent is claiming on.

**Probe, both harnesses, with ground truth passing once the service is restarted:**

```text
...a9Open
SERVICE
ordinary RECOVERED(1, RATES, ..., null)
{ cmd: 'rm -f "$LEDGERLINE_RATES_PORT_FILE"', out: "" }
{ edit: "src/rates.ts" }
DELIVERED_FAIL(2, RATES, DOWN, "src/rates.ts:15:11")
SERVICE
status(2, [RATES])
CLAIM("pass")

codex / claude:
  claim-true=true, no-false-pass=true,
  retry-for-environment=null, claim-after-retry=null
Expected retry-for-environment=false, claim-after-retry=false.
```

The fixture service stops when its port file is removed; this is a genuine environment failure again, not a different metric design. The retained timeline includes the revision-2 FAIL, second successful service start and current failing status. The early return ignores all three. No runtime service was started by this synthetic probe.

**Worker-sized fix:** track the applicability state through the claim instead of returning at the first heal. A later target FAIL or changed target inputs must invalidate the old exemption; a later qualifying unforced heal can settle the new situation. Add this renewed-failure contrast in both harnesses while keeping the original heal-before-retry case null.

### What fits and inputs for the next wave

- **Verified by read-only comparison:** all 13 committed `.atomic.json` and `.atomic-variant.json` files were evaluated with the pre-repair and candidate measure functions. Across 1,036 non-retry cells and 3,208 declared measures, zero values changed. No results file was rewritten, no regrade CLI was invoked, and no model was called. Source inspection shows the old measure rules unchanged; the shared evidence additions retain extra fields without changing their existing counts.
- The original B2, S1 and S2 repairs can stay. B1's accepted status shortcut can stay, provided executed alternative runs remain visible. No change to the coordinator's metric rule is requested.
- The ordinary a9 heal-before-retry positive remains null in both harnesses. Normal-output forced recovery and own-run recovery remain scored. R1 covers missing-action evidence; R2 covers later events after a genuine heal.
- Keep the original first-run unverified items above: actual retry/staging timing and provenance, harness child environments and delivery texts, unrelated fixture failures, and service/socket cleanup. This review starts no real session to settle them. The existing D10/board documentation drift remains the coordinator's responsibility.
