# Issue 305: startup and selection triage

2026-11-27. Recommendation: diagnose startup and inventory freshness together,
but keep their reproduction verdicts separate; the evidence does not establish
that Git tracking caused the rejected selection.

| Question | Answer and evidence |
| --- | --- |
| Does the prolonged fresh-worktree startup stall reproduce? | **Not reproduced.** Installed 0.1.657 in this Squeal worktree progressed from the starting header to first results, 2,279 of 2,340 files current, and then `testFilesListed: true`, daemon alive. Original repository/configuration and incident diagnostics were not reproduced. |
| Does a new untracked test get rejected? | **Partially reproduced, synthetic inventory boundary only.** Source 0.1.659 selects nothing when the path is absent from inventory and the stub runner reports no affected tests; the CLI prints the reported phrase and returns 3 despite a 30 s wait budget. The same path in inventory selects itself. No real untracked file or Git-index transition was tested. |
| Is either cause known? | **Not determined.** No original daemon log, configuration, inventory snapshot or startup-stage evidence is attached to #305. A repeated delivery header alone does not identify which startup operation stalled. |
| Is this an established duplicate? | **No shared cause established.** #291 and #176 overlap startup; #142 overlaps premature unmatched-path language. #305 names `run tests`, whereas #142 names `status --wait`. |

## Environment and bounds

**Verified by experiment**, 2026-11-27, installed Squeal **0.1.657**; source
**0.1.659**, commit `50018290bd0b08355c7be3e8f99d4f600763c1ce`.
Node `v26.13.0`. The 0.1.657 tag is
`d129f7dee3ff6763e0142c17cde64b262be2af1a`.

Local `uptime` at 20:46:45 Europe/Warsaw reported load **3.08, 2.65, 1.60**;
at 20:48:26 it reported **2.32, 2.45, 1.63**. `getconf _NPROCESSORS_ONLN`
returned **16**; `lscpu` reported AMD Ryzen 9 5950X 16-Core Processor. Load was
below the CPU count. Only cheap read-only commands and the synthetic source
probe ran locally. No isolated install, live reproduction fixture, full suite,
benchmark or restart was attempted. Boat.dev instructions were read; no heavy
or isolated work was needed. This is bounded triage, not a startup benchmark.

Commands below use `SQUEAL` for the session launcher:

```sh
SQUEAL=~/.codex/plugins/data/squeal-hearsay/bin/squeal
"$SQUEAL" --version
# 0.1.657
"$SQUEAL" checks
# squeal.config.json has no checks key; these are the default checks.
# tests
#   Selects: the test files no other check selects
#   Test files now: 2340
#   Runs: after each edit
#   Last result: 2279 pass, 61 not current
"$SQUEAL" status --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps({k:d.get(k) for k in ["revision","testFilesListed","daemon","testFiles"]}))'
# {"revision": 1, "testFilesListed": true, "daemon": {"state": "alive", "lastHeartbeatAt": 1795808924370}, "testFiles": null}
```

The last `testFiles: null` comes from this projection's absent top-level key,
not a missing-inventory claim. No test-suite pass is claimed; 61 files were
not current at the checks read.

## Selection boundary

**Verified by experiment**, source 0.1.659. Command, exit 0, output:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-305/probe.ts
```

```json
{"inventory":"missing","selected":0,"unmatched":["packages/web/src/components/page-shell/page-shell.test.tsx"],"affectedCalls":1}
{"waitMs":30000,"code":3,"output":"Selected test files of group tests have no verdict: these paths select none\nGroup tests at revision 1: these paths select no test file of it.\npackages/web/src/components/page-shell/page-shell.test.tsx selects no test file of any group.\n"}
{"inventory":"listed","selected":1,"unmatched":[],"affectedCalls":1}
```

The entire command completed in about 1.4 s, including TypeScript startup.
The stub supplies a missing inventory entry and no affected readers; it does
not prove those inputs occurred in the original incident. The listed control
requires no additional affected lookup. The probe and its limitations are
preserved under [probes/issue-305](probes/issue-305/README.md).

**Read in source code**, 0.1.657 and 0.1.659:

- `src/core/scheduler/narrow-run.ts:52`: `selectNarrow` finds an own test by
  matching `ledger.files` references. Otherwise it asks `runner.affected`,
  uses known readers and marks an empty selection unmatched. This function
  does not consult Git tracking or discover new tests by group glob.
- `src/cli/run-group-narrow.ts:164`: after the daemon takes the request, an
  empty selected set returns exit 3 before entering the group wait. Its
  `narrowText` prints the reported phrase for unmatched paths.
- `src/core/delivery/header.ts:52`: the starting delivery line is chosen
  when `header.testFilesListed === false`, with separate liveness clauses.
  It does not itself identify a blocked startup stage.

Version check, empty output:

```sh
git diff --name-only squeal--v0.1.657 HEAD -- src/core/scheduler/narrow-run.ts src/core/scheduler/edit-cut.ts src/core/scheduler/slow.ts src/core/scheduler/runner-work-bound.ts src/cli/run-group-narrow.ts src/core/delivery/header.ts
```

**Read in source code**, 0.1.659: `Daemon.#requestGroup` awaits `#starting`
before calling the scheduler. The scheduler's narrow request documents an
after-request reconciliation prerequisite. Thus an empty taken request and
a request still awaiting daemon startup are distinct states. **Inferred**:
the issue's two observations should not be collapsed into one cause without
recording when the request was accepted and what inventory it read.

## Overlap and next evidence

**Read in source code / fetched issue reports**, versions as reported:
#291 (0.1.641) names a request pending behind startup for 93 s; #176 (0.1.427)
names startup locks and missing heartbeats under load; #142 (0.1.390) names
`status --wait` claiming no closure while discovery was pending. These support
related diagnosis, not a duplicate or a causal conclusion. Existing
`test/cli/named-wait-starting.test.ts` covers the named-status distinction;
it is not evidence that the narrow-run command has the same handling.

Capture the original repository's Squeal/Vitest configuration, daemon version
and log, `status --json`, `checks`, and tracked/untracked status at the rejected
request. A bounded fixture on boat.dev can then distinguish startup delay,
discovery omission, configuration exclusion and stale inventory. Do not infer
a remote-sync or store-lock cause from the current report.

Sources fetched with `gh issue view <N> --repo hearsay-tools/squeal --json ...`:
[#305](https://github.com/hearsay-tools/squeal/issues/305),
[#291](https://github.com/hearsay-tools/squeal/issues/291),
[#176](https://github.com/hearsay-tools/squeal/issues/176),
[#142](https://github.com/hearsay-tools/squeal/issues/142).
Related prior work: [issue-291.md](issue-291.md), [issue-176.md](issue-176.md),
[issue-142.md](issue-142.md); spec 011 C2/C4/C6/C9/C15 and spec 019 D6.
