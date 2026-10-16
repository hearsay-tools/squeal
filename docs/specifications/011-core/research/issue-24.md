# Issue 24: unknown test-file evidence during read-only review

Date: 2026-10-17. Issue: https://github.com/hearsay-tools/squeal/issues/24

## Fit and owner

[inferred] Passes the vision decision filter: actionable unknown-state explanations strengthen trustworthy pull-state evidence, preserve uncertainty and reduce redundant runs across harnesses. Owner: Spec 011 Core, C4 (validity, discovery and lookup-only startup), C5 (unknown reasons), C6 (status and selected-file waits), C7 (stored evidence). Spec 004 D7/D8/D9 supplies slow-slot and CLI context; this does not authorize changing scheduling or review completion policy.

## Reproduction verdict

Not reproduced, because the one-minute host load was 27.92, above 24 CPUs. The user requires skipping live reproduction in this condition. No researcher, live probe, test run or daemon manipulation was dispatched. No probes were created.

[read in official docs] The issue reports Squeal 0.1.199 reviewing hearsay-tools/cezarion commit 8158dacf0 without repository edits: initially no listed files, then 410 unknown files saying `no result: no reason was kept`, alongside inherited passes and 93 slow files waiting for another worktree. The reported direct helper run passed three tests; it does not establish the other files' results. This is the reporter's evidence, not an independently reproduced outcome.

Version context: session plugin path names 0.1.199; this checkout's package.json names 0.1.203. Neither version was exercised for this investigation.

Exact reported command sequence (the issue does not supply its absolute installed CLI prefix):

```sh
squeal status
squeal run --slow --wait 60000
squeal status
```

Exact host/version checks used here:

```sh
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
cat package.json | head -15
```

Output: `/proc/loadavg`: `27.92 21.14 23.41 30/3758 414453`; CPU count: `24`; package version: `0.1.203`.

## Duplicate check

[read in official docs] Checked origin/main's board for `#24`, `unknown`, `no reason was kept`, `discovery`, and status-related seams. The issue names no source files; its named test helper has no path. No existing row covers #24's complete symptom. Open issues and their labels were checked with `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels`.

Partial overlaps: #17 (triaged), now 011-03, includes discovery diagnostics and pending reasons; #13 (triaged), now 011-02, bounds existing invalidation explanations and adds a detail command; #10 (triaged), now 011-06, repairs a specific requeue defect. Open #23 (not triaged at inspection) requests per-selected-file classes/verdicts, not causes of missing evidence. #19 (triaged) concerns read-only completion policy. None fully duplicates retention/display of reasons for idle unknown or never-run files. Do not widen those approved rows or lift their holds.

## Human decision

[inferred] Decide whether to approve a bounded diagnostics row for retained unknown/unrun reasons and a selected-file command, coordinating the discovery portion with 011-03 and per-file presentation with #23. Acceptance implied by the issue: status distinguishes initial discovery from idle unscheduled work, explains missing evidence (including absent inherited results and invalidation where known), preserves honest unknowns, and names a command to obtain the selected file's result. `no reason was kept` is not the ordinary explanation for newly tracked unrun files. No scheduling change is approved by this triage.

Verification: documentation-only diff and whitespace/ownership checks; no product checks run, and no passing product-test claim is made.
