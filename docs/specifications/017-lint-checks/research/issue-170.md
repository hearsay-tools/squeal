# Issue 170: a zero lint count does not establish completion

Recommend a scoped correction that preserves lint availability and incomplete
coverage in the commit summary. Existing holds remain; this research authorizes
no implementation.

**Verdict: reproduced at the store-reader and formatter boundary.** The real
code prints `lint 0 findings` both when oxlint is off with no stored checks and
when all 25 synthetic checks have passing results. Unknown checks keep the zero
prefix and add `25 files not determined`. This confirms the reported wording
without reproducing the separate oxlint timeout in #140.

## Scope, versions and method

Examined on 2026-11-10. Issue [#170](https://github.com/hearsay-tools/squeal/issues/170)
reports Squeal 0.1.424, revision 20, in Claude Code. Source checkout:
**0.1.425**, `241b0112a81174f5c40dd0ca7b33ba181d9aadf8`. Repeated on the exact
**0.1.424** tag, `5c1d8d8d8d55641f87905282a108e761c10e58fb`, archived into a
temporary directory. Runtime: Node v24.22.1, Linux, 24 logical CPUs.

Pre-probe load was 7.45 / 24 at 13:10:27 UTC. Each probe checked load again:
6.05 for 0.1.425; 4.41 for the first tagged run; 6.45 for the clean tagged
repeat; 7.35 for the final 0.1.425 run. All were below the CPU count. Each command had a 30-second timeout;
each completed in under one second as measured by the command tool.

The fixture uses Squeal's real SQLite store, `readLintCounts`,
`commitReportText`, `countsOf`, `reasonsOf` and `lintStatusLines`. It seeds
synthetic state and compares results with assertions. It neither starts a
daemon nor invokes oxlint. The commit label is synthetic, not the original
reporter's commit. The full commands and raw output are preserved under
[`research/probes/issue-170`](../../../../research/probes/issue-170/README.md).

## Questions and evidence

| Question | Method | Answer and evidence tag |
| --- | --- | --- |
| 1. Does off lint become `lint 0 findings`? | Synthetic SQLite store with the recorded oxlint off reason, real readers and formatters. | Yes when policy is enabled and the store has no checks. Policy-disabled control omits lint instead. **verified by experiment**, 0.1.424 and 0.1.425. |
| 2. Does unknown lint become the same prefix? | Seed 25 unknown oxlint checks, with and without a tool-off record. | Yes: `lint 0 findings, 25 files not determined`. **verified by experiment**, both versions. |
| 3. Can the zero line distinguish complete pass from unavailable evidence? | Store 25 pass results at matching committed blobs and matching recorded inputs. | No: complete-pass and off/empty cases have identical commit lines. **verified by experiment**, both versions. |
| 4. Where is availability lost? | Read the count producer, report type and formatter, then compare with ordinary lint status. | The report has three counts but no off reason or coverage total; its producer iterates stored states. **read in source code**, both versions. |
| 5. Must #140 be reproduced to establish #170? | Compare the injected off reason with the real pass's metadata writer. | No for the summary defect. The original timeout and CI failure remain unverified. **inferred**, both versions. |

All five probe controls passed on both versions. The pass means that the
observed defect and controls matched the assertions, not that lint passed.

| Synthetic state | Commit lint text | Ordinary lint status |
| --- | --- | --- |
| Policy disabled | No lint clause | Omitted by fixture |
| Policy enabled; oxlint off; zero stored checks | `lint 0 findings` | `Lint: off: the oxlint run failed 3 times; timed out after 5 s.` |
| Oxlint off; 25 unknown checks | `lint 0 findings, 25 files not determined` | Same off line |
| 25 unknown checks; no off record | `lint 0 findings, 25 files not determined` | `25 unknown`, plus the timeout reason |
| All 25 checks pass at committed inputs | `lint 0 findings` | `Lint: 0 files with findings; squeal lint lists them.` |

## Cause and contract

**read in source code, 0.1.424 and 0.1.425:**
`src/core/commit/lint.ts:readLintCounts` gates on `lint.enabled` and store
readability. It does not gate on the provider's off metadata.
`lintViewOf` reads states and key inputs, but not off reasons. `lintTally`
starts all three counts at zero and visits stored states of changed,
committed paths. With no states it returns three zeroes even when the commit
contains 25 synthetic paths. Unknown states increment `notDetermined`.

`src/core/commit/report.ts:CommitLintCounts` carries only `findings`,
`notDetermined` and `running`. `src/core/commit/text.ts:commitReportText`
unconditionally starts any present lint part with `lint N findings`, then
appends incomplete counts. Thus changing only the formatter cannot distinguish
an off/empty report from a complete-pass report: both contain the same counts.

The ordinary status path reads tool-off metadata through
`src/core/lint/surface/snapshot.ts:reasonsOf`; its formatter checks `off`
before printing counts. `src/core/lint/pass/run.ts` records real provider-off
results through `writeOff`, the same writer used by this probe. `commitLint`
also uses `lintTally`; `lintWaitEnded` checks `passOff` to end a wait, but that
does not add availability to the report. The observed seam is not oxlint's
process timeout implementation.

**read in official docs, checkout 0.1.425:** 017 D2 distinguishes `pass` from
`unknown`; D8 requires `Lint: off: <reason>`; D9 makes restart exhaustion off
and affected timeout files unknown; D11 applies those states and surfaces to
oxlint. 011 C6 requires explicit unknown and incomplete status. The commit
report is additionally specified by 019 D5, which `commit/text.ts` cites.
These contracts support preserving uncertainty at this surface.

**inferred, both versions:** trustworthy state is the deciding tradeoff.
A zero finding count is useful only with its availability and scope. The
coordinator should treat this as a report-evidence and wording problem, not
as proof that the timeout fix would make the summary sound. This is a
recommendation, not an interface design or an implementation approval.

## Limits and verification

No original Cezar worktree, Claude Code delivery, failing CI job, real oxlint
run, three-timeout sequence, mixed-tool case or stale historical commit
report was reproduced. Whether the original bare-zero line arose from absent
states or another stored-state combination is **not determined, because the
reporter's lint database was not supplied**. Synthetic absence proves the
mechanism, not that historical cause. Bundle output was not tested.

The first tagged run's `pnpm exec` automatically attempted dependency
verification/install through the linked `node_modules`, reported 13 packages
removed, then refused ignored build scripts. It still ran the probe to exit
0. That raw log is retained. The clean repeat set
`--config.verifyDepsBeforeRun=false` and passed without installation output.
No explicit install command, build, Vitest run or full-suite request was made.
The side effect changed ignored dependency metadata and caused Squeal to mark
its prior test results pending. No suite pass is claimed. Final probe execution passed all five controls;
`pnpm --config.verifyDepsBeforeRun=false exec biome check research/probes/issue-170/probe.ts`
passed, and `git diff --check` passed.

The required affected read was:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-170/probe.ts docs/specifications/017-lint-checks/research/issue-170.md
```

It returned exit 3 at revision 12: no test closure holds either owned path;
1 known failing test; 573 of 1572 test files not current (200 running, 373
queued). `squeal why` identified `test/lint/integration/pnpm-shim.test.ts`,
with ESLint 10.13.0 unable to find `eslint-config-hoisted` at revision 8.
This appeared after the automatic dependency mutation; causality was not
isolated. The failure is reported, not repaired or retried in this bounded
research task. The probe's own assertions are the verification for this
research artifact.

Source-read commands included:

```sh
gh issue view 170 --repo hearsay-tools/squeal --json number,title,body,url,comments
git rev-parse HEAD
git rev-parse squeal--v0.1.424^{}
git diff squeal--v0.1.424 HEAD -- src/core/commit/text.ts src/core/commit/lint.ts src/core/commit/report.ts
```

The last command returned no diff. Primary sources are the fetched issue above,
[0.1.424 source](https://github.com/hearsay-tools/squeal/tree/5c1d8d8d8d55641f87905282a108e761c10e58fb/src/core),
[0.1.425 source](https://github.com/hearsay-tools/squeal/tree/241b0112a81174f5c40dd0ca7b33ba181d9aadf8/src/core),
[017 D2/D8/D9/D11](../spec.md), [017 decisions](../status.md),
[011 C6](../../011-core/spec.md), and the probe paths linked above.
