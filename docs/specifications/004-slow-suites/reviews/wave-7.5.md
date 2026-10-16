# 004 wave 7.5: narrow re-review of the completion guidance repair

Reviewer: Codex, board row 004-64, 2026-10-16. Second and last round for this slice. Candidate: `cand/0.1.202`, pinned to `52bd2d2a9cbb64b223d556b6e1b797f634289111`. Range: `512eb255..52bd2d2a`, including repair `920828b6`, bundles `68cdaced` and the intervening docs. Scope: W3 of `tasks/wave-7.md`, closing B1 and S1 of `reviews/wave-7.md`. No re-review of the matters round one settled.

## Verification output

Installation, lint, typecheck, build and the six-file focused run below ran on Node `v24.21.0`, npm `11.19.0`, at the clean pinned candidate before writing this review. The temporary probe's tree state is noted separately.

```text
$ git rev-parse HEAD
52bd2d2a9cbb64b223d556b6e1b797f634289111
$ git status --short
(no output)
$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
exit 0
$ npm run lint
> squeal@0.1.202 lint
> biome check .
Checked 1352 files in 485ms. No fixes applied.
exit 0
$ npm run typecheck
> squeal@0.1.202 typecheck
> tsc --noEmit
exit 0
$ npm run build
> squeal@0.1.202 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.202 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0
$ git status --short
(no output)
```

`npm ci` warned about deprecated `node-domexception` and six packages whose install scripts are not covered by `allowScripts`. Installation and the build succeeded. All four committed plugin trees reproduce without drift, including the generated skill copies.

This review uses the dispatch's explicit allowance for focused tests plus the supplied coordinator gate for a narrow wording repair. **No independent full-suite run or Squeal full-suite checkpoint was taken.** The following is coordinator-reported evidence, not a full run reproduced by this reviewer:

```text
Coordinator gate at 68cdaced:
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Test Files  667 passed | 1 skipped (668)
     Tests  5691 passed | 10 skipped (5701)
Duration  810.49s
exit 0

Reviewer identity check:
$ git diff --exit-code 68cdaced 52bd2d2a -- src test evals plugins package.json package-lock.json
(no output)
exit 0
```

The independent focused run checks the revised text, all four harness forms, the cap, skill copies and budget, and the existing waiting and immediate-hold paths:

```text
$ npx vitest run test/harness/primer-slow-policy.test.ts test/harness/primer-coverage.test.ts test/harness/skill.test.ts test/harness/stop-require-slow.test.ts test/harness/stop-slow-wait.test.ts test/harness/pi/run.test.ts --maxWorkers=1
Test Files  6 passed (6)
     Tests  122 passed (122)
Duration  22.81s
exit 0
```

A temporary two-case probe additionally called Pi's `startRun`/`settle` and OpenCode's `register`/`stop` on isolated fixture repositories with the policy on, a 120000 ms slow wait, passing fast evidence and one queued slow file. In each case the emitted primer contains `Stop waits for them or holds you once.`, stays within 1500 characters, and the Stop call returns the policy hold without any slow result being supplied. The slow file remains queued.

```text
$ npx vitest run test/harness/reviewer-004-64.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  2 passed (2)
Duration  2.06s
exit 0
```

The temporary probe was removed. Only this review file is committed. The probe run used that additional uncommitted test file; it made no product changes.

## Verdict

**PASS `52bd2d2a9cbb64b223d556b6e1b797f634289111`: 0 blockers, 0 should-fix findings, 0 nits. B1 and S1 are closed.**

## Blockers

None.

## Should-fix

None within W3.

## Nits

None within W3.

## What fits

- **Proven, B1 closed:** `src/harness/shared/primer.ts:189` now says `Stop waits for them or holds you once.` This covers D9's waiting path and its immediate-hold fallback. `stop-require-slow.test.ts` checks both Claude Code and Codex without a recorded waiting entry, including the untrusted-hook case, and `stop-slow-wait.test.ts` checks the recorded entry waiting for results or holding at its bound. The Pi/OpenCode probe checks the no-waiting-entry fallback through their own public entry points. The repair changes prose and assertions, not enforcement.
- **Proven, both policy branches and all naming forms:** `primer-slow-policy.test.ts` exercises Claude Code, Codex, Pi and OpenCode through their entry points. On, each retains the before-done command, the every-current exception and the corrected ending; off, each states that the slow tier is not required, contains no before-done slow step and no `Stop`. All are within `PRIMER_CAP_CHARS` (1500). `primer-coverage.test.ts` also passes the long-path fallback under both values.
- **Proven, S1 closed:** skill step 4 at `plugins/claude-code/skills/squeal/SKILL.md:15` ends the required branch with a period and begins the other with `Without Stop waits` (the marker is code-quoted in the file). That explicit policy condition cannot attach to the inner `while`. The step is byte-equal in Claude Code, Codex and Pi; the generated copies reproduce from the canonical text plus their existing command prefaces.
- **Proven, budget with its existing scope:** the canonical skill is 4996 characters, below the 5000-character budget asserted by `test/harness/skill.test.ts:219`. Whole generated files are 5324 characters (Codex) and 5345 (Pi); stripping only their build-added command-preface paragraph yields the identical 4996-character canonical file. Those prefaces were already present at `512eb255` (whole-file lengths 5323 and 5344). No claim is made that the entire generated files are below 5000; this repair adds one character to each and preserves the existing canonical budget check.
- **Proven, bundle parity:** `npm run build` leaves the pinned tree clean. The changed bundles incorporate the shared wording and no independent runtime repair is introduced.

## Inputs for the coordinator

W3 is satisfied. This verdict covers the repair delta only, together with round one's settled coverage. The coordinator retains the landing decision. The full-suite result above is supplied evidence on byte-identical product files, not an independent reviewer full run. Node 22, macOS and model/eval behavior were not tested in this re-review.
