# Issue 215: a red-proof failure denies an unrelated docs edit

Date: 2026-11-14. Source: [issue #215](https://github.com/hearsay-tools/squeal/issues/215), agent-reported friction.

## Verdict

Not reproduced, because the one-minute host load was 78.59 on 24 online CPUs. Live reproduction was skipped under the triage load rule. No researcher, daemon probe or test run was started. The incident below is reporter evidence, not an independent reproduction.

## Evidence and versions

**Read in issue:** Squeal 0.1.465, Claude Code, claude-opus-5-5, in a Squawk task for hearsay-tools/squawk#3490. The reporter temporarily copied origin/main's `.github/scripts/workaround-expiry.cjs` over a fixed version and ran its `node --test` test to prove it red, then restored the fix. Squeal recorded PASS -> FAIL for `workaround-expiry.test.cjs > reader skips markers that prose names inside code spans` at revision 23. The reporter says a subsequent manual run passed. At revision 26, still pending, PreToolUse denied a one-line Edit to `docs/sdlc/friction.md`, citing that earlier FAIL. A commit in the same batch proceeded without the docs edit; repair required an amend and force-push. The issue supplies no complete copy commands, test command path or timing trace.

**Read locally:** checkout package version 0.1.477; session runtime path names 0.1.475. Neither was tested for this incident.

## Exact intake commands

```sh
git fetch origin
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
gh issue view 215 --repo hearsay-tools/squeal --json state,title,body,labels,url,comments
git show origin/main:docs/board.md
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
```

Load output: `78.59 82.39 67.65 60/2431 857924`; CPU output: `24`. No live reproduction commands ran. No probes were created.

## Fit, owner and duplicates

**Read in repository docs:** This passes vision filters 1–3: relevant feedback, less unnecessary blocking, and honest provenance. Spec 011 C8 owns the shared deny-once contract. C3 owns keys and closures; C5 owns transitions and delivery views; C6 owns status provenance. Spec 012 CC2 maps the rule onto Claude Code PreToolUse. Current C8 denies an edit for an undelivered regression and does not specify the proposed edited-path or restored-input exceptions. The reported denial therefore does not alone prove an implementation defect.

The origin/main board has no #215 entry and no match for the named workaround-expiry files. It already has one Triage row `gh-71 ... (gh-136 expected test-first failure)` for this deny-once policy friction. Open #71 and #136 both carry `triaged`; update that row rather than create another. Open, triaged #213 concerns earlier failure state after input changes and overlaps the provenance question. #117 concerns deleted-test inventory; #181 concerns wait scheduling. Neither replaces the deny-once row.

## Human decision

Decide whether the reported cost after grouping shipped warrants revisiting the held deny-once contract: allow an edit outside the failing test's recorded closure, suppress interruption from superseded inputs, or retain the current rule. Any restored-content shortcut must validate the whole key, including environment and closure, rather than one file hash or a manual PASS. Pending validation remains pending; a historical FAIL is not a current PASS. Existing holds and completion gates stand. No implementation is authorized by this triage.
