# Issue 279: declared inputs described as imports

Recommend approving factual selection provenance and a bounded other-worktree
failure note, with the matching rule decided before implementation. Neither
selection nor concurrent failures establish what caused a failure.

2026-11-25, researcher; documentation only. [Issue #279][issue]. Source examined:
Squeal 0.1.633, commit `fe0ba088e9607368dc0b76a689c3097673b59690`.

| Question | Answer and evidence |
| --- | --- |
| Are declared inputs described as imports? | **verified by experiment**, 0.1.633: yes. Production functions report all four synthetic failures as importing three paths supplied only by declared inputs. |
| Does delivery include concurrent same-check failures from other clean worktrees? | **verified by experiment**, 0.1.633, narrow scope: the non-timeout `PASS -> FAIL` attribution path never reads the offered other-worktree history. **read in source code**, 0.1.633: no general concurrent-failure field or renderer; `why` does read shared history and prints each result's clean/dirty provenance. |
| Was the original host failure reproduced? | Not determined independently. No Squawk test or live multi-worktree run was attempted. The issue's host diagnosis and CI pass remain reporter evidence. |

## 1. Declared selection loses its reason before rendering

**verified by experiment**, 0.1.633. The throwaway
[`probe.ts`](probes/issue-279/probe.ts) uses the issue's
three changed paths, `scripts/regression-proof.test.mjs`, and its declared glob
`packages/*/src/**/*.{ts,tsx}`. Its synthetic runner closure contains only the
test and `scripts/regression-proof.mjs`. Production `selectDeclaredInputs`
selects the three paths; `assembleClosure` adds them; `attribute` returns all
three as `changesInClosure`. Production text functions print:

```text
Runner imports intersect changed paths: []
All 4 failing tests import files changed here since this session started: packages/web/src/api/queries.ts, packages/web/src/routes/github/github.test.tsx, packages/web/src/routes/github/use-github-refresh.ts
```

The single-failure form also says `its imports include files changed here since
this session started`. Full output is in [`output.txt`](probes/issue-279/output.txt).

**read in source code**, 0.1.633. The path is:

- `src/core/keys/closure.ts:66` (`createDeclaredInputs`) matches declared globs;
  `assembleClosure` at line 176 unions runner paths, declared inputs and observed
  paths into one sorted set. The result records no per-path reason.
- `src/core/delivery/closure.ts:36` returns that stored path set after its
  worktree trust check. `attribution.ts:101` intersects it with the paths changed
  since registration, preserving the existing unknown/start-scan safeguards.
- `src/core/types/delivery.ts:145` gives delivery only `changesInClosure`, a path
  array. `provenance.ts:139` and `shared-closure.ts:31` label it imports.
  `format.ts:328` uses the shared formatter for failure delivery; line 610 uses
  it for known-failure rendering. `why-closure.ts` reads the same path facts.

This agrees with 011 C3's definition of closure, which includes declared and
observed inputs as well as imports. It conflicts with treating every closure
member as an import. C5's gh-32 amendment explicitly says the closure-touch line
is a fact, never a cause, and specifies `its closure reads files changed here
since this session started`. Spec 005's status records the later 005-92 wording
change in 0.1.525, including `Its imports include files changed here…`.

## 2. Shared evidence is available on request, not summarized in this delivery

**verified by experiment**, 0.1.633, synthetic scope. The probe's in-memory Store
offers two failing history rows, including a clean worktree at revision 0.
`attribute` receives four non-timeout `PASS -> FAIL` entries. It reports:

```text
Synthetic other-worktree failures available: 2 (1 clean at revision 0)
Other-worktree result-history reads by attribute: 0
Attribution-added fields: ["changesInClosure"]
Probe assertions: PASS; synthetic revision 1, registered at revision 0
```

This verifies the omission in that function, not a full harness/store execution.

**read in source code**, 0.1.633. `attribute` can read history for a timeout's
load, but `loadOf` selects the originating worktree's failure; it does not count
other worktrees. Its first-seen baseline is a different fact: `beforeEditsFor`
looks up the registration key, and can say the check already failed before the
session's edits. Neither mechanism summarizes concurrent same-check failures.
The transition type and provenance/shared renderers carry no such summary.

`src/core/status/why.ts:195` reads `listForCheck` across the shared store;
`src/core/store/repos/results.ts:108` filters by check identity, not worktree.
`format-why.ts:291` prints record time, worktree, revision, commit and `clean` or
`dirty`. This is evidence of cleanliness at the recorded run, not necessarily
now. C6 defines this pull history. C7 stores the newest row per check and key,
so same-key runs replace one another; history is also pruned. A future count
cannot claim to enumerate every worktree that has ever failed. C5's held-failure
confirmation and inheritance rules are separate from an informational note.

**inferred**, from those 0.1.633 sources. Reporting independent failures could
reduce investigation time while preserving uncertainty. Matching only a check
name can mix commits, inputs and failure causes. The human should decide the
required time window, failure fingerprint and path/cleanliness evidence before
implementation; none should imply that the edit is innocent or the failure safe
to ignore. Existing confirmation and inheritance rules should stay intact.

## 3. Versions, commands and limits

**inferred**, from unverified reporter evidence in [#279][issue], fetched with:

```sh
gh issue view 279 --repo hearsay-tools/squeal --json number,title,body,comments,url
```

The issue names 0.1.627 as current when filed, explicitly not recorded at the
incident. It reports delivery revision 1; `why` revisions 3 and 4; another clean
worktree at revision 0; and empty runtime readers. Those are quoted reporter
observations, not independent reproduction or proof of host causation.

**verified by experiment**, local environment and source comparison:

```sh
git rev-parse HEAD
# fe0ba088e9607368dc0b76a689c3097673b59690
cat /proc/loadavg
# Initial: 0.73 1.10 1.97; 16 CPUs from getconf _NPROCESSORS_ONLN
getconf _NPROCESSORS_ONLN
# 16
~/.codex/plugins/data/squeal-hearsay/bin/squeal --version
# 0.1.630 (session runtime; package.json is 0.1.633)
git rev-parse 'squeal--v0.1.627^{commit}'
# 3c6bd44aac143c9b84dfd29263de3bbea164e946
git diff --name-only squeal--v0.1.627 HEAD -- src/core/keys/closure.ts src/core/delivery/attribution.ts src/core/delivery/closure.ts src/core/delivery/provenance.ts src/core/delivery/shared-closure.ts src/core/types/delivery.ts src/core/status/why.ts src/core/status/format-why.ts
# No output: these traced files are unchanged since the reported release.
pnpm exec tsx docs/specifications/011-core/research/probes/issue-279/probe.ts > docs/specifications/011-core/research/probes/issue-279/output.txt
# Exit 0; Node v26.13.0; one-minute load 0.93, 16 CPUs; about 0.26 s.
```

The successful probe executes current source only; source equality is not a run
of the older installed bundle. Synthetic revision 1 is independent of the live
session's revisions. No new daemon, test suite, dependency install or heavy work
was requested. `squeal checks` reported 2,270 configured test files, with 594
pass, 8 fail and 1,668 not current at revision 1. Background notifications also
reported pre-edit revision-0 failures in unrelated CI, code-gate, runner and
timing tests. No claim that those checks pass, and no retries or repairs here.
Squeal said no test reads the probe; its assertions were run directly as above.
Later background news reported a Codex hook latency failure under the same
tracked inputs (87 ms against 80 ms); no attribution to these docs is established.

Open: the original host failure cause; the desired concurrent-evidence matching
rule; and how far historical facts can support the requested count after
same-key replacement or pruning. Owning sections: 011 C3/C5/C6/C7; related 005-92.

Sources: [011 spec](../spec.md), [011 status](../status.md),
[005 status](../../005-agent-adoption/status.md), the source paths above at
[examined commit][commit], and the preserved probe/output. No product or spec
changes are proposed as already authorized.

[issue]: https://github.com/hearsay-tools/squeal/issues/279
[commit]: https://github.com/hearsay-tools/squeal/tree/fe0ba088e9607368dc0b76a689c3097673b59690
