# Issue 134: coverage temp path in the worktree

Date: 2026-11-01. Triage only. No product, spec, status or skill changes.

## Verdict

**Not reproduced, because** the one-minute host load was 42.966796875 on 24 CPUs. The human requires skipping live reproduction above the CPU count. No researcher, test run or throwaway probe started. This is an intake record, not experimental confirmation.

## Evidence

- **Read in issue #134:** Squeal 0.1.390 under Claude Code on Linux wrote a root entry named `\tmp\squeal-1001\tmp\b7a54d2e340d1baa\coverage-3HLtRn\.tmp\coverage-26a7a913-f944-4efa-ad5e-d8a3d0c0f5b5.json` and a directory with the same prefix. The reporter saw rewrites between revisions 24 and 88. A broad Git stage included it in hearsay-tools/cezarion#2413. The reported cost was one extra review round and about 20 minutes.
- **Read in spec 015 D8:** the adapter supplies the daemon temp directory as `reportsDirectory`; the custom provider writes payloads under `<reportsDirectory>/.tmp` when Vitest omits explicit payload directories. Spec 013 V1 owns the Vitest instance boundary. Thus 015 owns this defect, with 013 as the integration seam.
- **Inferred:** a literal backslash path can be a relative filename on Linux. The issue does not establish where conversion occurred. Its suggested `path.win32` cause and containment guard remain hypotheses, not findings from source or experiment.
- **Read in origin/main board and GitHub issue lists:** no #134 row, matching coverage-temp symptom or exact open duplicate was found. The backslash match in row 007-49 is Python fnmatch and unrelated. Open #112 concerns destructive shared-temp cleanup; #135 concerns missing coverage status. Neither is this path defect.

## Exact intake commands

```sh
git fetch origin
gh issue view 134 --repo hearsay-tools/squeal --json state,title,body,labels,url
python3 -c 'import os; print(os.getloadavg(), os.cpu_count())'
git show origin/main:docs/board.md | rg -n -i '#134|gh-134|backslash|coverage temp|reportsDirectory|coverage-3HLtRn'
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 100 --json number,title
```

The load command returned `(42.966796875, 27.74853515625, 20.609375) 24`. The issue was open. Repository package version and reported installed version were both 0.1.390. No live reproduction command ran.

## Decision for the human

Approve a bounded repair that keeps coverage payloads under OS temp paths on Linux and Windows, with regression checks for backslash paths and no new Git-visible entries, or defer it. Establish the exact conversion source before choosing the fix. No implementation is authorized by this row. Coverage stays opt-in and existing holds stand.
