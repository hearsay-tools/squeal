# 010 wave 1.5 re-review

## Verification

Candidate: `cand/010-10`, `98fdca2eacf28422347b5af375496f10791dc6bb`.
Range: `git diff bf0a41fb..98fdca2e -- .github .claude test`.
Narrow second-round review of 010-14 against 010-11 B1, S1 and N1.

The coordinator advanced the candidate from `877c1afe` to `98fdca2e` during this review to include the real node:test eval callers. I detached at the final SHA before its checks. The non-docs delta contains only the workflow, selection list, guard and coordinator skill line. Under the 010-15 brief, no independent full suite was required or run. No earlier full-suite verdict is claimed for this commit.

Dependency setup, before the candidate advanced (the lockfile did not change):

```text
$ npm ci
added 196 packages, and audited 197 packages in 14s
found 0 vulnerabilities
(exit 0; deprecation and install-script policy warnings)
```

Final-candidate checks, on a clean tracked and untracked tree:

```text
$ git rev-parse HEAD
98fdca2eacf28422347b5af375496f10791dc6bb

$ npm run lint
> biome check .
Checked 1300 files in 650ms. No fixes applied.
(exit 0)

$ npm run typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)

$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
(no output, exit 0)

$ npx vitest run test/version-sensitive.test.ts
Test Files  1 passed (1)
Tests       5 passed (5)
Duration    456ms
(exit 0)

$ npx vitest list --filesOnly $(grep -Ev '^[[:space:]]*(#|$)' test/version-sensitive.txt)
(70 test paths, exit 0)
```

**Proven omission probe:** temporarily removed only `test/evals/run-cell` from the final list. The guard rejected exactly that omitted real caller:

```text
FAIL test/version-sensitive.test.ts:106
Received: ["test/evals/run-cell.test.ts"]
Test Files  1 failed (1)
Tests       1 failed | 4 passed (5)
(exit 1)
```

Restored the list byte-for-byte, then ran the guard again:

```text
$ npx vitest run test/version-sensitive.test.ts
Test Files  1 passed (1)
Tests       5 passed (5)
Duration    411ms
(exit 0)
$ git status --short
(no output before writing this review)
```

At the preceding candidate, the same probe also rejected omission of `scheduler/preload-refresh`, a helper-backed caller; that list was likewise restored. The intentionally modified-list failures are probe results, not candidate failures. Squeal also reported the final probe's FAIL and recovery after restoration. No probe remains in the tree.

### Candidate CI

`gh run view 38781585188 --repo hearsay-tools/squeal --json headSha,status,conclusion,event,url,jobs` confirms a push run of the exact final candidate:
<https://github.com/hearsay-tools/squeal/actions/runs/38781585188>.

Final run conclusion: **failure**. All four intended test jobs ran; `nightly` and `version` were skipped as required.

| Job | Conclusion | Test step | Job time |
| --- | --- | --- | --- |
| Node 22 (1/3) | success | 382 s | 423 s |
| Node 22 (2/3) | failure | 479 s | 507 s |
| Node 22 (3/3) | success | 378 s | 412 s |
| Node 24 subset | success | 117 s | 162 s |

The completed jobs total **25.07 job-minutes**, excluding queue time. All three shard Test steps were under nine minutes (longest 479 s). This is this run's G3 measurement, not row 010-20's three-day result.

**Proven CI failure, underlying cause unverified:** shard 2 failed only the unchanged `test/harness/opencode-dispose.test.ts`, “serve: an abort of the new turn, then the old Stop's answer, stores nothing”. Its completed log (`gh api repos/hearsay-tools/squeal/actions/jobs/116583361913/logs --allow-escape-sequences`) records the same timing-barrier failure as 010-11:

```text
Error: before the new turn's request, the plugin killed the held Stop at +2410,
at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +70, dispose +186,
input +1049, kill +2410; the held Stop's deadline: +2000
attempt 1 of 3 missed its barriers: kill +2323, deadline +2000
attempt 2 of 3 missed its barriers: kill +2365, deadline +2000
Test Files  1 failed | 211 passed (212)
Tests       1 failed | 1788 passed | 2 skipped (1791)
Duration    478.33s
```

There is no delta in that test or its held-stop, real-host and OpenCode helper paths. These are missed timing barriers, not an observed stale-store write; this run alone does not establish their underlying cause. The first review and `status.md` already triaged this path outside the workflow repair. Its recurrence does not reopen B1, but red CI still needs the coordinator's landing-policy handling; `status.md` explicitly sends a second red to a board row. No rerun was requested.

**Proven, wider Node 24 job:** completed successfully on Node v24.21.0. The uv step and installation of both Pythons succeeded; `test/scheduler/idle-pass.test.ts` ran and passed (8,035 ms), rather than skipping its pytest branch. Build and bundle drift steps passed too. Its completed job log (`gh api repos/hearsay-tools/squeal/actions/jobs/116583362483/logs --allow-escape-sequences`) records:

```text
Test Files  70 passed (70)
Tests       444 passed | 2 skipped (446)
Duration    115.63s
```

The two skips are the optional Bun comparison in `harness/opencode/bridge-client` and the Codex case with no shipped `bin/` in `e2e/shipped-plugin`, not missing pytest prerequisites.

The Test step's API timestamps span 117 s (18:01:42 to 18:03:39 UTC); the whole job spans 162 s (18:01:04 to 18:03:46 UTC), excluding queue time.

**Proven, superseded-run cancellation:** `gh run view 38781124001 --repo hearsay-tools/squeal --json headSha,status,conclusion,jobs` reports `headSha: 877c1afede97ac314128e4174ebad0e0179a60ac`, `status: completed`, `conclusion: cancelled`. All four candidate test jobs are cancelled; nightly and version are skipped. The Node 24 job never reached its Test step there. This is D3's intended handling of a superseded candidate, not a verification failure of the final candidate.

## Verdict

**PASS 98fdca2eacf28422347b5af375496f10791dc6bb**. Zero blockers, zero should-fix items, one proven nit. B1, S1 and N1 from 010-11 are closed.

## Blockers

None.

## Should-fix

None.

## Nits

### N2. Proven: the exemption introduction still describes run-cell as Node 22 only

Location: `test/version-sensitive.txt:43`.

The sentence “run-cell reads only `node --test`'s exit code. Node 22 only” survived removal of `run-cell.test.ts` from the exemptions. The actual entry selects it on Node 24, and lines 77 to 82 now correctly say the ground-truth callers are listed. Delete the obsolete clause when next touching this header. This does not affect execution or reopen B1.

## What fits

- **Proven, B1 closed:** the actual 70-path Vitest listing includes every one of the first review's 14 omitted callers. It also includes `daemon/composite-runner`, `daemon/died-startup`, `evals/teardown` and both scheduler warm-up files from the repair audit.
- **Proven, B1 eval audit:** `evals/run-cell` and all seven other importers of `test/evals/fake-cell.ts` are selected: `a8-load-hold`, `atomic-turns`, `kill-running`, `nested-evidence`, `retry-cell`, `retry-knobs` and `surviving-link`. This includes the callers that reach `evals/bin/run-cell.mjs:325` and the real `node --test` in `evals/lib/session.mjs:304`; no exit-code exemption remains. Selecting the dry-run-only importers too is harmless extra coverage.
- **Proven, guard:** all five guard tests pass. The direct-version-read and stale-entry checks remain; the new relative-TypeScript-helper scan reaches a fixed point. The omission probes discriminate both a helper-backed original B1 caller and the newly added eval caller. The 32 remaining exemptions name policy, setup, primer, recorded-report or timer tests rather than real node:test executions. Apart from N2, their rationale matches their sources.
- **Proven, named blind spot:** the scan reads only TypeScript under `test/`; it cannot follow `fake-cell.ts` through the `.mjs` ground-truth runner. The header explicitly requires adding future `fake-cell.ts` importers and `groundTruth` callers by hand, and the current callers are selected. This is a documented maintenance limit, not a claim that the guard discovers arbitrary execution paths.
- **Proven, Node 24 prerequisites:** `node24` installs uv 0.12.2 and Python 3.10/3.13 before the subset, matching the full-suite setup. `scheduler/idle-pass.test.ts:106` synchronizes pytest and at line 128 requires an actual `pytest.run`, so merely adding a selection path would not suffice.
- **Proven, S1 closed:** `.claude/skills/coordinator/SKILL.md:50` confirms the pushed SHA with `gh run list --workflow ci.yml --commit <sha>`, allows a few seconds for the run to appear and retains dispatch fallback. It can no longer accept an older SHA's run. `.agents/skills/coordinator` resolves to that same skill.
- **Proven, N1 closed:** `test/e2e/plugin-copy` is absent from both the entries and actual selected paths, matching amended D4. It remains in the full Node 22 and nightly suites.

## Inputs for the next wave

- Keep the hand-maintained ground-truth caller list current, or make its discovery automatic in a later task if it changes often. No additional implementation is required by this review.
- Resolve or name the recurrent `opencode-dispose` red under the landing policy before landing; it is not a defect finding against this narrow repair.
- The first main landing's `version` range, the first actual nightly and row 010-20's three-day measurements remain outside this narrow re-review. Prior conclusions outside the delta are not reopened.
- No GitHub mutation, CI rerun or push was made. The coordinator owns integration and landing.
