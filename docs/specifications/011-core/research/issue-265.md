# Issue 265: daemon death after a harness session restart

Date: 2026-11-22. Documentation-only intake; no implementation authorized.

## Verdict

Not reproduced, because the one-minute host load was 29.31 on 16 online CPUs. The human explicitly requires skipping live reproduction above CPU count. No researcher, live restart, test, or throwaway probe was started. The cause remains unknown. Existing holds stand.

## Reported evidence (not independently verified)

[Issue #265](https://github.com/hearsay-tools/squeal/issues/265) is an agent-reported friction issue. It reports Squeal 0.1.597, revision 17, Claude Code in a Squawk worktree. Between turns Squawk replaced the agent session. The next prompt hook reported no validating daemon, an unclean death between runs and results as of revision 17. A later tool hook reported validation resumed at revision 17. The reporter ran no tests or signals at that time. This establishes a reported temporal association, not evidence that parent exit killed the daemon. Neither a host reboot nor a specific signal is established.

Session runtime: 0.1.597 (session-provided executable path). Fetched origin/main and checkout package.json: 0.1.598.

## Commands and observations

Read-only intake commands; no reproduction command was run:

```sh
git fetch origin
gh issue view 265 --repo hearsay-tools/squeal --json state,title,body,labels,url
uptime
getconf _NPROCESSORS_ONLN
git show origin/main:docs/board.md
git show origin/main:docs/board.md | rg -n -i '265|died|restart|shutdown|## Triage|Standing models'
gh issue list --repo hearsay-tools/squeal --state open --limit 500 --json number,title,labels --jq '.[] | select(.title | test("daemon|shutdown|restart|heartbeat"; "i")) | {number,title,labels:[.labels[].name]}'
gh issue view 163 --json body,title --jq '.title,.body'
git show origin/main:package.json
```

`uptime` at 21:14:58 Europe/Warsaw returned one/five/fifteen-minute loads 29.31, 20.43, 12.67; online CPU count was 16. Issue state was OPEN. No source file is named in #265, so there is no issue-named file to match against board rows.

## Fit, ownership and duplicates

Read in repository docs: the vision decision filter favors trustworthy feedback, less noise, uncertainty and harness independence. This issue passes. Spec 011 owns C9 daemon lifecycle, C5 delivery and C6 status. C9 already requires detached spawn with ignored stdio and unref; proposing detachment alone assumes a missing mechanism that the contract already specifies. Spec 012 hook delivery is a related boundary, not the primary owner.

No existing #265 board row or exact open duplicate was found, including open issues labelled `triaged`. #163 / gh-163 is related: an idle Pi daemon disappears and default status hides a saved exit reason. It does not establish the same cause as a session-restart-associated unclean death. #185 concerns a lapsed heartbeat after Codex edits, #176 startup stalls, and #147 stop timeout; none establishes this restart symptom. Keep #265 separate unless later evidence proves a shared cause.

## Human decision

Approve or defer a bounded diagnosis of session replacement and daemon lifetime, with evidence-based death reporting. An approved follow-up should use an isolated restart probe and capture daemon identity, process/session ownership, recorded exit evidence and recovery. A warning must leave an unavailable cause unknown. Do not select a parent-exit explanation or change lifecycle policy from the incident alone. No spec, skill, product code or existing hold changes in this triage.
