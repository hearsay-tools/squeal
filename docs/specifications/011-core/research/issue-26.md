# Issue 26: a final verdict for status waits

## Fit and owner

Inferred: passes the vision decision filter. A tail-visible, honest status summary reduces repeated pulls and preserves uncertainty across harnesses without changing validation policy. Owner: spec 011 Core, C6 (Status), including its wait outcomes and text snapshot. This is a proposal, not an accepted change to the spec.

## Evidence and reproduction verdict

Read in official docs: [issue #26](https://github.com/hearsay-tools/squeal/issues/26) is agent-reported friction on Squeal 0.1.199. The reporter ran `squeal status --wait 60000 | tail -25`, lost the header behind inherited results and closure notes, then ran `squeal status | head`. The reported revision 7 had about 920 queued checks. These are reporter observations, not independently reproduced results. The session plugin is 0.1.199; the checkout package.json is 0.1.203.

Not reproduced, because the one-minute host load was 54.76, above 24 online CPUs. Per the task's load gate, no live reproduction, researcher or throwaway probe was started. The likely small reproduction cost does not override this gate. No command below invokes Squeal or runs tests.

Exact load commands and outputs:

```text
$ cat /proc/loadavg
54.76 50.56 36.42 17/3074 930174
$ getconf _NPROCESSORS_ONLN
24
```

## Duplicate check

Read in official docs: fetched origin first; inspected origin/main's docs/board.md for `#26`, `gh-26`, `verdict`, `status --wait`, inherited results, closure notes and status-command references. The issue names no source file. No row covers a final status verdict. Checked open issue titles and labels with:

```sh
git fetch origin
gh issue view 26 --repo hearsay-tools/squeal --json title,body,labels,url
git show origin/main:docs/board.md | rg -n -i '#26|gh-26|verdict|inherited|closure notes|status-command|status --wait'
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
```

Inferred: no exact duplicate. Open, triaged #23 and 011-03 concern selected-file states and wait diagnostics; #14 concerns promotion, explicitly outside #26's scope. Open, triaged #13 / 011-02 concerns bounded invalidation reasons, not a final summary. These overlaps should be coordinated if approved, not treated as authorization to widen any row.

## Decision needed and done-when

The human decides whether to approve a final one-line verdict, and whether a compact mode is useful in addition. C6 currently allows waits to end on news, without all work settling, or without a validating daemon; an approved footer must report the actual outcome rather than collapsing every non-timeout into “settled”.

Done when the final line reports known failures, queued/running outstanding counts and whether the wait timed out; inherited results and closure notes cannot push the verdict out of a 25-line tail. Preserve provenance, unknown state, wait selection and scheduling. Existing holds stand. No product, spec, status or skill change is authorized by this triage.
