# Issue 199: node:test arrow callbacks left not joined

Date: 2026-11-12. Issue: https://github.com/hearsay-tools/squeal/issues/199.

## Verdict and scope

Not reproduced, because the one-minute host load was 50.04 on 24 online CPUs. The human requires live reproduction to be skipped above that limit. No researcher, probe, test or gate run was started. This is documentation-only intake, not proof of a defect or its cause.

Reported Squeal version: 0.1.457. Checkout version: 0.1.459, origin/main commit `cfbd3ae6e54b39ca9a17272e7dedfb3a363a630b`. The report did not record a Squeal revision. No claim is made about reproduction on 0.1.459.

## Reported evidence

**Read in issue #199, not independently verified:** In hearsay-tools/squawk PR #3412, `packages/cezar/test/unit/skill-dirs.test.ts` runs through node:test with `--import tsx`. The reporter ran:

```sh
squeal code --base origin/main --json > /tmp/report.json
```

At head `838c9ea52`, it exited 3 with 38 pass and 2 incomplete rows. `<test>.<filter>` occurrences 0 and 1 at lines 22 and 24 had `gap: not-joined`; occurrence 2 at line 26 and map siblings passed. Expected and measured loaders both named the test file. Selected files completed, none failed, `uncounted` was empty, and the budget did not expire. The parent test callback joined. Earlier heads `463da861d` and `303a6c967` showed a similar selective gap after reshaping the chains. The reporter replaced callbacks with a loop.

These facts do not establish an occurrence mismatch or a specific source-map defect. A passing test alone does not identify which V8 range belongs to each callback. Unchanged-looking `(d) => d.dir` callbacks having no row can follow D2's unchanged/moved/shifted body rules; that needs the actual diff before it is called a second defect.

## Fit and owner

**Read in repository docs:** Spec 020 D2 selects changed functions; D4 owns the shared range join; D5 keeps unresolved evidence incomplete; D7 reports the gap. Spec 015 D2 defines stable function identity, D3 counts functions, and D8 supplies mapped coverage. The issue passes the vision filter because correct joins improve trustworthy validation and reduce unnecessary blocking while preserving uncertainty across harnesses.

D4 already specifies position-based matching and conservative ambiguity handling. The suggested change from name/occurrence to source ranges is therefore a hypothesis, not an approved design or an established description of the current matcher.

## Duplicate check

**Read in origin/main board and GitHub open issue lists:** No #199 row and no exact open duplicate, including issues labelled `triaged`. Completed 020-04 repaired earlier arrow join shapes; it is related history, not an active duplicate. Open #144 concerns spawned-child coverage and #149 concerns fixtures run by a separate config. Neither describes repeated sibling callbacks selectively failing the join in a completed measured node:test file.

## Intake commands

```sh
git fetch origin
gh issue view 199 --repo hearsay-tools/squeal --json state,title,body,url,labels
git show origin/main:docs/board.md
rg -n -i '#199|not.joined|callback|skill-dirs|occurrence' /tmp/issue199-board
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title
gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 200 --json number,title
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
node -p 'require("./package.json").version'
```

`/tmp/issue199-board` was the saved output of `git show origin/main:docs/board.md`. The load output was `50.04 41.19 35.91 94/3496 3258068`; CPU output was `24`.

## Human decision

Approve or defer bounded diagnosis and repair of selective callback joins under spec 020. If approved, capture counted functions and mapped V8 ranges from the repeated filter/map case, identify the failing join rule, and verify same-line and split-line callbacks without borrowing sibling or parent coverage. Keep unresolved evidence incomplete and explain why it cannot join. Existing holds stand; this intake authorizes no implementation.
