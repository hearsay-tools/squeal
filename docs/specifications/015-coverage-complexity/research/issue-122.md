# Issue 122: packaged test helpers and coverage

Keep explicit exclusions; treat automatic unavailable coverage for excluded tests as a policy decision.

The reported score and function name reproduce at the adapter/judgement boundary
on Squeal **0.1.374**, commit `15f73a3110c4f6aaa85171ac0dffdbb8575dff5a`, Node
**24.22.1**. The external Cezarion incident and its delivery sequence are not
reproduced. This is documentation-only research for [issue 122][issue].

## Questions and answers

The brief has no numbered questions; these cover its requested decisions.

| Question | Answer and evidence tag (0.1.374) |
| --- | --- |
| 1. Can a manual built-output pass coexist with untested and CRAP 72? | **verified by experiment**: yes. The manual packaged test calls both helpers and passes. The real Squeal unit run passes. Judgement gives `<test>.cleanup` and `productHelper` untested/CRAP 72. |
| 2. Does one loader prove execution or discovery-only coverage? | **verified by experiment**: neither. The real static closure includes both files, but the completed unit run's coverage record has neither. Synthetic no-result and no-record controls stay pending and unknown, respectively. |
| 3. Does a test-file suffix exclude the file from code checks? | **verified by experiment**: no. The unlisted packaged `.test.ts` remains countable. Passing that path in the runner's listed-test set excludes it. |
| 4. Does current D9 permit this result? | **read in source code**: yes. D9 explicitly says an excluded suite makes no state unknown. A complete loader record with no source entry is distinct from a missing coverage record. |
| 5. Would the suggested change conflict with existing holds? | **inferred**: automatic test/helper path inference conflicts with the human's 015-82 decision. An explicit project exclusion already fits D1. A new unavailable state for excluded tests needs a separate contract decision. |

## Reproduction and controls

**verified by experiment, 0.1.374 / Node 24.22.1.** The final probe started at
2026-10-28 16:28:32 UTC. Load was **18.89 / 11.92 / 9.96**, with **24 CPUs** and
24 available CPUs. It met the brief's load gate. It uses one temporary project,
not the real external suite. Exact command:

```sh
pnpm exec tsx docs/specifications/015-coverage-complexity/research/probes/issue-122/probe.ts > docs/specifications/015-coverage-complexity/research/probes/issue-122/result.json
```

Exit **0**. Full output and source are in [the probe directory][probe]. Its manual
child command is `node --test dist/test/e2e/delegation.test.mjs`, exit **0**:
`tests 1`, `pass 1`, `fail 0`. Esbuild strips the fixture's TypeScript into a
separate temporary `dist/` tree; both helper calls have result assertions.

The configured Squeal project lists only `test/unit.test.mjs`. That unit test has
a literal dynamic import under a false environment condition. The adapter's
static closure nevertheless includes `test/e2e/delegation.test.ts` and
`src/helper.ts`. The unit run produces one passing result and one coverage record.
The decoded record names the unit file, not either helper's source. With that
actual record and closure, production loader and judgement functions produce:

| Source/function | Closure loaders | Present in execution record | CC | CRAP | Untested |
| --- | ---: | --- | ---: | ---: | --- |
| `test/e2e/delegation.test.ts`, `<test>.cleanup` | 1 | no | 8 | 72, fail | fail |
| `src/helper.ts`, `productHelper` | 1 | no | 8 | 72, fail | fail |

The score is `8² × (1 − 0)³ + 8 = 72`. This reproduces the issue's score and
nested helper name without any function running in a child of the Squeal test.
It does not prove the external incident used the same unexecuted-import path.

**verified by experiment, 0.1.374.** A positive control configures the real adapter
to run `test/e2e/delegation.test.ts` itself. Its test passes; the product helper has
10/10 covered lines, CRAP **8**, and untested **pass**. The policy function excludes
the now-listed test file from counting. An explicit `coverage.exclude` of
`test/e2e/**` matches the fixture and leaves `src/helper.ts` unmatched. This last
check verifies the matcher, not a daemon policy-reload transition.

## Mechanism and contract

**read in source code, 0.1.374.** `crap/loaders.ts` uses each listed test's closure
to construct loader counts. Results and record availability determine whether a
loader is ready. `crap/file.ts:coverageOf` skips a source absent from a valid
record; it returns `unread` for a missing record, explicitly unread source, or
blob mismatch. An empty set of matching sources therefore reaches
`joinCoverage` as no executed coverage, then `judgeFiles` assigns zero coverage
and no `runBy`. This is not a discovery-only result being accepted as coverage.
The observed loader has a completed run and record, but its static reach is
wider than its runtime reach.

**read in source code, 0.1.374 and spec 015 at the examined commit.** D1 excludes
“test files (any file a runner lists)”. `pass/included.ts` implements this exact
set; a suffix is not authority. D8 collects from Squeal's own runs. D9 says:
“A Squeal-excluded suite such as `test/e2e/**` makes no state `unknown`: Squeal
reads none of its closures”. Thus a manually executed suite cannot supply
coverage or suppress failures under the present contract. Manual success alone
also does not establish how much of a function's branches ran.

**inferred from those sources, 0.1.374.** The complaint identifies a useful
scope distinction for agents, but the reproduced judgement is permitted by D9.
Changing every unlisted file to unavailable would also suppress real product
helpers, as this probe shows. Inferring tests or helper directories from names
would change D1 and the human's 2026-10-27 decision: “015-82 keeps explicit
excludes. No automatic helper-directory inference or new-file delay.”

## Recommendation and open questions

**inferred, 0.1.374.** Keep explicit, narrow project exclusions for packaged test
code that the project chooses not to measure. This retains coverage checks on
product helpers. Automatic unavailable coverage needs a human-approved scope
rule and evidence of test identity; this report does not design one. Setup
research 015-90 is the existing place for configuration guidance, not an approval
to implement it. Coverage remains opt-in.

Not determined: the external project's exact discovery/configuration, closure,
record, blob and notification history. The issue supplies no store snapshot.
This probe does not establish a daemon defect, a stale record, a source-map
failure, a discovery execution bug, or the claimed external helper's branch
coverage. It does not exercise persisted states or harness delivery. A real
incident snapshot would distinguish those causes from the reproduced static
closure case. No full suite or build ran; product code is unchanged.

## Verification

The probe and saved-evidence assertions passed. `git diff --check` passed.
The affected status command was:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/015-coverage-complexity/research/issue-122.md docs/specifications/015-coverage-complexity/research/probes/issue-122/probe.ts
```

Exit **3** at revision 7: no test closure holds either path; known failures **0**,
all **1,315** broader test files current. This is not a test verdict for research.
The standalone probe supplies its verification. `pnpm exec biome check --write`
on the probe exited **1**, “No files were processed”; repository configuration
ignores this research path. It applied no fixes and supplies no lint pass.

## Sources

- [Issue 122][issue], fetched with `gh issue view 122 --repo hearsay-tools/squeal --json title,body,comments,url`; snapshot [issue.json][snapshot]. The external PR named by the issue was not inspected.
- [Spec 015 D1/D8/D9](../spec.md), [status amendment dated 2026-10-27](../status.md), and board rows 015-82/015-90 at the examined commit.
- [Version-pinned source tree][source]: `src/core/code/crap/{loaders,file,join,judge,checks}.ts`, `src/core/code/pass/included.ts`, `src/runners/node-test/adapter.ts`, `src/core/code/coverage/mapper.ts`; probe follows the real adapter example in `test/runners/node-test/coverage.test.ts`.
- [Probe source, command and full output][probe]. Findings tagged as experiments use this run; policy conclusions use the cited repository text, not recalled APIs.

[issue]: https://github.com/hearsay-tools/squeal/issues/122
[source]: https://github.com/hearsay-tools/squeal/tree/15f73a3110c4f6aaa85171ac0dffdbb8575dff5a/src
[probe]: probes/issue-122/
[snapshot]: probes/issue-122/issue.json
