# Issue 175: evidence for a widely imported file

Triaged 2026-11-11. Source: https://github.com/hearsay-tools/squeal/issues/175.

## Fit and owner

Inferred: passes the vision filter for faster relevant feedback, less blocking, explicit budgets and honest uncertainty. Owner: spec 020, D1 (command), D3 (selection and budget), D5 (complete evidence), D7 (report). Related: 020-15 selection scope and pre-setup visibility; D11 and D13 evidence reuse. No policy change is approved.

## Reported evidence

Issue report, not independently verified: Squeal 0.1.427 in hearsay-tools/cezarion selected 1,834 test files after a change to `packages/cezar/src/paths.ts`. The default 600-second run ended with 5 pass, 42 incomplete and no violations. A 1,500-second run ended with 31 pass, 16 incomplete and no violations. Both timed out. The reporter says all incomplete functions had CC at most 10 and CRAP upper bounds at most 10.3. Focused test passes do not prove that all selected loaders completed.

Reported commands:

```sh
squeal code --base origin/main
squeal code --base origin/main --json --timeout 1500
```

The latter reported `vitest run: run exceeded timeoutMs (1347354 ms)`, 11 of 1,834 selected files read from stores, and exit 3.

## Reproduction verdict

Not reproduced, because the reported two-run sequence costs about 35 minutes and the extended run alone costs 25 minutes, beyond the roughly 20-minute triage bound. No researcher or live probe was dispatched. No claim is made about a newer version or the original repository state.

Host checks during intake: `cat /proc/loadavg` returned `11.62 17.43 22.23`; `getconf _NPROCESSORS_ONLN` returned `24`. A later check at 2026-11-11T00:20:03Z returned `10.88 16.51 21.70`. Load did not require skipping; expected reproduction cost did.

## Contract and duplicate check

Read in spec 020 D3 and D5: selection follows import closures. An unfinished loading file prevents a pass even when a subset yields a low CRAP upper bound. Thus the reported incomplete verdict is compatible with the approved safety rule. Stopping early and calling such a function complete would require a human decision about evidence semantics. Preserve the unfinished-file rule while considering selection order, earlier diagnostics or evidence reuse.

Read from origin/main board and open GitHub issues: no existing #175 row or exact duplicate for wide-import one-shot coverage budget exhaustion. Searches covered `#175`, `gh-175`, `paths.ts`, `1834`, wide imports and fan-out. #172 / 020-15 overlaps browser selection and pre-run scope visibility. #174 / 020-16 concerns build-wrapper helpers. #125 concerns a daemon-backed broad named-test wait, not this one-shot coverage gate. These related issues have `triaged`; none establishes a duplicate of this symptom.

Intake commands: `git fetch origin`; `git show origin/main:docs/board.md`; `gh issue view 175 --json state,body`; `gh issue list --state open --limit 200 --json number,title,labels`; `gh issue view 125 --json title,body`.

## Human decision

Decide whether to approve a bounded design investigation for wide-import gate evidence, coordinated with 020-15, and whether scope is limited to ordering, estimates and reuse or may change completion semantics. Existing holds stand. This triage authorizes no implementation.
