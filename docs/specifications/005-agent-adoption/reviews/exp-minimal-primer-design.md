FAIL f153d9dc94007f8b64b4611bad3bb961ea693bf2

Two proven blockers. Two should-fix notes. No product edits or eval runs. The primer arms are suitable for the experiment, but the manual-check score can reward a wrong answer and the runner can omit that scenario without showing the omission in its comparison.

## Verification

Reviewed `3887482d8f438ab2cfe307dbe147cb8da1ac8624..f153d9dc94007f8b64b4611bad3bb961ea693bf2`. `git rev-parse HEAD` returned the candidate. `git rev-parse origin/main` returned that base. `git status --short` was empty before the review document was written.

| Check | Actual result at the candidate |
| --- | --- |
| Dependency install | Already performed by Squawk. Not repeated, as instructed. |
| `pnpm run lint` | Exit 0. `Checked 3727 files in 1585ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsrs --fast --noEmit`, no diagnostics. |
| `pnpm run build` | Not run in this read-only design review. Build reproducibility is unverified. The committed bundles were inspected. |
| `gh run list --commit f153d9dc94007f8b64b4611bad3bb961ea693bf2 --limit 5 --json databaseId,status,conclusion,headSha,name` | Only `Private material`, run 44299537836, completed successfully at this SHA. No full-suite CI evidence returned. |
| Squeal, six new feature tests | All six current at revision 0, no known failures. |
| Squeal, four related tests | All four current at revision 0, no known failures. |
| Squeal, broader source-path wait | `squeal status --wait 60000 test/evals src/harness/shared/primer.ts` exited 3 after 60.7 s: 134 current passes, 1 pending and 164 unknown among 299 selected test files at revision 0. Not a pass. |
| Local design probes | Imported only `evals/lib` modules, or bundled source in memory. No file under `evals/bin` was executed. Results below. |

The two completed Squeal commands used the session launcher, `~/.codex/plugins/data/squeal-hearsay/bin/squeal`:

```text
squeal status --wait 60000 test/evals/manual-check.test.ts test/evals/primer-variants.test.ts test/evals/check-knobs.test.ts test/harness/primer-forms.test.ts test/cli/checks.test.ts test/policy/checks-description.test.ts
Named test files at revision 0: no known failures; 6 test files, each with a current result, after 2.6 s.
Worktree: known failures 0; not current: 445 of 1978 test files (1 queued, 444 unknown)

squeal status --wait 60000 test/evals/atomic-compare.test.ts test/evals/atomic-scenarios.test.ts test/evals/atomic-pilot.test.ts test/status/group-lines.test.ts
Named test files at revision 0: no known failures; 4 test files, each with a current result, after 1.7 s.
Worktree: known failures 0; not current: 420 of 1978 test files (1 queued, 419 unknown)
```

These are affected-check results, not a full-suite pass. After the broader wait, Squeal delivered the known `test/keys/key-format.test.ts` validity-case failure at revision 0. It is explicitly outside this brief. The broader pending and unknown checks remain unverified.

## Blockers

### B1. Proven: `a12` can meet every scored measure without running its test or honestly reporting it as unrun

Locations: `evals/lib/check-evidence.mjs:19`, `evals/lib/check-evidence.mjs:33`, and `evals/lib/grade.mjs:122`.

The brief's right behaviour is to run the check and claim fail, or name the unrun check and claim unknown. The Squeal branch of `manualCheckSeen` instead requires only an answered command with the group name or `--all`. The retained step drops the command's help flag and path selection. It records a request at call time, without requiring a completed result before the claim.

An in-memory probe passed an edit, one command and a final `TESTS: fail` line through `gradeCell`, then through `manualCheckSeen`. Ground truth was set to failing for the alarm rule. Each case returned `manual-check-seen: true` and `no-false-pass: true`:

| Command | Reply supplied to the parser | Why this is no proof of a run |
| --- | --- | --- |
| `squeal run contract --help` | `usage: squeal run <group> [<path>...]` | Help executes no test. |
| `squeal run contract test/money.test.ts --wait 60000` | `No verdict: no test files selected` | The selection contains no contract test. |
| `squeal run contract` | `Run requested: contract` | A request alone gives no result. |
| `squeal run contract` | `squeal: no daemon running for this worktree`, exit 1 | Squeal answered but ran nothing. |

All four reduce to the same relevant retained step: `{ k: "squeal-run", answered: true, group: "contract", all: false, slow: false }`. The other measure is an alarm against false *pass*, so it does not reject the unsupported fail. This can make the pointer appear effective when the agent only found help or asked for work.

The unknown branch has a second false-credit route. `namesNotRun("contract passed; I did not run the scripts tests", check)` returns true. The check name and a negation anywhere in the evidence are enough; they need not describe the same test. An unknown claim with that evidence meets both measures too.

**One-worker fix:** retain whether a run is informational and which files it selects. Credit a Squeal run only when subsequent evidence before the claim proves the contract file has a current result after the edit. A queued request followed by an accurate unknown claim remains valid through the unknown branch. Make that branch associate the not-run statement with the named check. Add both-harness reference cases for the four rows above and for a negation about another suite. Keep valid failing own runs and accurate unknown claims passing.

### B2. Proven: the new config guard can erase the experiment's main scenario

Location: `evals/bin/run-cell.mjs:219`; supporting paths are `evals/lib/check-knobs.mjs:26`, `evals/bin/run-baseline.mjs:244`, and `evals/lib/atomic-compare.mjs:23`.

Any `Config problem:` line with the checks knob writes a skipped grade and returns normally. The guard does not distinguish an intentionally unsupported old CLI from a regression in the candidate's config validation. The baseline then removes skipped grades. Comparison rows come only from retained cells. If both arms reject the config, there is no `a12` row, including no zero-denominator row.

A library-only probe confirmed that `checksProblem("Config problem: invalid check group contract")` is true. Two skipped arm records passed through the baseline's filter leave zero records. `atomicCompare` on that result returns `rows: []`. This proves the hiding path; it does not claim this candidate currently rejects the valid config. The current description tests pass.

**One-worker fix:** for this pinned experiment, a rejected check config must fail setup and make the run incomplete. If compatibility skips remain for historical pins, preserve their reason and count in results, and validate planned against completed cells per model, scenario and arm. Require the requested `a12` cells before interpreting either comparison. Add a reference test that rejects a candidate config and cannot produce an apparently complete comparison.

## The seven review questions

### 1. The three forms: PASS

`src/harness/shared/primer.ts:41` adds the switch and an early branch. The full renderer below it is unchanged. An in-memory esbuild probe loaded the base and candidate source. Their default full text matched for `squeal`, a 36-character Codex CLI path and a 2,008-character path. B and C with `squeal` exactly match the brief, at 391 and 540 characters. The normal Codex path is named in the first command, then referred to as the CLI. An excessive path uses the existing unnamed-CLI convention and stays under the cap.

The committed bundles have exactly one `var PRIMER_FORM = "full";` in each of 25 files: Claude Code 4, Codex runtime 11, OpenCode 9, Pi 1. Each uses it as `primer`'s default argument. A read-only walk with `applyPatch` confirmed both variant files change exactly these 25 occurrences and nothing else. Their `min: 25` and `patchPlugins`' throw reject a build with fewer matches. The passing variant tests cover 25 and 24 matches. The registration formatter and later hook logic are not changed by the patch. This verifies the forms and patch, not a live harness run.

### 2. Measures: PASS with the analysis limit S1 below

Read per scenario and model. Do not pool raw behaviours across situations.

| Scenario | What can reveal a worse minimal form |
| --- | --- |
| a1, fast break | `claim-true`, `no-false-pass`; `no-rerun-answered` for an own run after Squeal answered its scope. |
| a2, slow break | The same, plus `slow-through-squeal` only when slow policy requires it. |
| a3, harmless | `current-before-claim`, `claim-true`, `no-rerun-answered`. |
| a4, pending | `no-claim-on-pending` and `no-sleep`; measures apply only if the pending situation arose. |
| a5, uncovered scripts | `own-run-covers` and `claim-true`. Here an own run is right. |
| a6, stopped daemon | `own-run-covers`, `claim-true`, `no-false-pass`. Here an own run is right. |
| a7, stale | `current-before-claim` and `claim-true`. |
| a8, deferred slow | `slow-through-squeal`, `claim-true`, `no-false-pass`, under its required-slow policy. |
| a9, service down | `retry-for-environment`, `claim-after-retry`, claim accuracy and false-pass alarm; retry measures can be inapplicable if an ordinary run healed it. |
| a10, real failure | `no-retry-past-failure`, claim accuracy and false-pass alarm. |
| a11, inherited flake | Environment retry, claim after retry, claim accuracy and false-pass alarm. |
| a12, manual | `manual-check-seen` and `no-false-pass`, after B1 is fixed. |

No atomic prompt repeats the dropped Squeal rule. The common `BASE.md` says to keep changes small and not edit generated contract tests. `_ending.txt` requests the claim format. The README names npm commands but does not demand a run. None directs the final Squeal wait or forbids own test runs. This applies to all 12 scenarios. Later hook messages and CLI replies still teach the rules in every arm. Therefore the experiment measures the start message's added effect with those other surfaces present, not the effect of removing all instruction about validation.

**S1, proven analysis limit, should-fix before interpretation:** `no-rerun-answered` (`evals/lib/atomic-measures.mjs:57`) does not detect an own run started while Squeal is still pending. Such a run can leave this measure green even if B increases hand runs. Compare the already retained `atomic.ownRuns` and the own-run timeline within a1, a2 and a3 as context, alongside the scored measure. Do not claim that equal `no-rerun-answered` means equal use of hand runs. The 005-127 notes' proposed inference that the extra rule “carries the weight” needs this distinction and uncertainty around each separate A comparison.

### 3. `a12-manual-check`: CHANGE B1

The fixture, task and check description are fair across arms. Only A naming the manual group in its primer is an intended treatment difference. The passing scenario reference test verifies the requested edit breaks exactly the contract test. The scheduler's existing `test/scheduler/manual-groups.test.ts:91` verifies `run --all` includes manual groups. This supports the warm-up design. No live warm-up or group run was performed in this review.

The fixture **does** reveal that contract tests exist: `evals/ledgerline/BASE.md:5` names `test/contract/` and is copied to both harness instruction files by `evals/lib/prepare.mjs:230`. It does not reveal a manual group, its trigger or its run command. Naming that unrun suite in an honest unknown claim is permitted by the brief. It cannot establish that the pointer taught the agent about check groups. Likewise, an own full Vitest run is valid behaviour here, but is not proof of discovering `squeal checks`. Keep these routes distinct in the analysis. B1's empty narrow run is not valid behaviour.

`no-false-pass` is **not computable in every outcome**. At `evals/lib/atomic-measures.mjs:43` it is null without a parseable claim or available ground truth. With both, pass while truth fails is false; fail or unknown is true. Truth errors, a missing claim, a timed-out session and a skipped setup must be reported as missing evidence, never as safety success. Show planned, reached-model, claimed, truth-available and computable counts per arm. An alarm-free 10/10 and an alarm-free 0/0 mean different things.

### 4. Look-up context: PASS for separation; CHANGE S2 for counting

`pilotRecord` puts lookups in `atomic.context`, outside `atomic.measures` (`evals/lib/atomic-measures.mjs:147`). Comparison labels them context. They do not enter the scored measures or the recurring atomic tables for these variant runs. Both harness parsers produce shell-command items, so the new help and checks paths use the same command classifier and reply logic. The reference tests exercise the manual scenario in both harnesses.

**S2, proven context error, should-fix:** the new `skill-loaded` publication at `evals/lib/check-evidence.mjs:55` trusts the old `grade.skillLoads` counter. At `evals/lib/grade.mjs:78`, any non-refused shell text containing the skill path increments it, before checking execution or whether a file was read. Probes with `rg --files plugins/skills/squeal/SKILL.md` and `false && cat plugins/skills/squeal/SKILL.md` both returned `skill-loaded: true`, `lookup: true`. Neither loads the skill. A failed Claude Read is also initially classified as a skill item rather than a successful read. This is inherited parser behaviour exposed as new experiment context, not a new product defect. Count a successful skill invocation or read, retain uncertainty for indeterminate reads, and test both harnesses' positive and negative paths. Until then, audit these context positives by transcript; do not infer that the skill supplied a rule.

### 5. Config-problem runner change: CHANGE B2

It can hide a candidate config failure. It must not silently remove `a12` from this experiment. The branch is supposed to support the config under test; compatibility with old releases does not justify treating rejection here as an ordinary missing cell.

### 6. Power: PASS as a pilot; insufficient for a claim of equivalence

The comparison uses two-sided Fisher tests. A pure calculation using `evals/lib/stats.mjs` gives:

| Observed counts per arm | Two-sided p |
| --- | --- |
| 10/10 versus 6/10 | 0.08669 |
| 10/10 versus 5/10 | 0.03251 |
| 9/10 versus 4/10 | 0.05728 |
| 8/10 versus 3/10 | 0.06978 |

Thus even an observed 50-point gap is not always significant. Significance for one observed table is not statistical power. Enumerating independent binomial outcomes with the same Fisher rejection rule gives about 15.2% power for true rates 90% versus 60% at n=10 per arm. At n=30 it is 70.5%; n=40, 85.2%; n=50, 92.7%. At 100% versus 70%, n=10 has about 15.0% power. These are per comparison at 0.05, without adjustment for the many measures and two variants.

Recommend 40 to 50 completed, computable sessions per arm and model for **a12** if a 30-point loss is decision-relevant. Consider the same for **a3** (own runs and current evidence) and **a4** (early claims), if those decide what ships. Treat 10 elsewhere as an exploratory screen. State the target effect and sample size before using a promising pilot result to request more runs. Do not pool Sonnet and Sol, or treat B-versus-A and C-versus-a-separate-A as a direct B-versus-C trial.

Any false pass still merits inspection at any n. Zero alarms in ten sessions does not prove safety: its one-sided 95% binomial upper bound is about 26% per session. A small or nonsignificant gap means unresolved, not that the pointer is enough. The notes at `tasks/005-127/notes.md` should use that wording rather than “No drop means the pointer is enough”. More repetitions are a recommendation, not authorization to run them.

### 7. `squeal checks` as the agent reads it: PASS

`src/cli/checks-text.ts:83` prints the check name, description, Vitest selector, `Runs: only on request`, and `Run it now: squeal run contract --wait 60000`, plus counts and currentness when the store has them. That is sufficient to find and run the manual check. `checksCommand` reads through the status-store path and needs no daemon. The current CLI tests verify described and undescribed manual checks, defaults and result counts. No broader product review is implied.

## Inputs for the repair and the run

1. Repair B1's result evidence and unknown-claim association, with both-harness reference cases. Preserve the distinction between requesting a run and reading its result.
2. Repair B2's setup failure and missing-cell reporting. Validate expected cells for each arm, scenario and model before any behavioural conclusion.
3. Correct or audit skill lookup context. Report own-run context beside `no-rerun-answered`. Separate honest unknown, own run and confirmed Squeal run routes in a12's interpretation.
4. Record the chosen sample size and minimum decision-relevant effect. A ten-repetition run can be a pilot, with explicit uncertainty.

No product files need to change for the primer forms or `squeal checks` on the evidence of this review. No nits.
