# Issue 97: source-path status omits direct importers

Date: 2026-10-25. Issue: https://github.com/hearsay-tools/squeal/issues/97.

## Fit and ownership

Inferred: this passes the vision decision filter. A source-path selection must give trustworthy validation evidence across harnesses. Spec 011 owns C6 (status) and C15 (named demand), with C3 (closures) and C14 (adapter closure contract) as supporting sections. No adapter cause is established.

## Reproduction verdict

Not reproduced, because the one-minute host load was 47.16 on 24 CPUs. The task requires skipping live reproduction above the CPU count. No researcher or probe was started.

Verified by command: `cat /proc/loadavg` returned `47.16 43.77 46.96 49/3375 91388`; `getconf _NPROCESSORS_ONLN` returned `24`. `node -p 'require("./package.json").version'` returned `0.1.309`. Session Squeal is 0.1.309. These are triage measurements, not a reproduction.

Read in issue #97: the incident used launcher Squeal 0.1.304, with Claude Code plugin 0.1.302 installed, at revision 7 in a cezarion worktree. The reporter ran:

```sh
squeal status --json packages/cezar/src/workflows/run.ts
squeal status --json packages/cezar/src/core/shell-env.ts
squeal status --json packages/cezar/src/workflows/run.test.ts
```

Read in issue #97: `run.ts` had 135 direct test importers but selected only `run-active-pin.test.ts`, which reads the file. `shell-env.ts` selected 61 other files and omitted all three reported direct importers: `core/shell-env.test.ts`, `workflows/pasted-attachments.test.ts`, and `workflows/workspace-semaphore.test.ts`. Naming `run.test.ts` selected itself. A daemon restart was not tried. The report does not establish the cause of the 285-file re-queue, or whether restarting changes the selection.

## Duplicate check

Read in origin/main board after `git fetch origin`: no `#97` or `gh-97` row, and no row naming `shell-env` or `run-active-pin`. Searches also covered source paths, direct imports, path selection and closures. `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels` included the triaged issues. No exact duplicate was found.

Related only: #80 concerns resolving a newly imported module without restarting; #83 / 011-206 concerns named tests outside coverage and passing readers. Closed board history #30/#39 and done 005-67 concern overly broad named-test selection and path resolution. Done 011-191 moved named selection without intended behavior change. None proves a shared cause for omitted direct source importers.

## Human decision and done-when

Decide whether to approve investigation and repair of source-path selection under 011. A regression must show that a source path selects its direct static test importers and the other tests whose closures contain it, for snapshot and wait forms. Selected counts and verdicts must describe that set. Preserve exact named-test selection, reader selection, caller-relative path handling and the hold that source-path waits do not request runs or promote them. Existing holds stand. This triage authorizes no implementation.

## Verification

Documentation only. No product, test, bundle, spec, status or skill file changed. Live tests were skipped under the load rule. Validate the patch with `git diff --check`.
