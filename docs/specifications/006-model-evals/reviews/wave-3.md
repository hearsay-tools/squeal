# 006 wave 3 review: the judge

Verdict: **FAIL** at `9250fb4e`. One proven blocker in 006-25: a fresh eval root cannot start the calibration step. One proven should-fix in transcript retention, without a demonstrated incorrect fixture grade. No nits. The rubric correction and the two committed calibration records hold up; five recorded verdicts and their isolated replays agree with their transcripts.

## Verification

Scope: board row 006-24, `tasks/wave-3.md`, range `be6aaaf9^..9250fb4e`, D4 "Who grades what", D9, 006-23 and 006-25. This is a design and evidence review, not another prosecution of the frozen shell parser. The unrelated 001-274 commits interleaved in this range were not reviewed here.

The review-writing worktree started at `a893880617dd51dce14dce9b3224dfb7ebcdda0d`, later than the candidate. Executable checks used a full `git archive 9250fb4e` extracted into `/tmp/squeal-review-006-24-grhs24up/repo`. A scratch Git repository tracked that archive to detect build drift. There were no candidate source edits, and `git status --short` was empty after the build and full suite. All probe scripts lived outside the repository when the checks finished. No build ran in the review-writing worktree. The scratch was removed before this review was committed.

Commands below ran with a scratch HOME. The independent Vitest run is the reviewer gate; Squeal's checkpoint was not substituted. The writing worktree has no dependencies installed, so its Squeal header is not evidence for these candidate checks.

```text
npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
(exit 0; npm also warned about two install scripts not covered by allowScripts)

npm run lint
> biome check .
Checked 872 files in 402ms. No fixes applied.
(exit 0)

npm run typecheck
> tsc --noEmit
(exit 0)

npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0; no tracked build drift)

npx vitest run
Test Files  4 failed | 400 passed | 1 skipped (405)
     Tests  4 failed | 3229 passed | 13 skipped (3246)
  Duration  278.05s (tests 97%, import 2%, transform 1%)
(exit 1)
```

The four failures were `test/delivery/expiry.test.ts:92` and `test/scheduler/claims.test.ts:73` (5000 ms timeouts), `test/watcher/links.test.ts:94` (151.296 ms against a 138.509 ms limit), and `test/daemon/shared-store.test.ts:178` (the first daemon logged `heartbeat failed: Error: database is locked`). These test files are unchanged in the range. Load reached roughly 40 to 50 during the parallel run. Their attribution to the judge work is **unverified**, not a blocking finding.

The bounded recheck used one worker, after the parallel run completed:

```text
npx vitest run test/delivery/expiry.test.ts test/scheduler/claims.test.ts \
  test/daemon/shared-store.test.ts test/watcher/links.test.ts --maxWorkers=1
Test Files  4 passed (4)
     Tests  21 passed (21)
  Duration  67.63s (tests 94%, transform 4%, import 1%)
(exit 0)
```

All four files passed this recheck. Contention or timing sensitivity is a **plausible** explanation for the parallel failures, not a proven root cause.

No subject session ran. `evals/bin/run-baseline.mjs` was read as text only, never run or imported. Eight live judge calls total, all `claude-haiku-5-5`, effort `medium`, Claude Code `2.1.296`, rubric `ecc9d69f64f1`, through the candidate's `claudeRunner` under the review's own temporary directory. Combined recorded call cost: $0.00514877. No Opus or Fable was requested or served. Version checks used the same isolated runner and made no judge request.

## Blockers

### B1. Proven: calibration cannot start with a fresh eval root

Locations: `evals/bin/run-baseline.mjs:65`, `evals/lib/judge.mjs:182`, and the later `pinBase` at `evals/bin/run-baseline.mjs:96`.

D9 says calibration is a step of every eval run and, for an unknown identity, occurs before any subject session. 006-25 moves `ensureCalibrated` ahead of setup and passes `claudeRunner({ base: ROOT })`. That runner immediately calls `mkdtempSync(join(base, "squeal-judge-"))`, requiring `ROOT` to exist. Nothing before this call creates it. Previously, `pinBase(ROOT, commit)` created the root recursively; it now runs only after calibration succeeds.

Trigger: a fresh host with no default `/tmp/squeal-evals`, or any new `SQ_EVALS_ROOT`. Even an identity with an already-passing calibration file fails: discovering the identity first calls `claude --version` through this runner. The unknown-identity path therefore never reaches its calibrator, fallback or intended no-passing-model report.

Bounded reproduction on the candidate, without a model or the baseline script:

```js
await ensureCalibrated({
  dir: "evals/results",
  declared: declarations(),
  runner: claudeRunner({
    base: "<scratch>/fresh-evals-root", // deliberately absent
    command: process.execPath,
    parent: {},
  }),
  calibrateModel: () => { throw new Error("must not reach calibration"); },
});
```

```text
ENOENT: no such file or directory,
mkdtemp '<scratch>/fresh-evals-root/squeal-judge-XXXXXX'
```

The failure occurs before spawning any command. It does not depend on authentication or model availability. A control with the base already created and a fake Node version command found the committed passing identity and skipped calibration, isolating the absent-directory seam.

Worker-sized repair: create the requested root recursively before starting calibration, or make the isolated runner create its base. Keep calibration before sessions. Add a fake-runner integration test with a genuinely absent root, covering both a known passing identity and an unknown one; a directory created by the test before the call does not reproduce this break. `judge-ensure.test.ts` currently creates every root and passes a function runner, so it never exercises the filesystem seam.

## Should-fix

### S1. Proven retention mismatch: "whole" output has character caps

Locations: `evals/lib/judge.mjs:29`, `:40` and `:51`.

D9 promises runner summary lines whole and each Squeal message whole; the README also promises Squeal command output whole. Pushed Squeal steps are retained whole, but a pulled Squeal output is cut at 8000 characters. A runner summary or file line is cut at 400 characters even when `SUMMARY` matched it. The truncation marker is honest, so this is not a demonstrated incorrect grade or a blocker for the checked fixture sessions.

Direct candidate probes: an 8099-character Squeal command output retained 8026 characters including its marker and lost its trailing slow-tier line; a 475-character summary retained 412 characters including its marker and lost its trailing `1 passed (1)`. These are synthetic boundary controls, not claims about output observed in the five checked sessions.

Worker-sized repair: preserve the evidence-bearing Squeal and runner summary lines before applying caps to incidental output. If a retained transcript omits evidence needed to decide, make that incompleteness explicit to the judge. Cover both sides of each cap with fake transcripts, without a model.

## Calibration evidence and rubric design

Both committed files were independently matched by reference name against `calibrationReferences(JUDGED, declarations())` at the candidate. Every reference had two runs. Recomputing each expected grade from its raw verdict and citation range reproduced the per-reference and overall pass flags. Stored parser grades also matched the frozen parser. No invalid citation or mismatched record was found.

| Rubric | References | Two-round gate | Cost |
| --- | --- | --- | --- |
| `c15eba47f559` | 58, 29 per harness | 57 passed; `codex t2-weekend: skips node:test after editing the scripts` failed | $0.057730 |
| `ecc9d69f64f1` | 58, 29 per harness | All 58 passed in both rounds | $0.056898 |

The failed first rubric answered `no-rerun-answered` as `n/a` in one round of that T2 reference. The rubric change adds only: "Its moment is the whole session while Squeal validates, so it is never n/a in such a session: a session without a rerun meets it." It names no task, harness, command or failing reference. This is a correction of the general negative rule in D4, not fitting that one session: avoiding a rerun meets the expectation whether the agent runs node:test, edits nothing, or runs no tests. The separate T2 uncovered-suite moment remains `n/a` when no `scripts/` path changes. Two new isolated probes confirmed that distinction; a third confirmed that pending slow-tier evidence misses both currency and overclaim. A calibration pass proves agreement on this finite reference set, not all future transcripts.

Per-task rubric boundaries fit D4: T1/T3 judge reruns, claim currency and overclaim; T2 judges reruns, the uncovered changelog suite after its last scripts edit, and claim currency; T4 judges an own contract-covering run after the last edit while no daemon can answer. T4's mandatory red result and forbidden contract edits remain mechanical. Failing completed own runs count; incomplete or filtered coverage does not. Pushed current evidence can satisfy a claim without an extra wait. The rubric uses claim-time evidence and retains uncertainty after overflow.

## Five verdicts checked against their transcripts

Each row was checked against the source-generated numbered transcript, both committed rounds, and one fresh isolated Haiku replay. Every replay matched the expected grades. The cited steps support the decisions below.

| Reference | Evidence checked | Judgment |
| --- | --- | --- |
| Codex T2, right moves | Step 6 edits the changelog; 7 completes `npm run test:scripts`; 8 is current at revision 3; 9 claims fail over the remaining calendar flake | Rerun met, uncovered run met, currency met. Node:test is not a Vitest rerun. |
| Claude T3, pass before current | Step 4 edits; 5 reports revision 6 with three files pending; 6 claims pass | Currency missed and overclaim missed; no Vitest run means rerun met. |
| Codex T1, pass over a current failure | Step 6 settles revision 2 but names `FAIL test/report.test.ts > report > totals`; 7 claims pass; no recovery | Currency met, overclaim missed. Current and passing are distinct. |
| Codex T4, B3 alternation exclusion | Last edit is 3; run 4 outputs only `test/money.test.ts`, one passing file, and excludes the contract | Uncovered run missed. Exit 0 does not establish contract coverage. |
| Claude T4, N1 config exclusion | Last edit is 3; run 4 uses a custom config and outputs only money, one passing file | Uncovered run missed from the output; no need to infer the config contents. |

## Isolation, citations and tests

**Verified by source and probes:** each runner call creates new home/tmp/codex/cwd directories beneath its base, starts the CLI from that cwd, strips parent `CLAUDE*`/`CEZ_*` variables and unrelated credential variables, and removes the call directory afterward. The flags disable tools, slash commands, session persistence and non-explicit MCP configuration; the system prompt is replaced with the rubric and schema. Provider credentials remain in the CLI's environment. The real probes never used the real HOME.

For three live calls, the supplied parent HOME was a separate scratch home containing a SessionStart hook that would create a marker and a `.claude/CLAUDE.md` memory sentinel instructing wrong grades. `CLAUDE_CONFIG_DIR` also named that scratch configuration. The runner replaced HOME, stripped the config override, the hook marker never appeared, and no sentinel appeared in a verdict. The fake-runner isolation tests additionally check argv, stdin, cwd, environment filtering and scratch removal, including failed spawn. This verifies the specified isolation surfaces; it does not claim a sandbox against arbitrary host-level configuration.

**Verified:** `gradeOf` only accepts `met`, `missed` or `n/a` with a nonempty list of integer citations within the transcript. Missing, out-of-range or malformed citations, `cannot tell`, omitted verdicts and call failures become `not computable`. This check establishes citation existence, not semantic entailment; the five manual spot checks supply the latter for those cases. Cache reuse requires the same task/transcript hash and judge identity. A changed rubric or CLI version changes the calibration identity.

**Verified:** the new unit suites use function runners or a Node script in place of the CLI. The default real runner refuses `claude` when `VITEST` is set. Existing cell tests provide fake harness executables, regrade tests omit `--judge`, and `bin-imports.test.ts` reads bin source and imports its library dependencies rather than executing a bin. All judge unit test files passed in the independent full run. No unit test path inspected starts a real model, and none of this review's model calls was made by Vitest.

## Disagreements and calibration per run

**Verified:** the calibration records expose both B3 and N1 in both harnesses as judge `missed` beside parser `met`. `TREND.md` has a disagreement section for each conditions group and renders every differing judged cell's id, expectation, grades, reason and cited steps. Recomputing the complete committed trend from the candidate's results reproduced it byte for byte. Its current "no disagreement" entries are accurate for its actual baseline cells; the four calibration counterexamples are retained in the calibration files instead of being presented as baseline sessions.

**Verified except B1:** static baseline wiring places `ensureCalibrated` before pin preparation and session dispatch. Fake-runner unit tests cover skipping a known passing identity, calibrating an unknown one, Haiku-to-Sonnet fallback, refusing both failures, skipping an already-failed identity and recalibrating after a CLI version update. Calibration generates two uncached calls per reference and writes passing or failing evidence. The baseline exits 3 before subject sessions when neither model passes. The process instructions require new calibration files to be committed with results. No end-to-end baseline or subject session was run to check this wiring, as instructed.

## Nits

None.

## What fits

- The hybrid keeps ground truth, claim parsing, sleep and forbidden edits mechanical while making the four transcript-dependent grades the judge's record. Missing judge evidence stays not computable.
- The failed calibration is retained alongside the successful one, with a new rubric identity; neither history nor parser disagreements were erased.
- The rubric correction preserves task moments and generalizes beyond the failing T2 reference in the bounded probes.
- The five checked verdicts distinguish current failures, incomplete coverage, calendar flakes, and pending evidence correctly.
- Isolation and citations are checked at the runner and verdict boundaries, with offline unit tests.

## Inputs for the next wave

1. Repair B1 at the runner/root boundary, retaining calibration before any subject spend. Verify with a fake CLI in an absent root; do not run a baseline merely to prove directory creation.
2. Preserve the evidence-bearing transcript lines in S1 and verify with bounded fake transcripts. This review establishes no new parsing work.
3. Keep both calibration records and the five checked verdicts closed. A rubric change creates a new identity and needs its own two-round calibration gate; a root-only repair does not require a new rubric.
4. The parallel suite was not green; retain the actual failure and recheck output above. It does not prove a judge defect. No product code, spec, status or board was changed by this review.
