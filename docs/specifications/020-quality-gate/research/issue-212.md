# Issue 212: shared Vitest setup edit makes the code gate too wide

Date: 2026-11-13. Owner: spec 020, D1/D3/D5/D6/D7/D17; related D14/D18.
Source: https://github.com/hearsay-tools/squeal/issues/212

## Fit

Inferred: passes the vision decision filter. Bounded, relevant collection can reduce blocking and wasted work across harnesses. Any change must preserve uncertainty, tested-tree provenance and project policy. A completed sample cannot silently stand for unfinished loaders.

## Reproduction

Not reproduced, because the one-minute host load was 103.64 on 24 online CPUs. The human requires skipping live reproduction above the CPU count. No researcher, probe or gate run was started. The report's 1,800-second command also exceeds the approximately 20-minute triage budget.

Read in issue: Squeal 0.1.467, daemon revision 9, Claude Code / Squawk worker. The one-shot command was:

```sh
squeal code --base origin/main --json --timeout 1800
```

The reporter changed `packages/cezar/vitest.setup.ts` (a `setupFiles` entry) and six preview files. They report 1,248 selected Vitest files, 976 completed, 272 unfinished, 257 not started and six failed, on load 140–175 / 24 CPUs. All 33 functions read incomplete with `test-failed`; exit 3 and `budget.timedOut: true`. Highest reported complexity and CRAP were 17. They say the six failures pass on CI at the same head. No raw report, stderr or exact tested commit is attached; load causation and current-version behavior are not verified.

Verified by command, host observation only:

```text
$ cat /proc/loadavg
103.64 98.21 95.25 83/3687 1377237
$ getconf _NPROCESSORS_ONLN
24
```

## Contract and overlap

Read in repository spec at origin/main `a934786815e3d980ce30a866b6f109b245025c28`:

- D3.1 selects affected closures for every changed path, not only the paths of changed functions. D3.4 keeps the overall verdict incomplete for unfinished selected files.
- D5 requires completed loaders and no selected failure. A subset may prove the CRAP bound only when omitted loaders completed. An unfinished loader still prevents pass. Low measured values alone do not establish completeness.
- D6 requires a policy-version raise for a change of meaning. Accepting one completed setup loader or direct-import-only evidence would need an approved contract, including its omitted-loader and failure semantics.
- D17.1 already specifies a pre-run selection estimate, file count, budget warning and rerun command. Its early-stop rule leaves files unrun only when they load no changed function; it does not solve a setup file loaded by every test. Actual estimate output in this incident is unknown.
- D17.2 orders smaller loader sets first; D17.3 keeps completed results. Neither changes completeness. D14 scopes by approved check groups and D18 runs runners together.

Read in board and GitHub: no existing #212 row. Closed #175 and done 020-17 address wide-import cost through estimates, ordering and reuse, explicitly without changing completeness. CI intake flagged that closed issue as a likely duplicate. Treat #212 as a recurrence after those changes with a setup-specific evidence-policy request, not an exact open duplicate. Open #183 concerns what a setup-edge cut really saves in `reach`; #203 concerns group selection; #210 concerns global failure attribution (rows 020-53/54). None supplies the proposed setup sampling contract.

## Commands used for intake

```sh
git fetch origin
gh issue view 212 --repo hearsay-tools/squeal --json state,title,body,labels,comments
git show origin/main:docs/board.md
git show origin/main:docs/board.md | rg -n -i '#212|setup file|setupFiles|one-shot|code gate|## Triage'
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
gh issue view 175 --repo hearsay-tools/squeal --json state,title,body
gh issue view 183 --repo hearsay-tools/squeal --json title,body
```

## Human decision

Approve a bounded investigation of setup-specific evidence and its safety contract, or retain all-loader completeness and limit follow-up to actionable diagnostics. First obtain the original JSON and stderr to check existing D17 estimates. Do not infer that direct imports or any one completed setup loader prove every affected behavior. No product work, policy change, spec amendment or release is authorized. Existing holds stand.
