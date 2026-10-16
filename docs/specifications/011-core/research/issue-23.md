# Issue 23: selected-file state in named waits

Date: 2026-10-17. Issue: https://github.com/hearsay-tools/squeal/issues/23

## Fit and ownership

Inferred: passes the vision decision filter by making pulled state actionable, avoiding redundant reruns, and preserving current/pending/stale/unknown distinctions across harnesses. Spec 011 C6 (Status) owns the result contract, with C5 (State) and Spec 005 D2 (named-file selection and rendering) touched. This is a proposal, not an accepted contract amendment.

## Reproduction verdict

Not reproduced, because the one-minute host load was 27.56, above 24 online CPUs. No researcher, live wait, test suite or throwaway probe was started. Existing holds stand.

Read in issue report: the incident used Squeal 0.1.199. The session plugin is also 0.1.199; the checkout package is 0.1.203. These are distinct observations; no newer-version reproduction is claimed. The report names eleven selected files but supplies no literal paths. It reports five pending at revision 16, selected JSON entries containing only project/path, and global counts current: 3, pending: 80. Its nine busy-store why calls belong to #8, not this proposal.

Exact commands executed for the load/version evidence:

```sh
cat /proc/loadavg
# 27.56 20.96 23.37 26/3692 413271
getconf _NPROCESSORS_ONLN
# 24
node -p 'require("./package.json").version'
# 0.1.203
```

Reported incident command, not executed here: `squeal status --wait 540000 <paths>` (eleven paths; literals unavailable), also with `--json`, followed by `squeal why <file>` and an npm test rerun. A later reproduction requires one bounded researcher with throwaway probes under `research/probes/issue-23/`, recording literal commands and outputs for both text and JSON.

## Duplicate verdict

Read in origin/main board and open GitHub issues: no #23/gh-23 row or exact duplicate found. Searches covered #23, gh-23, named waits, per-file state/verdict, wait.testFiles and byClass. No concrete file paths were supplied by the issue. The related named-wait seam src/cli/status-wait-paths.ts already belongs to 005-67.

011-03 (#14/#17) overlaps per-file wait diagnostics, pending-discovery explanations and constraints, but remains design-only awaiting human acceptance. 005-67 (#6) repairs selection, not result detail. #7/#8 cover contention; #18 covers primer discoverability. Open #24 asks for unknown-result explanations during read-only review, not selected-file classes and verdicts. The related #6/#7/#8/#14/#17/#18 issues already carry triaged; #23 did not at inspection. Do not widen or dispatch any existing row on this evidence.

## Human decision and done-when

Decide whether to approve selected-file result detail as a separate follow-up coordinated with 011-03, or fold it into that design before acceptance. After approval: a timed-out named wait identifies pending selected files in text; text identifies selected failures and known pass/fail outcomes without a separate why call; every JSON wait.testFiles entry carries current/pending/stale/unknown and a verdict when known. Preserve provenance and uncertainty, selection semantics, queue order and existing holds.

## Verification

Documentation-only triage; no product, spec.md, status.md or skill changes. Live reproduction and full test/build checks were skipped to avoid adding load. Documentation diff and ownership checked with git diff --check and git diff --name-only.
