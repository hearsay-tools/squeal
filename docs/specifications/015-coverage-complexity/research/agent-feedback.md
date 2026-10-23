# 015-03: coverage, complexity and CRAP as feedback to developers and agents

Researcher for row 015-03, 2026-10-23. Brief: `agent-feedback-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, 011 C5 and C6, 005 goals, `../status.md`. Two notes from the coordinator during the work: the human, 2026-10-23, "the code can squeal as well, not just tests", is a reading under serious consideration, not a decision (`../status.md`, open question 1). It reads complexity and CRAP as a check type of their own, with a state per function, transitions and revision provenance. Questions 4 and 5 answer for that reading too, and "Feasibility of the check-type reading" tests it on cost, correctness, noise and identity.

Versions: Squeal at `f6f44e030`. Sources were fetched on 2026-10-23 with curl (WebFetch is blocked on this host) and are listed at the end with the version each page shows. Probes: `probes/agent-feedback/` (throwaway; README there). No timing of tests was run: the brief's questions need none. The probe's own parse took 4.9 s for 156 file versions, load 28.98 on 24 CPUs.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Peers for developers | Every peer that notifies, except Coveralls, offers a notice scoped to changed code: Codecov patch status, diff-cover, SonarQube's new-code gate, CodeScene's "New and Changed Code" gate and its decline alerts. Project totals are a separate, relative status (Codecov project `target: auto`) or a report. PHPUnit's CRAP report and Wallaby's gutter only show; they never notify. | read in official docs, read in source code |
| 2 | Evidence for agents | Strong for one task: coverage in the prompt when the task is to write tests (CoverUp, peer-reviewed). There, coverage information added at most 2 % coverage; error feedback added 14 to 37 %. Industrial reports use coverage as an acceptance filter, not as feedback (TestGen-LLM). Coverage spectra helped repair a little and confounded (AutoCodeRover, 19 % to 22 %). Complexity feedback to agents has only a vendor benchmark scored on its own metric (CodeScene). No source studies coverage or complexity feedback pushed to an agent during feature work. | read in official docs (papers) |
| 3 | Harm | Documented: assertion-free tests that raise coverage (TestGen-LLM rejected one; CodaMosa's tests had none), tests of trivial or unimportant code, near-duplicate tests, and valuable tests a coverage filter would discard (ACH: 277 of 571). Needless refactoring and task widening: not determined from the named sources. Peers counter with changed-code scope, minimum sizes, relative targets, per-test gain, visible suppression, and "the percentage alone does not finish the review". | read in official docs; task widening: inferred |
| 4 | Transitions | On this repository's last 100 commits (one day, 25 touching `src/`): a touched function crossing CRAP 30 fires in 8 commits at 0 % coverage, 4 at 50 %, 0 at 80 % or more. A file-level stand-in for "no test runs it" never fires (all 45 changed `src/` files are reached by a test), so that signal needs per-function coverage. As a per-function check type, HEAD already holds 1,143 functions at CC ≥ 5, 192 at ≥ 12, 18 at ≥ 30: standing failures a registration would list. Patch coverage and totals are state for pull. | verified by experiment (proxy); limits stated |
| 4b | Can the code squeal (check type)? | Feasible for CC with conditions; not yet shown for CRAP. CC costs about 3 ms per file and is a pure function of the file's text. CRAP is correct only once every test that covers the function has a current result. Noise holds only if the 192 to 1,143 standing functions never count as failures. Identity by name breaks on moves: 39 of 113 "new" functions were moves or renames. | verified by experiment (cost, noise, identity); correctness inferred |
| 5 | Policy | Thresholds, scope and exclusions are always project-set. Defaults: Codecov target relative to base; SonarQube 80 % new-code coverage, ignored under 20 new lines; CodeScene gates new and changed code only; CRAP threshold 30 in php-code-coverage but 50 in PHPUnit's configuration. Quiet on untouched code comes from scope (diff against base or last commit), not from a smaller threshold. | read in official docs, read in source code |

## Findings

### 1. Peers for developers

| Peer | Shows | Scope | What triggers a notice |
|---|---|---|---|
| Wallaby (v3 docs) | Gutter square per line: gray (not covered), yellow (partly), green, pink (on a failing test's path), red (error source) | Line, in the editor | Nothing; it shows. Agents pull through skills and MCP tools (`wallaby_coveredLinesForFile`, `wallaby_coveredLinesForTest`) |
| Codecov (docs v2023) | `codecov/project`, `codecov/patch`, `changes` statuses; PR comment | Project vs base; "only measures lines adjusted in the pull request or single commit"; unexpected coverage changes outside the diff | A commit status that fails below target |
| Coveralls | Commit status, notifications | Project | Fails "if the coverage is below the threshold, or if the coverage decreases by more than the threshold"; both thresholds optional. A patch scope was not found in the pages fetched |
| diff-cover (README, main) | Lines of the diff without coverage; `diff-quality` for linter violations | Diff against `origin/main`; staged and unstaged included, untracked ignored | Exit code when below `--fail-under` |
| SonarQube Server (2026.5 LTA) | Quality gate; on a PR "only the quality gate conditions applying to new code are used" | New code | Gate fails. Since 2026.5 also "Sonar way for agentic AI" and Sonar Vortex, which checks agent code "as it is produced" |
| CodeScene (cloud docs) | Code Health 1 to 10 per file; virtual code review; coverage gates | File; PR diff against merge base; in a build, the last commit | Gate fails on a health decline or uncovered new and changed lines; alert when a file declines by at least 0.1 versus the past year. MCP tool `code_health_review` for agents |
| PHPUnit 11.5 / php-code-coverage | CRAP per method in the HTML and Crap4J reports | Method | Nothing; the Crap4J report counts methods at or above the threshold |

CRAP in php-code-coverage (`src/Node/CrapIndex.php`, main at `e61991d1`, 2026-10-17): CC² + CC at 0 % coverage, CC² × (1 − cov)³ + CC otherwise, and plain CC at 95 % or more. So at threshold 30 an uncovered function fails at CC 5, a half-covered one at CC 12, one 80 % covered at CC 25, and a covered one only at CC 30. read in source code.

### 2. Evidence for agents

| Source | Claim | Measure | Strength |
|---|---|---|---|
| CoverUp, FSE'25 (arXiv 2403.16218v4) | Uncovered lines in the prompt plus iterative feedback raise coverage | Per-module median line+branch 80 % vs CodaMosa 47 % | Peer-reviewed benchmark. The ablation weakens the coverage part: removing coverage information cost "up to 2 %", removing error fixing 14 to 37 %. Without coverage the model needed 11,222 test functions instead of 7,366 for nearly the same result: coverage saves work, it does not add much result |
| CodaMosa, ICSE'23 (repository README) | Ask an LLM for a test when search-based generation hits a coverage plateau | Coverage | Peer-reviewed. Read through its README and CoverUp's comparison only |
| TestGen-LLM at Meta, FSE'24 (arXiv 2402.09171) | Filters (builds, passes 5 of 5 runs, adds coverage) make LLM tests safe to review | 75 % built, 57 % passed, 25 % added coverage; 73 % of recommendations accepted | Industrial report, no control group. Coverage is an acceptance filter after generation, not feedback during it |
| ACH at Meta, FSE'25 industry (arXiv 2501.12862) | Generate tests against mutants of a concern, not against coverage | 73 % of tests accepted; 49 % of mutant-killing tests add no line coverage | Industrial report. Evidence against coverage as the target |
| AutoCodeRover, ISSTA'24 (arXiv 2404.05427v3) | Spectrum-based fault localization (from which tests pass and fail over which methods) helps an issue-solving agent | SWE-bench lite 57 to 66 of 300 resolved | Peer-reviewed, one benchmark. The setting adds both the top-5 suspicious methods and test-suite patch validation, so the 9 tasks are not the coverage hint's alone (inferred) |
| CodeScene benchmark (blog, MCP docs) | Claude Code guided by Code Health feedback refactors better | "2–5x more improvements in Code Health" | Vendor post. The outcome is the same metric the agent was given; correctness numbers are not shown |

No named source measures what Squeal would do: tell an agent mid-task that code it just changed is uncovered or complex. That gap is the main finding. inferred, from the sources above.

### 3. Harm

- Assertion-free tests: TestGen-LLM had a diff rejected because it "did extend coverage (simply by executing the previously unexecuted method-under-test)" but "failed to contain an assertion". CoverUp reports that "the tests CodaMosa generates do not contain any assertions". CoverUp's prompt says "Be sure to include assertions". read in official docs (papers).
- Low-value tests: TestGen-LLM withdrew 2 diffs that "added coverage, but ... the files covered were unimportant", and rejected tests of a getter. Four "only superficially different" tests led to a per-test coverage guarantee. read in official docs.
- The filter itself harms: ACH says 277 of its 571 tests "would have been discarded had we chosen to focus solely on the line coverage test adequacy criterion". read in official docs.
- Complexity: CodeScene's agent benchmark rewards its own score (Goodhart by design). CodeScene answers suppression abuse with visible directives: `@codescene(disable:...)` per function, shown as "a non-blocking warning", and new directives listed in the PR summary. read in official docs.
- Task widening: no named source measures an agent leaving its task to fix coverage or complexity elsewhere. The peers act as if it happens: CodeScene calls the overall coverage gate "less actionable, and might be noisy in a PR context"; SonarQube ignores coverage "until the number of new lines to cover is at least 20". inferred.
- What peers do: changed-code scope (all notifying peers), a minimum size (SonarQube's fudge factor), relative targets (Codecov `auto`), per-test gain (TestGen-LLM), informational mode (Codecov `informational`), and the agent rule in Wallaby's skill: "Coverage helps select candidates, but a higher percentage alone does not finish the review". read in official docs.

### 4. Transitions

Proxy (`cc-proxy.mjs`, `reach.mjs`): the last 100 commits to `f6f44e030`, all authored 2026-10-23 between 10:51 and 21:52 by parallel coordinators and workers. 54 are docs; 25 touch `src/`. Those 25 touched 207 functions (113 new): 5 per commit at the median, 19 at p90, 33 at most. CC of the touched functions: median 2, p90 12, max 69. verified by experiment.

| Signal | Changes on an edit, actionable at once? | Fire rate in the proxy | Push or pull |
|---|---|---|---|
| A changed or new function that no test runs | Yes: the edit's own run decides it, and the agent can add a test now | File level: never (563 of 600 `src/` files are reached by some test; all 45 changed ones are). Function level: not determined here; it needs 015-01's per-function coverage | Push candidate, touched functions only |
| A touched function crossing CRAP 30 | Yes, if coverage per function is known at the edit | 0 % cov: 16 crossings in 8 commits (14 of them new functions with CC 5 to 8, one a moved function). 50 %: 5 in 4 (all existing functions rising to CC 12 to 14). ≥ 80 %: 0 | Push candidate; rare |
| A touched function already above 30 | No: it was so before the edit | 6 functions in 5 commits at any coverage (`selectTier` CC 70 → 69, `recordTier` transaction 55 → 54, `baseline` 37 twice) | Pull |
| Patch coverage of the diff since base | Only at a checkpoint; a ratio over many edits | Once per checkpoint | State; a push only when a project policy flips |
| Project coverage, project CRAP, CC totals | No | Every run | Pull only |

For the per-function check type (the human's reading), mapped to 011 C5 (inferred unless tagged):

- First-seen fail = a new function above the threshold: 14 of 113 new functions at 0 % coverage, 0 at 50 %. A pass → fail is an existing function crossing; fail → pass a refactor or a new test below it.
- Standing failures: at HEAD, `src/` has 6,964 functions: 1,143 at CC ≥ 5, 309 at ≥ 10, 192 at ≥ 12, 117 at ≥ 15, 18 at ≥ 30, in 148 files at ≥ 12. verified by experiment. C5 seeds every known failure into a registration's "Known failures" header. At any threshold above, that list would bury test failures, so these failures need a baseline that is never counted with test failures, as peers do with "new code".
- Fingerprint: 3 of the 6 touched functions above 30 changed CC by one (70 → 69, 55 → 54). If the number were in the fingerprint, each would be a `fail -> fail` changed-fingerprint notice for an improvement.
- Identity: the probe names a function by file, class chain, name and occurrence. A rename reads as a removal plus a new function, and anonymous callbacks get names like `createDelivery.deliver.store.transaction(cb)`. The key would join the function's text with the keys of the tests that cover it, since CRAP moves when either changes.

What the proxy misses: coverage (assumed uniform, so the crossing counts are bounds per assumption); revisions within a commit, where a function can cross and cross back (a commit is many saves, so per-revision counts can be higher and per-commit counts are a floor); tool differences in CC (`??` and `case` counting vary); renames; files outside `src/`; and one day of a docs-heavy mix (54 of 100).

### Feasibility of the check-type reading

The human's reading: a function is a check, it has a known state against a threshold, and C5's transitions apply. Each part, tested where a probe could test it:

| Part | Holds? | Evidence |
|---|---|---|
| Cost of CC | Holds | Parse and CC of all 600 `src/` files (3.49 MB, 6,964 functions) took 1.6 to 2.0 s over five runs at load 57 on 24 CPUs: about 3 ms per file. An edit re-parses only its files. verified by experiment (TypeScript 5.9.3 parser) |
| Cost of coverage | Open | CRAP and "no test runs it" need coverage from runs Squeal makes anyway; its cost per run is 015-01's question |
| Correctness of CC | Holds, with one caveat | CC is a pure function of the file's text, so it can be keyed by content like a result and inherited across worktrees (inferred). Tools disagree on what counts (`??`, `case`, boolean chains), so the number must name its rule |
| Correctness of CRAP | Holds only when complete | A function's coverage is the union over every test file that runs it. After an edit, the edit's own files run first (011 C4) and the rest later, so a CRAP computed earlier reads too high: a false fail. It is current only when every test file whose closure holds the function has a result at its key, else `pending` (inferred from 011 C3 and C4). Tests Squeal does not run (`test/e2e/**` here, slow tests a project excludes) never count, so their functions read uncovered. 37 `src/` files, the harness entries, are reached by no test through imports; tests reach them through built `dist/` bundles, and coverage of a bundle maps back to `src/` only through source maps (inferred; 015-01 can test it) |
| Noise | Holds only with a baseline | 1,143 functions at CC ≥ 5, 192 at ≥ 12, 18 at ≥ 30 stand at HEAD (finding 4). Seeded as C5 known failures they would bury test failures. With "only a new or touched function can fail", the proxy fires in 0 to 8 of 100 commits |
| Identity across edits | Partly | By file, class chain, name and occurrence (the probe's id): of 113 functions that read as new, 33 have an identical body removed in the same commit (moves, `7351f8d41` "the focus helpers move", `9595aa284` "the record of an ended run leaves scheduler") and 6 more share a removed name. One of them, `TierRecords.#prepare` at CC 8, is a false first-seen fail at 0 % coverage. 72 of the 207 touched ids name a callback by its call text (`createDelivery.deliver.store.transaction(cb)`), which changes when the call is edited. A body-hash fallback recovers the 33 identical moves; a function moved and edited in one revision stays lost. verified by experiment |

Verdict: a per-function CC check is feasible in cost and correctness today. It is quiet only with changed-code scope, and it needs identity rules for moves and callbacks. A per-function CRAP check is feasible only if its state can be `pending` until every covering test file has run, and if coverage maps bundles back to sources. Whether coverage is cheap enough is 015-01's answer. A per-file check, one state per file listing its failing functions, avoids most identity loss (files move less than functions) but makes the fingerprint change on every edit to any listed function (inferred).

### 5. Policy

| Peer | What the project sets | Defaults | Quiet on untouched code by |
|---|---|---|---|
| Codecov | `target` (auto or a number), `threshold` (allowed drop), `paths`, `flags`, `branches`, `informational`, `only_pulls`, `if_ci_failed`, `flag_coverage_not_uploaded_behavior` | `target: auto` (base commit); `informational: false`; `only_pulls: false`; `if_ci_failed: error`; the patch example sets `threshold: 0%` | Patch status counts only adjusted lines; flags exclude unrelated projects |
| Coveralls | Coverage threshold for failure, decrease threshold | Unset | Not found |
| diff-cover | `--compare-branch`, `--fail-under`, `--exclude` (fnmatch), `--ignore-staged`, `--ignore-unstaged`, `--include-untracked` | `origin/main`; staged and unstaged in, untracked out. The `--fail-under` default is not stated in the README | Only diff lines count |
| SonarQube | Gate conditions on new or overall code; fudge factor per project; new code definition | Sonar way: no new issues, 80 % new-code coverage, ≤ 3 % new duplication; fudge factor on (20 lines). The default new code definition was not on the pages fetched | PRs use new-code conditions only |
| CodeScene | `.codescene/code-health-rules.json`: rules per path glob, thresholds such as `function_cyclomatic_complexity_warning`; gate thresholds in the UI; exclusion filters; profiles that guard hotspots only | New and Changed Code coverage gate on, overall gate off; decline alert at 0.1. Per-language default thresholds sit in a zip that was not read | Diff against merge base, or the last commit in a build; decline, not level |
| PHPUnit / php-code-coverage | `<crap4j threshold>`, `<html lowUpperBound highLowerBound>`, `<include>` source | Crap4j threshold 50 in the configuration docs, but 30 in `Crap4j.php`'s constructor; coverage bounds 50 and 90 | Not applicable; reports only |
| Wallaby | Coverage settings; for the agent skill, a target and a criterion | `improve` without a target reviews files at or below 95 % coverage | Agent asks for a scope (file, directory, git change set) |

The two CRAP defaults disagree (30 vs 50). The configuration docs decide what a PHPUnit user gets; the library default decides what a direct caller gets.

## Recommendation for Squeal

1. Pull first. Per-function coverage, CC and CRAP belong in status and an on-demand query, the way Wallaby gives them to agents. No source shows that pushing them helps an agent during feature work (finding 2). The one strong effect is for writing tests, where coverage saves work more than it adds result.
2. Push at most two transitions, both limited to functions the agent touched since its base: a touched function that no test runs, and a touched function crossing the CRAP threshold. On this repository the second fires in 0 to 8 of 100 commits, depending on coverage (finding 4), so it stays rare. A function that was already above the threshold, patch coverage and totals stay pull (findings 1 and 4).
3. The code can squeal for CC with three conditions: the standing set never joins "Known failures" (192 to 1,143 functions here), only a new or touched function can fail, and identity survives moves (a body-hash fallback; 39 of 113 "new" functions were moves or renames). CC stays out of the fingerprint, so an improvement is no news. For CRAP, add a fourth: its state is `pending` until every test file that covers the function has a current result, or it fails falsely after each edit.
4. Word a push as evidence, not a target: the function, its CC, its coverage and which tests run it. Never a percentage to reach, and nothing that rewards a test without assertions (finding 3).
5. Project policy sets the threshold, the paths and a visible suppression. Pick the default threshold knowingly: 30 (crap4j and php-code-coverage) or 50 (PHPUnit's configuration). Quiet comes from changed-code scope, which every notifying peer but Coveralls offers (finding 5).

## Open questions

1. How often does a touched function really have no test running it? That needs 015-01's per-function coverage over the same commits; the file-level proxy says never.
2. What is "touched": since the session's registration, since the merge base, or since the last commit (CodeScene's build mode)? It decides how quiet the push is across long sessions.
3. Does a push about an untested function make agents write assertion-free tests? No source measures it for coding agents. It could be measured with the 006 evals, which run only when asked for.
4. Is the human's "code can squeal" one check per function, or one check per file listing its functions? It changes identity, the fingerprint and how a rename reads.
5. Does V8 coverage through the built `dist/` bundles map back to `src/` functions? If not, every harness entry reads uncovered. 015-01 can test it.

## Sources

- Codecov, Status Checks (docs v2023, "Updated 12 months ago"): https://docs.codecov.com/docs/commit-status
- Coveralls, App notifications: https://docs.coveralls.io/app-notifications
- diff-cover README, main on 2026-10-23: https://raw.githubusercontent.com/Bachmann1234/diff_cover/main/README.rst
- SonarQube Server 2026.5 LTA: quality gates https://docs.sonarsource.com/sonarqube-server/latest/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates/ ; agentic AI gate https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/ai-code-assurance/quality-gate-for-agentic-ai ; agentic capabilities https://docs.sonarsource.com/sonarqube-server/agentic-capabilities
- CodeScene docs: Code Health https://codescene.io/docs/guides/technical/code-health.html ; coverage gates https://codescene.io/docs/guides/code-coverage-gates/check-code-coverage-in-pull-and-merge-requests.html ; PR integration https://codescene.io/docs/guides/pr-integration/integrate-into-ci-cd.html ; MCP server https://codescene.io/docs/developer-tools/mcp/codescene-mcp-server.html ; benchmark post https://codescene.com/blog/making-legacy-code-ai-ready-benchmarks-on-agentic-refactoring ; default thresholds page https://helpcenter.codescene.com/articles/6084507-what-are-the-default-threshold-values-for-different-programming-languages
- PHPUnit 11.5: https://docs.phpunit.de/en/11.5/code-coverage.html , https://docs.phpunit.de/en/11.5/configuration.html ; php-code-coverage main `e61991d1` (2026-10-17): `src/Node/CrapIndex.php`, `src/Report/Crap4j.php`, `src/Node/File.php`
- Wallaby v3: https://wallabyjs.com/docs/features/coverage/ , https://wallabyjs.com/docs/features/ai/
- CoverUp https://arxiv.org/abs/2403.16218 (v4, HTML full text); TestGen-LLM https://arxiv.org/abs/2402.09171 (v1); ACH https://arxiv.org/abs/2501.12862 (v1); AutoCodeRover https://arxiv.org/abs/2404.05427 (v3); CodaMosa https://github.com/microsoft/codamosa (README)
- Probes: `probes/agent-feedback/cc-proxy.mjs`, `reach.mjs`, outputs `cc-proxy-out.json`, `reach-out.json`, `standing-out.json`
