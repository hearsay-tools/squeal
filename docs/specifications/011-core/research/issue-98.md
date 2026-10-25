# Issue 98: flaky claim after an untracked data-file change

Date: 2026-10-25. Issue: [#98](https://github.com/hearsay-tools/squeal/issues/98).

## Fit and owner

Inferred: passes the vision decision filter. Trustworthy evidence and stated uncertainty are core promises. Spec 011 owns the claim (C5), keys (C3) and runtime-input boundary (C12). Spec 003 D3/D5 owns the node:test closure and observations. This intake authorizes no implementation and changes no existing hold.

## Reproduction verdict

Not reproduced, because the one-minute load average was 39.14 on 24 CPUs. The user requires skipping live reproduction above the CPU count. No researcher or probe was started. The original cezarion worktree was not replayed.

Read in issue: the incident used Squeal 0.1.309 in Claude Code. The session plugin is 0.1.309; the checked-out package is 0.1.311. The reporter says `.github/scripts/cockpit-test-sequencer.test.cjs` failed at revision 50 and passed at revision 52 after `.github/cockpit-test-durations.json` changed. Its helper `.github/scripts/cockpit-test-sequencer.mjs` reads that JSON with `readFileSync(new URL('../cockpit-test-durations.json', import.meta.url))`. The data file was not declared in `squeal.config.json` inputs. The notice said `Flaky: FAIL -> PASS under the same inputs`. These are reported facts, not a local reproduction.

## Evidence

Read in source code: `src/core/state/flaky.ts`, `recordFlips`, compares check identity and key when pass replaces fail or fail replaces pass. `flakyText` prints “under the same inputs”. It does not establish that every actual runtime input was keyed.

Read in spec: 011 C5 explicitly requires that wording while the note key is current. 003 D3 says fs reads are declared inputs; observed module paths enter the closure through D5. 011 C12 describes the shared runtime recorder and its limits. Adding data-read observation to node:test is a separate scope from qualifying the claim.

Inferred: an unchanged tracked key can coexist with a changed untracked data file. The wording can overstate the evidence. Source and spec support this mechanism; they do not prove the incident.

## Duplicate check

Read in origin/main board and GitHub open issue list, including triaged issues: no #98 row or exact duplicate. Searches covered `#98`, `flaky`, `same inputs`, `undeclared`, `cockpit-test`, data files and runtime reads. #56 / 011-60 covers a missing child import in Vitest, not this node:test classification. Runtime-observation rows and the Later pytest data-read note overlap the general input boundary only.

## Exact commands used

Read-only intake commands (no live test command):

```sh
git fetch origin
git show origin/main:docs/board.md > /tmp/issue-98-board.txt
gh issue view 98 --repo hearsay-tools/squeal --json state,title,body,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
node -p 'require("./package.json").version'
rg -n '#98|flaky|same inputs|cockpit-test|undeclared|## Triage' /tmp/issue-98-board.txt
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels --jq '.[] | [.number,.title,([.labels[].name]|join(","))] | @tsv'
sed -n '1,125p' src/core/state/flaky.ts
sed -n '44,57p' docs/specifications/003-node-test-runner/spec.md
sed -n '158,189p' docs/specifications/011-core/spec.md
sed -n '336,341p' docs/specifications/011-core/spec.md
```

Verified by host measurement: load output began `39.14 38.26 33.97`; CPU command returned `24`.

## Human decision

Choose qualified “same tracked inputs” wording with explicit `inputs` guidance, or research node:test runtime data-read tracking. The former is the smaller change. Either choice must preserve actual same-key flip evidence and distinguish tracked from actual inputs. No product work is dispatched by this row.
