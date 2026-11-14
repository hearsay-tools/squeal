# Issue 218: coverage history in a fresh-worktree reach report

Date: 2026-11-14. Issue: https://github.com/hearsay-tools/squeal/issues/218

## Verdict and scope

Not reproduced, because the one-minute host load was 29.55 on 24 CPUs. The human requires skipping live reproduction above CPU count. No researcher, test run or probe was started. This is documentation triage, not an implementation approval.

## Evidence

- **Read in issue (unverified locally):** the reporter used Squeal 0.1.475, revision 0, Claude Code. `squeal reach --limit 30` listed 1,815 test files, 1,796 without current-input coverage records and 1,784 without current-input results. A fresh worktree had records for about 12 of 1,800 files. Coverage was on. A previous report on November 11 had a called / loaded-only split. The reporter counted 130,768 stored test-file results over five days, but did not establish that they carried coverage records. Historical coverage availability remains unknown.
- **Read in issue (unverified locally):** path-based helper suggestions led an agent to describe a 46% helper share as waste, although those helpers start the run loop. Neither that interpretation nor actual helper calls were replayed.
- **Read in specification:** 015 D11, Coverage per pair and Cost, explicitly reads coverage at current keys. Recorded seconds can instead use the newest result. Missing current coverage is therefore consistent with the specified report contract; this does not prove the incident's cause. D11 requires uncertainty when records are absent. D4 and D8 govern storage, retention and key identity; D9 uses current coverage for function states. Older diagnostic history would require a human decision, and cannot silently become current validation evidence.
- **Observed environment:** checkout package version 0.1.481; session runtime pinned by the launch message to 0.1.480. Neither was used to replay the reported 0.1.475 command.

## Exact intake commands

```sh
git fetch origin
gh issue view 218 --repo hearsay-tools/squeal --json state,title,body,url,labels
uptime
getconf _NPROCESSORS_ONLN
node -p 'require("./package.json").version'
git show origin/main:docs/board.md | rg -n -i '#218|reach|loaded.only|## Triage'
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 200 --json number,title
```

`uptime` at 12:48:41 Europe/Warsaw returned load averages `29.55, 19.95, 13.53`; CPU count returned `24`. The reported reproduction command is `squeal reach --limit 30`; it was not run here. No full-suite request was made.

## Fit, owner and duplicates

**Inferred:** passes the decision filter if diagnostic history preserves provenance and uncertainty: it can improve useful feedback without forcing another whole-suite run. Owner: 015 D11; related D4/D8/D9. Spec 011 result validity must remain unchanged.

Checked origin/main board at `c5481f1a8d3e51d0d7418dffdaaa1cc4e150d5d0` for the issue, reach symptom, loaded-only wording and named `test-factories` helper. No existing issue row or exact duplicate found. The #217 row mentions #218 as a distinct concern. Open issues, including `triaged`, show #183 (savings overstated when alternate routes remain) and #217 (reach discovery), not the missing historical split. #135 concerns pending code reports after installation, not reach history.

## Human decision

Choose explicitly older diagnostic coverage with an agreed source/input compatibility rule, newest-record age diagnostics only, or retain current-only reporting. Any historical split must name its age and provenance, preserve unknown/unread cases, and stay separate from current results, function states and gate evidence. A follow-up reproduction should compare current and older records across two worktrees with changed inputs and changed source bytes. Existing holds stand.
