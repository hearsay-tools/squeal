# Issue 227: broad browser selection after the narrow-report fix

Date: 2026-11-16. Documentation triage only. No live probe or worker started.

## Fit and owner

**Inferred:** passes the vision decision filter: relevant checks reduce blocking,
while explicit missing evidence preserves provenance. Owner: spec 020 D1/D3
(collection), D5 (incomplete evidence), D7 (report), D14 (group scope and advice).
D13 owns the suggested CI-parts alternative. Related: spec 019 D1/D6.

## Evidence and limits

**Read in issue:** the reporter used Squeal 0.1.516 with
`squeal code --base origin/main --json`. Eight changed
`packages/web/e2e/*.e2e.ts` specs yielded exit 3, verdict `incomplete`,
25 pass, 0 violations and 60 incomplete callbacks, all `left-out`.
The reported line was:

```text
browser (manual) is left out: 97 of its 97 test files load changed code; add --group browser to run them
```

The reporter says no shared seam changed. The diff, project configuration,
closures, declared inputs and complete JSON were not supplied here. The
97-file count is reported evidence, not an independently verified import edge.

**Verified by command:** `uptime` returned one-minute load 60.10
(five-minute 69.78, fifteen-minute 77.35); `getconf _NPROCESSORS_ONLN`
returned 24. Not reproduced, because one-minute load exceeded CPU count.
No browser run, coverage run, throwaway probe or test suite was started.
Reported and session runtime: 0.1.516 (session runtime path supplied by
Squeal). Checkout package version: 0.1.518, commit
`0535d8465b70a3aef5a9a040e75a42290343916d`.

**Read in existing research and board:** [issue-203.md](issue-203.md)
verified six synthetic cases on 0.1.457. `--test` included a named manual file;
`--group` admitted affected files rather than every peer. Shared-helper edits
selected peers. This does not reproduce the real browser project.
Board row 020-61 records the report-advice repair released in 0.1.490.
The new report on 0.1.516 therefore needs investigation rather than a claim
that per-file selection is absent. Whether advice is absent, truncated or
inapplicable to these paths is unknown.

**Read in spec:** 020 D3 selects the union of affected import closures,
changed test files, explicit tests and matching declared inputs. Declared
inputs can select peers without one spec importing another. D14 makes
`--test` additive and keeps other selected in-scope files; it does not promise
an exclusive run or avoid required setup. D14/020-61 already requires per-file
advice for changed tests. D13 already defines validated CI-parts reuse; no
arbitrary same-head CI result is accepted by this triage.

## Duplicate verdict and decision

**Verified by command:** no #227/gh-227 row existed on origin/main. Board
searches covered browser selection, #203 and `packages/web/e2e`. The open
issue list, including `triaged`, contained no exact duplicate. Closed #203
and done 020-61 are the direct predecessor, not proof this recurrence is
resolved. Open #217 concerns finding reach; #218 concerns reach provenance.

**Inferred recommendation:** approve a bounded investigation in the incident
project once load permits. Obtain the exact diff/config, compare each selected
file with D3's selection reasons, and check 0.1.516 per-file advice. Repair
only a proven selection or report gap. New exclusive selection or looser CI
acceptance would require a separate human decision. Existing holds stand.

## Commands used

Read-only intake commands (no reproduction command was run):

```sh
git fetch origin
gh issue view 227 --repo hearsay-tools/squeal --json state,title,body,labels,url
gh issue view 203 --repo hearsay-tools/squeal --json state,title,body
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
git show origin/main:docs/board.md | rg -i '#227|gh-227|#203|browser|packages/web/e2e'
uptime
getconf _NPROCESSORS_ONLN
git rev-parse HEAD origin/main
```

Sources: [#227](https://github.com/hearsay-tools/squeal/issues/227),
[#203](https://github.com/hearsay-tools/squeal/issues/203),
[020 spec](../spec.md), [020 status](../status.md),
[019 spec](../../019-run-triggers/spec.md), and origin/main board.
