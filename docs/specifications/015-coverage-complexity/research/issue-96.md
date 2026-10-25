# Issue 96: changed files absent from the complexity hook summary

Date: 2026-10-25. Issue: https://github.com/hearsay-tools/squeal/issues/96.

## Fit and owner

Inferred: passes the vision decision filter. Naming unchecked changed files preserves uncertainty and makes feedback more trustworthy across harnesses. Spec 015 owns this: D1 (`complexity.maxFileBytes`), D4 (counting), D6 (large-file warning, test-news summary and pull details). Existing holds stand. This intake authorizes no implementation or policy change.

## Reproduction verdict

Not reproduced, because the one-minute host load was 64.04 on 24 CPUs. Live reproduction was skipped under the intake rule. No researcher or probe was dispatched.

Version: checkout package.json and installed session CLI are 0.1.309. The reporter gives 0.1.302 as the current version, not a version recorded during the incident; revision 44, Claude Code, claude-opus-5-5. The original incident version is unknown.

Commands used for intake, without a live probe:

```sh
git fetch origin
gh issue view 96 --repo hearsay-tools/squeal --json state,title,body,url,labels
uptime
getconf _NPROCESSORS_ONLN
git show origin/main:docs/board.md
gh issue list --state open --limit 100 --json number,title,labels
gh issue list --state open --label triaged --search 'complexity' --json number,title
sed -n '158,178p' src/core/delivery/code-format.ts
```

Observed host output: `load average: 64.04, 54.75, 51.93`; CPU command: `24`.

Reported evidence, not independently reproduced: `squeal code --told` names `packages/cezar/src/workflows/run.ts` as 572 KiB, over the 512 KiB limit. `wc -c packages/cezar/src/workflows/run.ts` returns 586130. The hook repeats only a count of two functions already told; the project check later finds `RunManager.noticeParkedWorker` at CC 29. The reported late refactor causes 98 test files to rerun and a second coverage check.

Read in source code: `src/core/delivery/code-format.ts`, `toldOverLine`, formats the threshold count and the `code --told` hint without a skipped-file count or path. This supports the summary gap but does not prove that D6's separate once-per-session large-file warning failed to arrive. That delivery remains unverified. D6 already requires that warning; retaining skipped-file context in later hook summaries is the proposed extension.

## Duplicates and decision

No existing #96 or gh-96 row on origin/main. Board searches covered complexity, not judged, not-judged, 512 KiB, and the named source paths and method. No exact duplicate among open issues, including triaged issues; the filtered complexity search returned `[]`. The board's Later idea for a large-module warning is related, but concerns module size rather than truthful count coverage. Issue #83 concerns test coverage scope, not complexity counting.

Human decision: approve a bounded hook summary that names changed files not judged and their reasons, or retain the current once-per-session warning and pull details. Judging files above the limit is a separate policy choice, not authorized here. Define truncation and session attribution before implementation.

Done when: after a session changes an included file that cannot be judged, the hook complexity line states that gap and names the file and reason, with bounded output. A count alone cannot imply that every changed file was checked. Regression evidence covers large-file skips, repeated hook delivery, session ownership, recovery after a file becomes countable, and unchanged large files.

Verification: documentation only; no product, spec, status or skill edits. No lint, typecheck, build or test suite was run for this intake. `git diff --check` is the documentation check.
