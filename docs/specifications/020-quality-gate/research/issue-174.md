# Issue 174: package e2e helpers behind a build wrapper

## Verdict and fit

Not reproduced, because the one-minute host load was 61.96 against 24 online CPUs. The triage instruction requires skipping live reproduction above that limit. No researcher or probe was started. This is a documentation-only triage, not evidence that the current runtime reproduces the incident.

The request passes the vision decision filter: supported collection through existing project tools can reduce blocking, while explicit missing-evidence reporting preserves provenance and uncertainty. Spec 020 owns the code-gate behavior (D1, D2, D3, D5, D6, D7); spec 003 D1/D5 owns the related node:test configuration and execution boundary. Related 020 D12 covers child-process coverage, not arbitrary build-wrapper orchestration.

## Reported evidence (not independently reproduced)

Source: [hearsay-tools/squeal#174](https://github.com/hearsay-tools/squeal/issues/174), agent-reported friction from hearsay-tools/cezarion.

The report names Squeal **0.1.426**, revision 12, clean head `c817e1302cd2c25df6593867352990b7bc96b225`, base `a015077ac239bca4912803daf17836b07dda6540`. Exact reported commands:

```sh
squeal hold -- npm run test:package -- packages/cezar/test/e2e/binary-names.test.ts
squeal code --base origin/main --timeout 900 --json
```

The package wrapper reportedly passed twice (68.5 s and 64.1 s). The gate reportedly exited 3 after 134681 ms: 22 pass, zero violations, one incomplete, no unfinished or failed selected tests. The incomplete function was `verifyBinary` at line 33 of `packages/cezar/test/e2e/binary-names.test.ts`, CC 9, null coverage/CRAP, empty expected/measured loaders, gap `no-loader`. A wrapper pass is test evidence; it is not by itself attributed function coverage for the gate.

## Contract reading

- **Read in specification:** 020 D2 counts changed JS/TS test functions. D3 selects and collects through configured runner adapters. D5 requires a loader and names `no-loader` as incomplete; D1 gives incomplete exit 3. The reported output is consistent with that contract, rather than proof of a measurement failure.
- **Read in specification:** 003 D1 describes Node executable, argv, environment, cwd and include/exclude configuration; D5 runs instrumented `node --test` per file. It does not specify an arbitrary repository build/test wrapper as a collection command.
- **Read in specification:** 020 D6 supports base-controlled `coverage.exclude`: it preserves CC, reports skipped coverage, and never counts skipped as pass. This is a policy option, not authorization to exclude this helper or remove its assertions.
- **Inferred:** a bounded proposal should distinguish wrapper integration from early reporting of unsupported helpers. The issue does not establish that a direct node:test project can reproduce the wrapper's build, packed/alias/linked/managed binary setup, and release-switch matrix.

## Duplicate check and decision

Searched origin/main's board for `#174`, `no-loader`, `binary-names`, `verifyBinary`, `build wrapper`, and `package e2e`. No existing #174 row or exact symptom row was found. Listed all open issues with labels, including `triaged`. #167 owns the broader shared gate; #172 concerns server/browser selection; #144 concerns child-only execution; #149 concerns fixture classification; #165 concerns unsupported-language/no-loader reporting. These overlap but do not duplicate required package-wrapper collection.

Human decision: approve a bounded spec 020 extension for supported wrapper-based measurement and pre-collection diagnostics, or retain the current adapter boundary and use an explicitly approved base-policy skip for unsupported helpers. Neither path may turn missing evidence into a pass or require deleting useful installed-launcher assertions. Existing holds stand. No implementation is authorized by this row.

## Triage commands

Read-only commands executed for this record:

```sh
git fetch origin
gh issue view 174 --repo hearsay-tools/squeal --json title,body,state,labels,url
git show origin/main:docs/board.md
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
rg -n '#174|no-loader|binary-names|verifyBinary|build wrapper|package e2e' /tmp/issue174-board.md
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
```

`/tmp/issue174-board.md` was a local read-only snapshot of origin/main's board. No live test or code-gate command was run. Tests are not required for this documentation-only change.
