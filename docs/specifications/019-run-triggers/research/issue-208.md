# Issue 208: “untracked files” with a clean Git tree

Recommend clarifying commit-report provenance and exposing the existing path details before changing validation rules.

## Scope and verdict

**Controlled source-level reproduction: yes. Original incident cause: not determined.** Two controlled cases produce exactly `5 test files not determined (untracked files)` while `git status --short --untracked-files=all` is empty. The probe calls real Git, Squeal's comparison, tally, formatter, report storage and unchanged-HEAD handling. It supplies test closures, hashes and a minimal in-memory metadata store. It does **not** run a daemon, runner, harness or complete CLI status flow.

Reported version: **0.1.464**, release commit `2d68d883ec87a8822b0753b5fbd9cf5c1f038b2c`. Examined checkout: **0.1.465**, `b5eba8432c317fa259495873e6a223d4501cf142`. The relevant modules listed in the comparison command below are byte-identical between these commits. The probe executes those unchanged modules from the checkout; it is not a run of the installed 0.1.464 binary. Source and issue retrieved/read on 2026-11-13. Node **26.13.0**, Git **2.43.0**, tsx **4.23.15**.

Initial load check: **1.17 / 24 CPUs**. Saved probe: **0.53 / 24 CPUs**, at `2026-11-13T11:32:37.666Z`. Both are below the requested limit. Work stayed within the 15-minute bound. No product, spec, status, skill or board changes; all holds stand.

## Questions answered

The brief has no numbered questions. These four questions cover its reproduction, semantics and limits.

| Question | Answer | Tag and version |
| --- | --- | --- |
| 1. Can a clean tree produce the exact five-file message? | Yes, with five supplied closures that share an input below a tracked directory symlink. | **verified by experiment**, unchanged 0.1.464 modules in 0.1.465 |
| 2. Can the message remain after the tree becomes clean? | Yes. A stored report without pending commit work survives an unchanged-HEAD pass after the input becomes ignored. | **verified by experiment**, unchanged 0.1.464 modules in 0.1.465 |
| 3. Are ordinary ignored inputs always called untracked, and are paths unavailable? | No. Fresh computation excludes ignored paths; full rendering names affected test files and their differing inputs. | **verified by experiment**, unchanged 0.1.464 modules in 0.1.465 |
| 4. Which cause explains issue 208? | Not determined, because the issue lacks full status, the five paths, stored report metadata and filesystem/ignore history. | **inferred**, reported 0.1.464; incident not reproduced end to end |

## Findings

### 1. “Untracked” means absent from the compared commit

**Verified by experiment, unchanged 0.1.464 modules:** The fixture commits five test modules and a directory symlink `linked -> ../dependency`. Each supplied closure contains its test path and `linked/value.mjs`. Git stores the link itself, not the target file's bytes. Git status is empty. Squeal counts all five tests as not determined through that one input:

```text
Commit 26b25f6: 0 known failures; 5 test files not determined (untracked files)
  probe: case-1.test.mjs is not determined: linked/value.mjs differs from the commit
```

Full output names all five tests. The number five counts **affected test files**, not necessarily five untracked paths.

**Read in source code, 0.1.464:** `scheduler/head-move.ts:153` defines `untracked` as differing paths for which `!committed.has(path)`. `commit/compute.ts:70-94` first removes ignored paths. `watcher/git.ts:7-16` explicitly treats files below a tracked, nonignored directory symlink as nonignored project paths. `commit/compute.ts:220-235` counts each affected test once. This is a commit-content distinction, not Git porcelain's current untracked-file list.

**Limit:** The probe supplies closures; it does not prove that a particular runner records this symlink dependency in this form. The original issue names no symlink. This establishes a conditional comparison/wording case, not the original root cause.

### 2. A commit report is retained evidence, not a fresh working-tree assessment

**Verified by experiment, unchanged 0.1.464 modules:** A second fixture stage points all five tests at untracked `temporary.mjs` and stores the resulting report. Adding that path to `.git/info/exclude` makes Git status empty without moving HEAD. Calling real `reportHeadMove` with the stored report leaves `untracked: 5`. A fresh comparison against the same commit returns `notDetermined: 0`.

**Read in source code, 0.1.464:** `scheduler/head-move.ts:72-101` reuses an existing report for a seen commit; with unchanged HEAD it only considers the report's pending-work update. A report with no `waiting` field returns immediately. `state/groups.ts:139-140` reads the newest stored report for status. D5 specifies a report stored per commit and one update when its commit groups finish.

**Limit:** This probe's stored report has no pending lint or test work. Issue 208 shows **26 lint files still running**, so its eventual update may follow a different path. No daemon restart was tried. A fresh in-memory scheduler context reads the same stored report in the probe, but this is not a complete restart experiment.

### 3. Existing diagnostics distinguish the affected tests from their inputs

**Verified by experiment, unchanged 0.1.464 modules:** The full formatter emits all five test paths and `through` input paths. A control with a normal `.gitignore`-ignored dependency yields no not-determined files on fresh comparison. Its five test files remain `unknown` because the probe supplies no test results; this is not a test pass.

**Read in source code, 0.1.464:** `commit/text.ts:52-57` carries these details into the commit line. `status/commit-lines.ts:10-19` prints them with `--full`; `commit/report.ts:60-62` caps retention at ten test files and five input paths per file. `status/status-detail.ts` includes a pointer in the default `More:` text. Thus a report made by this version can already name the issue's five test files through `squeal status --full` or the structured `commitLine.notDetermined` field in `status --json`, subject to retained detail.

## Recommendation and remaining evidence

**Inferred from the probes and 0.1.464 source:** Keep the conservative commit verdict. A clean Git tree does not prove that every input is represented by the commit, nor that a stored report describes the present tree. The deciding tradeoff is truthful commit provenance versus a phrase that reads like current Git status. Triage this as diagnostic clarity until the original paths show a classification defect. This report proposes no implementation or relaxation of checks.

For the original worktree, the useful next evidence is `squeal status --full --json` and `squeal status --full`, together with Git status at the same time. Inspect the named `through` paths, whether they cross a symlink, their ignore state, and the report's pending-work history. Whether the five tests were affected by symlinks, a prior transient input, stale cached hashes, or another cause remains open. Do not promise that restarting the daemon clears a stored report.

## Commands, artifacts and sources

Commands used from the worktree root:

```sh
uptime
getconf _NPROCESSORS_ONLN
gh issue view 208 --repo hearsay-tools/squeal --json title,body,url,comments
git rev-parse HEAD
git rev-parse 'squeal--v0.1.464^{commit}'
git diff --exit-code squeal--v0.1.464 HEAD -- src/core/commit src/core/scheduler/head-move.ts src/core/status/commit-lines.ts src/core/watcher/git.ts src/core/watcher/links.ts src/core/hash/blob.ts
pnpm exec tsx docs/specifications/019-run-triggers/research/probes/issue-208/probe.mjs > docs/specifications/019-run-triggers/research/probes/issue-208/output.txt
```

The comparison exited 0 with no diff. The final probe exited 0; every assertion passed. Exact fixture Git commands are in [probe.mjs](probes/issue-208/probe.mjs); observed output is in [output.txt](probes/issue-208/output.txt). Fixtures are created under the process temporary directory and removed in `finally`. The probe started no daemon or suite. No full suite, product build or lint/typecheck was needed for this research-only change. Staged `git diff --cached --check` passed, and local Markdown link targets exist. The final affected-status read, `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/019-run-triggers/research/probes/issue-208/probe.mjs`, exited 3: `No verdict: no test file's closure holds` the probe; worktree known failures 0, 6 of 1771 test files unknown. This is not a suite pass; the standalone assertions are the verification for this artifact.

Sources read:

- [Issue 208](https://github.com/hearsay-tools/squeal/issues/208), original report; no comments when fetched.
- Local [019 D5](../spec.md#d5-commit-report), [019 amendment log](../status.md), [011 C6](../../011-core/spec.md#c6-status) and [011 amendment log](../../011-core/status.md).
- Release-pinned [comparison and tally](https://github.com/hearsay-tools/squeal/blob/2d68d883ec87a8822b0753b5fbd9cf5c1f038b2c/src/core/commit/compute.ts#L70), [commit report lifecycle](https://github.com/hearsay-tools/squeal/blob/2d68d883ec87a8822b0753b5fbd9cf5c1f038b2c/src/core/scheduler/head-move.ts#L72), [ignore classification](https://github.com/hearsay-tools/squeal/blob/2d68d883ec87a8822b0753b5fbd9cf5c1f038b2c/src/core/watcher/git.ts#L7), and [full detail rendering](https://github.com/hearsay-tools/squeal/blob/2d68d883ec87a8822b0753b5fbd9cf5c1f038b2c/src/core/status/commit-lines.ts#L10). These were read from the local repository, not from recalled API behavior.
