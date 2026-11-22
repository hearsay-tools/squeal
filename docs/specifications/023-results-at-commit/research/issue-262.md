# Issue 262: selection at a commit

## Verdict and fit

Inferred: passes the vision decision filter. A stable, revision-aware selection report reduces custom scripts and blocking, preserves uncertainty, and strengthens pull state across harnesses. Owner: spec 023 D1/D2/D3/D7; related spec 011 C6 (current named status).

## Reproduction

Not reproduced, because the one-minute host load was 29.31 on 16 online CPUs. The human explicitly requires skipping live reproduction above the CPU count. No researcher, test, checkout or live status probe was started. No timing claim is verified.

Observed environment: checkout package version 0.1.591; session runtime registered from version 0.1.591. The issue reports 0.1.591, with CI pinned to 0.1.588. Intake source: https://github.com/hearsay-tools/squeal/issues/262.

Exact read-only commands used:

```sh
git fetch origin
gh issue view 262 --repo hearsay-tools/squeal --json state,title,body,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
git show origin/main:docs/board.md > /tmp/issue262-board
rg -n '#262|gh-262|selection.testFiles|before/after|status --at' /tmp/issue262-board
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels --jq '.[] | [.number,.title,([.labels[].name]|join(","))]|@tsv'
sed -n '30,67p' docs/specifications/023-results-at-commit/spec.md
sed -n '309,342p' src/cli/status-at-report.ts
```

Load reading at 2026-11-22 about 01:10 UTC: `29.31 21.60 19.87`; CPU command returned `16`. Base inspected: origin/main `0c201406976ea394835ed71e2c8d7ebaf8bca3d2`.

Read in source code: `src/cli/status-at-report.ts` exports `squeal-status-at/1`. Its JSON has `counts` and a `files` array with project, path, change, at and now. It has no `selection.testFiles` or `selection.reason`. Thus the report is not literally counts only: file-level comparison evidence exists, but its shape differs from current status and does not supply the requested selection contract. This is source evidence, not a reproduction of the reported command or latency.

Read in spec: 023 D1/D3 define one call comparing the commit and working tree. D2 requires checkout keying; an answer from a stored graph without checkout is a design change, not an accepted shortcut. D7 has active daemon work (023-40/41); this triage does not widen it or remove holds.

## Duplicates and decision

Read in board and issue list: no #262 row or open issue with the same historical-selection JSON request. No literal source/test file paths were named in #262. Related triaged #118 asks for current keys and run counts; #250 asks for current-status latency and wait bounds. Neither is a duplicate. Existing 023 comparison and daemon rows overlap in mechanism, not in this requested JSON contract.

Human decision: approve a bounded selection-contract design under 023, or defer it. If approved, decide whether to add compatible selection fields to the existing one-call comparison or change the command contract. Require explicit completeness, per-side provenance, and no false promise of checkout-free historical resolution. Existing holds stand; no implementation is authorized.
