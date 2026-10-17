# Wave 3 review: issue intake (010-30, review row 010-31)

## Verdict

PASS `c42b725f1b63fd8c88e75c4b827f7866edfac609`: **0 blockers, 1 should-fix, 0 nits**.

Range: `379517ae..c42b725f`. HEAD matched the supplied candidate and the tracked tree was clean throughout verification. No `src/`, plugin bundle or package version change. This review uses D12's approved replay amendment in main commit `530c1a623bddde5cb6a8d749c00d99e0d808678f`, confirmed from GitHub, as directed by the coordinator during review. The candidate itself stayed pinned.

## Independent verification

Environment: Node `v24.21.0`, npm `11.19.0`. Command output below (routine dependency notices omitted).

```text
$ git rev-parse HEAD
c42b725f1b63fd8c88e75c4b827f7866edfac609
$ git status --short
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 9s
found 0 vulnerabilities
(exit 0; npm also reported a deprecation notice and six dependency install-script notices)

$ npm run lint
> squeal@0.1.213 lint
> biome check .
Checked 1427 files in 516ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.213 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.213 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.213 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)

$ git status --short
(no output)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/68718d37-1985-4a0b-82ab-667732d33f0d

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/68718d37-1985-4a0b-82ab-667732d33f0d/test/fixtures/scheduler/.tmp/61b37e2e-331d-47b9-a9c0-bcf914866fd1/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/68718d37-1985-4a0b-82ab-667732d33f0d/test/fixtures/scheduler/.tmp/96503eac-9972-4daf-9d86-c81ceee1c044/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 3785698
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  711 passed | 1 skipped (712)
      Tests  6059 passed | 10 skipped (6069)
   Start at  23:10:39
   Duration  858.29s (tests 98%, import 2%)

    Isolate  712 workers spawned · ~141ms startup each (spawn + environment, per file)
             at least ~24.91s faster with isolate: false — reuses workers across files instead of one per file
(exit 0)
```

Candidate CI [39069764336](https://github.com/hearsay-tools/squeal/actions/runs/39069764336), checked at the pinned SHA: **success**. Node 22 shards 1/3, 2/3 and 3/3 and Node 24 all succeeded; version and nightly were skipped as expected. This CI run checks the scripts and workflow contracts; the new opened-issue workflow was not exercised against a live issue by this review.

The Vitest run above is this reviewer's independent host-locked run, not the coordinator's 711-file gate or a Squeal checkpoint. All checks ran before writing this findings file. The build produced no tracked drift. No product files were edited and the throwaway probes used stdin or temporary directories outside the tree.

### Checks specific to this diff

- GitHub's official REST schema for `GET /repos/{owner}/{repo}/issues` defines `since` as: **"Only show results that were last updated after the given time."** Source: [GitHub REST API description](https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.json), the operation's `since` parameter. It filters `updated_at`, not `closed_at`.
- The workflow fetches `closed_at`; `buildCandidates` filters it at `.github/scripts/issue-intake-candidates.cjs:88`. The Jev CLI and the writer's uncapped rebuild use the same function. A stdin probe supplied #5 closed September 1 but updated October 17, and #6 closed October 16, at October 17 noon. Output: `[{"number":6,"open":false}]`. A recent update cannot admit an old close. The suite also pins the 30-day boundary, one second before it, and the closed flags.
- Executed the final workflow shell block with a temporary `gh` stub, without any real mutations. OPEN: exit 0, exactly `issue edit 99 --repo hearsay-tools/squeal --add-label needs-triage`. CLOSED: exit 0, no mutations. The apply job and that last step both use `always()`; neither checkout nor the artifact is required by that last step. Jev failure skips only the three success-guarded apply steps.
- `gh issue close --help` on this host confirms `--reason duplicate` and `--duplicate-of` are supported. Close plans add `duplicate` before closing and name the original in the comment; closed picks and closing-off picks only comment and apply labels.
- The offline replay fixture distinguishes #8 closing #7 (same-row bucket) from #31 closing #7 (wrong close). `sameRow` intersects actual board row IDs, so sharing an area alone cannot excuse an unrelated pick. The committed live report lists #8 under its own line and table entry. With the approved amendment this is conformant, not a blocker.

## Blockers

None.

## Should-fix

### S1. Proven, nonblocking: a partially recorded replay silently omits unasked issues

**Location:** `.github/scripts/jev-intake-replay.cjs:122` and `.github/scripts/jev-intake-replay-report.cjs:42` (also the report entry point at `.github/scripts/jev-intake-replay.cjs:221`).

**Scenario and evidence:** `ask` saves each answer as it completes, so an exhausted provider retry can leave a partial `answers.json`. `evaluate` skips every issue without a cached answer; `report` then renders a normal result whenever even one row exists. The heading names the full corpus size and the missed-duplicate line only examines evaluated rows. A stdin probe with a two-issue corpus (#6 and its known duplicate #30), but an answer only for #6, returned:

```text
{"corpus":2,"evaluated":1,"missing":30,"missedDuplicates":[]}
Generated by `node .github/scripts/jev-intake-replay.cjs report` (row 010-30, spec 010 D12). Corpus fetched 2026-10-17T20:00:00Z from hearsay-tools/squeal: 2 issues.
- Board duplicates Jev missed: none.
```

D12 uses the replay as the evidence before enabling closes. A resumed or interrupted future replay should distinguish unasked issues from evaluated negatives. The current committed report has all 32 issue rows, so this does not invalidate its result or block this candidate.

**One-worker fix:** keep scoring completed rows if useful, but compare answered issue IDs with the corpus in `report`; print `evaluated N of M` and list pending IDs, and clearly mark the report partial (or refuse a final report until complete). Add an offline regression where #30 has no answer and ensure it is shown as pending rather than allowing an unqualified complete replay. No new Jev calls, threshold changes or workflow changes are needed.

## Nits

None.

## What fits

- **Permissions and injection reach:** only `apply-intake` holds `issues: write`. The Jev job has read access and only the TypeSafe secret; the writer has no provider secret. Both checkouts disable persisted credentials and all actions are pinned. Issue text is read from JSON, never interpolated into shell source. The provider endpoint is fixed and the model has no tools. Choice mapping rejects unoffered labels/candidates and generates its own evidence text; the writer validates the artifact schema, checks repository labels and rebuilds candidate membership before mutations. Commands execute as argument arrays. Injected issue text can influence a classification or duplicate choice, but this path gives it no command execution or arbitrary write interface. Unsupported bot actors are rejected before the billable call, while fallback triage still runs.
- **Module seams:** context generation writes the files Jev reads; the uploaded `intake.json` is the file the writer loads. `candidateOpen` is a `Map<number, boolean>` in both the workflow and replay, and the planner receives the explicit closing flag. Closed candidates cannot produce close commands. Self, split-parent, epic and pull-request exclusions are shared; Jev's choice cap is 254 plus `none`, while the trusted membership check is uncapped.
- **D12 labels and trigger:** one code-owned area and at most one type are mapped at the inherited thresholds. Only exact repository-variable value `true` enables closing. The fallback reads current state and labels every still-open issue when earlier steps fail; a successful close gets no triage label.
- **Replay truth and tests:** areas come from actual `gh-N to NNN-MM` board routing and code-owned spec descriptions. The three explicit duplicate verdicts are board-backed; no model labels define truth. Candidate state is reconstructed at issue opening. The live report records all 32 issues, 15/19 routed areas right, four wrong areas, two right closes, one same-row close requiring the human's judgment, one right comment and one wrong comment. Type labels are not scored. The six new test files are collected by Vitest and cover mapping thresholds, malformed output, candidate exclusion/window rules, mutation plans, workflow guards, HTTP failure handling and offline replay scoring. The report is live-run evidence supplied by 010-30; this review did not make another billable replay.
- **Scope and style:** the CJS port and declaration files keep the existing upstream execution model, use no new dependency and leave product sources, bundles, versions and the existing CI workflow alone. The HTTP client and report renderer have separate responsibilities.

## Inputs for landing and the next wave

No blocking fix wave is required. S1 is one bounded replay-tool row for a later wave.

The coordinator must land the workflow and create labels before switching the cockpit trigger. Required labels: `bug`, `enhancement`, `documentation`, `duplicate`, `needs-triage`, `triaged`, `area-core`, `area-slow-suites`, `area-adoption`, `area-harness`, `area-runner`, `area-evals`, `area-ci`. Ensure `TYPESAFE_API_KEY` exists. Keep `ISSUE_INTAKE_CLOSE_DUPLICATES` unset until the human resolves the same-row #8/#7 question and elects to enable closing. Then move the cockpit automation from issue opened to the `needs-triage` label and add the D12 process line; triage must replace that label with `triaged`. Those external changes and process edits were explicitly outside 010-30's ownership and were not performed by this reviewer.

For later candidate changes, call `buildCandidates({ issue, openIssues, closedIssues, repo, now, max })` before Jev; preserve `closed_at` filtering even though GitHub is fetched with `since`. Before writes, rebuild uncapped and pass its number/open map to `planIntakeMutations` with current repository labels and the explicit closing flag. Preserve the unconditional, state-aware final fallback. Provider calls remain bounded to one shortlist call plus at most one recheck, 30-second request timeouts and at most four attempts per call. No threshold tuning is supported by this corpus. Replay corpus and recorded answers stay outside git; commit the report, with answered coverage made explicit if S1 is taken.
