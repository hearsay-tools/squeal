# Issue 219: an enabled provider does not cover the repository lint command

Recommend naming the checked lint provider in the commit summary and making
its coverage limit clear. Keep this scope question distinct from #170's
unavailable-provider question. The deciding tradeoff is truthful coverage
against a short generic label. A valid oxlint pass does not prove that the
repository's other lint rules pass. This recommendation authorizes no build;
existing holds stand.

## Questions and verdict

The brief's questions are numbered here. Sources are pinned below. Evidence
tags apply to the examined versions, not to an unobserved original session.

| Question | Answer and evidence tag |
| --- | --- |
| Q1. Can working oxlint return no findings while separate repository lint fails on ast-grep? | **verified by experiment**, Squeal source 0.1.497, oxlint 1.90.0, ast-grep 0.51.0: yes, in a one-file fixture using the actual `active-run-literal` rule and baseline comparator. |
| Q2. Can that result produce both `PASS … (oxlint): no findings` and `lint 0 findings`? | **verified by experiment**, 0.1.497: yes, through the real transition, tally and text functions with an explicit synthetic commit view. No daemon delivery was replayed. |
| Q3. Does supported lint include an arbitrary repository lint script? | **read in source code**, 0.1.497 and identical relevant 0.1.488 files: no. Supported tools are ESLint and oxlint. The oxlint provider runs its own CLI over named files. |
| Q4. Is this the same failure condition as #170? | **inferred**, from the fetched #170 report (0.1.424), fetched #219 report (0.1.488), and this 0.1.497 experiment: no. #170 concerns an off/unknown provider. This reproduction has a working provider and current pass, but another rule set is outside its scope. |
| Q5. Was the original incident fully reproduced? | **not determined, because** the original task state, committed file and CI run were not replayed. The provider/summary mismatch is reproduced at component level; the delayed Vitest wrapper failure remains reporter evidence. |

## Q1–Q2: bounded reproduction

**verified by experiment** (versions above). Before live probes,
`cat /proc/loadavg` reported one-minute load 6.13;
`getconf _NPROCESSORS_ONLN` reported 24 CPUs. The successful probe independently
recorded load 5.93 and 24 CPUs on its first run. The final run, with the
source-hash guard, recorded 6.07 and 24 CPUs at 2026-11-14 19:03 Europe/Warsaw
and is saved in `result.json`. It checked load before each case. No load gate
was exceeded.

Exact probe command from the repository root:

```sh
timeout 45s pnpm exec tsx research/probes/issue-219/run.mts > research/probes/issue-219/result.json
```

It exited 0. It used Node 26.13.0, pnpm 12.15.0 and tsx 4.23.15. Every child
has a 15-second bound; the real oxlint provider retains its 5-second guard.
The fixture has `lint.enabled: true`, `lint.tools: ["oxlint"]` and an explicit
`no-unused-vars: error` rule. The probe opens that provider directly, verifies
that the file is covered and rejects off or unknown results. No daemon loads
the fixture policy.

| Same fixture file, successive contents | Actual oxlint findings | Fixture `pnpm run lint` exit | Real commit formatter |
| --- | ---: | ---: | --- |
| `ActiveRun` literal plus unused variable | 1 | 1 | `lint 1 finding` |
| Remove only unused variable | 0 | 1 | `lint 0 findings` |
| Replace literal with factory call | 0 | 0 | `lint 0 findings` |

The mismatch case contains:

```ts
type ActiveRun = { a: number };
export const run: ActiveRun = { a: 1 };
```

The real provider returns `findings: []`. The real ast-grep rule finds one
`active-run-literal` match. The real repository baseline comparator reports
one added match against the fixture's empty baseline. Its separate `lint`
script exits 1. The actual formatter output is:

```text
PASS lint: packages/cezar/src/workflows/issue-219.test.ts (oxlint): no findings
Commit abcdef0: 0 known failures; lint 0 findings
```

The positive control proves oxlint is working, rather than disabled or skipping
the file. The clean control proves the ast-grep failure follows the literal.
The commit view is synthetic: actual provider findings, one changed file,
equal committed/working blob, no differing config inputs and no tests. It
does not exercise a stored report or a real commit. The lint script is a
one-file reduction using real tools and the repository helper, not the full
Cezar `lint` command. The fixture and exact child commands are in the probe.

## Q3–Q4: what the code and contracts establish

**read in source code**, Squeal `1c74feb5768324fc89e894e9989e445d7b25b480`
(package 0.1.497): `src/core/types/lint.ts` and `lint/store/checks.ts` define
only `eslint` and `oxlint`. `lint/provider/oxlint/provider.ts` calls oxlint
with `--format json --threads 1 -- <paths>`. It does not call `scripts.lint`.
`commit/lint.ts` counts recorded checks. `CommitLintCounts` in
`commit/report.ts` contains counts, with no provider identity. `commit/text.ts`
prints `lint ${plural(lint.findings, "finding")}`. Per-file
`lint/surface/format.ts` does retain `(oxlint)`.

**read in official docs**, repository contracts at that same commit: 017 D2
defines a check as one file and one tool. D11 specifies oxlint as a second
provider and names it per file. D8 and 019 D5 use generic lint totals. These
contracts explain the current output; they do not promise to execute all
commands in a repository's `lint` script.

**read in source code**, local Cezar revision
`cc34d00d6fb8fa838f533d59c9a2d9eba1bf7a01`: its root `package.json` runs
`node packages/cezar/src/lint/run.ts`. That runner explicitly runs oxlint,
then ast-grep against baselines, plus repository-wide checks. The copied
`active-run-literal.yml` matches typed or cast literals; it is not an oxlint
rule. The examined helper and rule had no local changes.

**read in source code**, version comparison: `git diff squeal--v0.1.488 HEAD --`
over `src/core/commit/{lint,text,report}.ts`,
`src/core/lint/{transition.ts,surface/format.ts,store/checks.ts}` and
`src/core/lint/provider/oxlint/{provider,run,output}.ts` was empty. The reported
tag resolves to `3c36573b66619a11beaafa73304b8e7ac1c47200`.
This supports the same mechanism in 0.1.488; that release was not run.

**inferred**, versions above: repairing #170's availability wording alone
would leave this mismatch. Here all examined oxlint evidence is current and
complete. Ast-grep has no provider check to count as unknown. The later wrapper
failure would enter the test path, not the oxlint check; that timing was not
tested. The report's cost and original CI failure remain unverified.

## Open questions and limits

Whether to add another lint provider or run a project command is a product
decision, not established by this experiment. How to detect extra lint scope
reliably from arbitrary scripts is also not determined. The bounded probe
supports a coverage-label decision without requiring either capability.
No product, spec, status, skill or board file changed. No installation, build,
full lint scan, Vitest suite, daemon restart or CI run was requested.

Verification: the final bounded probe exited 0 and all three case assertions
passed. Local artifact links resolve. The affected check
`~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/017-lint-checks/research/issue-219.md research/probes/issue-219/run.mts`
exited 3: neither research file belongs to a test closure. It reported zero
known failures and 235 unknown test files out of 1,837. This is no suite-pass
claim; no suite run is needed for this documentation-only research.

## Sources and artifacts

- Fetched with `gh issue view 219 --repo hearsay-tools/squeal --json title,body,comments,url,createdAt,updatedAt`: [#219](https://github.com/hearsay-tools/squeal/issues/219), updated 2026-11-14. Original observations are reporter claims.
- Fetched with `gh issue view 170 --repo hearsay-tools/squeal --json title,body,url`: [#170](https://github.com/hearsay-tools/squeal/issues/170). Availability contrast only; not rerun here.
- [Squeal source at examined commit](https://github.com/hearsay-tools/squeal/tree/1c74feb5768324fc89e894e9989e445d7b25b480/src/core), paths cited above; [017 spec](../spec.md) D2/D8/D11 and [019 spec](../../019-run-triggers/spec.md) D5, with both amendment logs read.
- Local Cezar source: `~/projects/cezar` at the pinned revision above; `package.json`, `packages/cezar/src/lint/run.ts`, `packages/cezar/src/ast-grep-rules.testkit.ts`, `.ai/ast-grep/rules/active-run-literal.yml` and its rule tests.
- [Probe README](../../../../research/probes/issue-219/README.md), [script](../../../../research/probes/issue-219/run.mts), [captured output](../../../../research/probes/issue-219/result.json). The README pins external helper/rule hashes and documents the reduced command.
