# Issue 203: one edited test in a manual group

Recommend exposing the existing `--test <file>` escape in left-out guidance before changing selection semantics.

## Verdict and questions

The reported missing capability was **not reproduced**: installed Squeal 0.1.457
already runs one named manual-group test without its peers. The default
`left-out` result and group-only advice were reproduced. The original Cezar
100-file run was not attempted. Existing holds stand; this research authorizes
no implementation.

| Question | Answer | Evidence tag and version |
| --- | --- | --- |
| 1. Can `--test` include just the edited manual-group file? | Yes. The target and changed unit test ran; both manual peers did not, including when a shared helper selected them. | verified by experiment, Squeal 0.1.457 / Vitest 5.0.3 |
| 2. Does `--group browser` necessarily run every peer? | No. It admits files already selected by the diff. It ran one browser file in the narrow case and all three in the shared-helper case. | verified by experiment, Squeal 0.1.457 / Vitest 5.0.3 |
| 3. Does guidance hide existing support? | The left-out stderr and JSON `add` suggest only `--group`; the shipped command reference explicitly documents `--test` across groups. | verified by experiment (report), read in official docs (reference), 0.1.457 |
| 4. What selected roughly 100 files in the real incident? | Not determined, because the incident's exact diff, configuration and selection evidence were not supplied or replayed. A shared-helper fixture demonstrates one cause, not that incident's cause. | inferred from the issue and bounded experiment, reported 0.1.457 |

## Versions, method and commands

Examined checkout: `c2a6d371858c6fd4f05243ca383d0cfa2243f660`, package 0.1.459.
The live CLI was the installed **0.1.457** runtime, not the checkout bundle.
Every report confirmed `versions.squeal: "0.1.457"`, counter 5, coverage provider
3, coverage record 4, quality policy 4. Release source:
`squeal--v0.1.457`, commit `6c73ad9a84ba5db2eda36a001394752bc6866ec9`.
Node 26.13.0; Vitest 5.0.3 from existing dependencies. No install was run.

Read the incident with `gh issue view 203 --repo hearsay-tools/squeal --json title,body,comments,url`.
Read source and docs at the release with `git show squeal--v0.1.457:<path>`.
`git diff squeal--v0.1.457 HEAD -- src/core/code/gate/scope.ts src/core/code/gate/collect.ts src/cli/code-gate-text.ts src/cli/code-gate-args.ts`
was empty. Initial `cat /proc/loadavg` gave 17.46 (one minute);
`getconf _NPROCESSORS_ONLN` gave 24. Each live case checked again and was below
24. The six runs occurred on 2026-11-12 at 23:24 Europe/Warsaw.

[Probe commands and fixture](probes/issue-203/README.md) preserve the exact six
invocations. Each creates a fresh repository with a committed `main` base,
three manual-group test files and one unit test. Test callbacks write markers.
There is no real browser, global setup, server, daemon, or 100-file suite.
Every Vitest project uses `maxWorkers: 1`. Fresh repositories prevent evidence
from earlier cases replacing a run.

Inside each generated repository the command is:

```sh
/home/agent/.nvm/versions/node/v26.13.0/bin/node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.457/dist/cli/squeal.mjs code --base main --json --timeout 20
```

The `test` case appends `--test e2e/target.test.ts`. The `group` case appends
`--group browser`. Each invocation records its exact command and working
directory. Generated outputs are ignored and are not committed.

## Findings

**1 and 2, verified by experiment, 0.1.457.** `narrow` edits only the target
callback and unit callback. `shared` also edits their common helper, imported
by both untouched peers. Here `target` is `e2e/target.test.ts`, peers are
`e2e/peer1.test.ts` and `e2e/peer2.test.ts`, and `unit` is `unit/basic.test.ts`.

| Shape | Flag | Load / 24 | Actual files run (markers and JSON agree) | Gate exit / verdict | Wall ms |
| --- | --- | --- | --- | --- | --- |
| narrow | none | 17.30 | unit | 3 / incomplete | 1752 |
| narrow | `--test` | 16.98 | target, unit | 0 / pass | 1791 |
| narrow | `--group` | 18.99 | target, unit | 0 / pass | 1499 |
| shared | none | 18.99 | unit | 3 / incomplete | 1409 |
| shared | `--test` | 18.99 | target, unit | 0 / pass | 2048 |
| shared | `--group` | 20.59 | target, both peers, unit | 0 / pass | 2078 |

All six probe assertions passed. Every selected file completed; all reports
had empty `failed` and `notFinished`. Without an override, the edited target
was `incomplete`, `gap: "left-out"`, with its own path in `loaders.leftOut`.
With `--test`, it was measured and passed. In the shared case the helper
passed with both peers still in `loaders.leftOut`: the measured files supplied
enough coverage under D5/D14. This does not guarantee every real change passes
after one file runs.

**1 and 2, read in source code, 0.1.457.** `collect.ts:select` builds a union
of changed test paths, explicit tests, affected files and declared inputs.
`scope.ts:tallyScope` then admits a file with
`if (place.inScope || tests.has(ref.path)) run.push(ref)`.
`--test` is additive, not an exclusive selection mode: other automatically
selected in-scope tests still run. `--group` changes scope, not that initial
union. Spec 020 D14 says "`--test` files always run"; D3 defines the union.
Spec 019 D1 says "A group selects; it never adds"; D6's daemon narrow-run
command is a separate interface, not the changed-function gate.

**3, verified by experiment, 0.1.457.** Default narrow stderr said:

```text
squeal code: browser (manual) is left out: 1 of its 3 test files loads changed code; add --group browser to run it
```

JSON had `scope.leftOut: [{name:"browser", at:"manual", files:3,
selected:1, add:"--group browser"}]`. Neither supplied `--test` advice.
After narrow `--test`, stderr said "none of its 3 test files loads changed
code", although the target had run. The tally counts selected files still
left out, so this wording also obscures what the count means.

**3, read in official docs and source code, 0.1.457.** The shipped
`references/commands.md:116` already says "`--test` files run whatever their
group." `scope.ts:addGroup`, `code-gate-prerun.ts:leftOutLine` and
`code-gate-text.ts:loadsChangedText/leftOutText` explain why the report offers
only a group flag. This follows D14.3's group-oriented guidance. It is a
discoverability gap in the report, not an absent or wholly undocumented flag.

## Recommendation and limits

**Inferred, from 0.1.457 evidence:** make existing per-file selection visible
where `left-out` is reported, while retaining group scope for users who want
all affected loaders. That preserves D3/D14 and avoids a new selection rule.
The narrower command to investigate in the original worktree is
`squeal code --base origin/main --json --test packages/web/e2e/project-rail.e2e.ts`.
It was not run there. It can still run required setup and other selected
in-scope tests; it does not promise a pass or cheap browser startup.

Open questions: which exact diff/config dependency or declared input selected
the incident's peers; whether its real browser project accepts this narrow
run; and how much its global setup costs. These need the incident workspace
and a separately authorized, load-checked investigation. The issue records
two incomplete callbacks, roughly 100 files and an aborted group run; these
remain reporter evidence, not measurements from this probe.

Verification: `node --check` on the probe passed. The required affected check,
`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/020-quality-gate/research/probes/issue-203/run.mjs`,
exited 3: no test file's closure holds the research script. At revision 2 the
worktree had 0 known failures, 631/1736 test files not current (1 queued,
630 unknown), and 9 queued tests. This is not a product-suite pass; the six
direct, task-required probe runs supply the research evidence.

## Sources

- [Issue 203](https://github.com/hearsay-tools/squeal/issues/203), fetched with `gh` above; no comments at read time.
- [Release selection](https://github.com/hearsay-tools/squeal/blob/6c73ad9a84ba5db2eda36a001394752bc6866ec9/src/core/code/gate/collect.ts), local `src/core/code/gate/collect.ts:select`.
- [Release scope](https://github.com/hearsay-tools/squeal/blob/6c73ad9a84ba5db2eda36a001394752bc6866ec9/src/core/code/gate/scope.ts), local `src/core/code/gate/scope.ts:tallyScope/addGroup`.
- [Shipped command reference](https://github.com/hearsay-tools/squeal/blob/6c73ad9a84ba5db2eda36a001394752bc6866ec9/plugins/claude-code/skills/squeal/references/commands.md#L112), lines 112–116; release `src/cli/code-gate-prerun.ts` and `src/cli/code-gate-text.ts` for report wording.
- [Spec 020](../spec.md), D1/D3/D5/D7/D14 and [decision log](../status.md); [spec 019](../../019-run-triggers/spec.md), D1/D6 and its status log, read at checkout `c2a6d371`.
- [Reproducible probe](probes/issue-203/run.mjs); only synthetic execution is claimed. No product suite, build, or full-suite checkpoint was run.
