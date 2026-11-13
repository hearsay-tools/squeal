# Issue 205: the gate loses per-file part refusal reasons

Recommend reporting why a selected file's part evidence was refused, while keeping every reuse check intact.

The diagnostic gap is reproduced on Squeal **0.1.460**. A usable part held passing results and coverage records for two files. The accepted control reused both. Changing one recorded input hash made the gate run that file, but neither JSON nor stderr said why. Both gates passed with exit 0. This is evidence of missing diagnostics, not unsafe reuse.

## Questions and verdicts

The brief states one reproduction task. These questions split its required evidence.

| Question | Answer and evidence tag | Version examined |
| --- | --- | --- |
| 1. Does a usable part's per-file refusal lose its reason? | **verified by experiment**: yes; JSON says `run`, stderr gives only counts and the run estimate. | Squeal 0.1.460, Node 26.13.0, Vitest 5.0.3 |
| 2. Is the control accepted, with the safety check still active? | **verified by experiment**: both files are `parts` before mutation; afterwards only the mismatched file is `run`. Both runs exit 0, verdict `pass`, no timeout. | Same |
| 3. Where is the explanation lost? | **read in source code**: `uncertified()` returns paths; `taken()` reduces that to `null`. No per-file note or refusal data reaches the report. | 0.1.460 tag; matching `parts.ts` and `inputs.ts` in checkout 0.1.463 |
| 4. Does this identify the original 148 files' cause? | **inferred**: no. The synthetic mismatch proves the reporting gap only. The original refusal causes are not determined because its artifacts and checkout were not replayed. | Incident reports 0.1.460 |
| 5. What do D7 and D13.2 require today? | **read in source code** (repository spec): D13.2 names evidence origin and strict reuse conditions; D7 describes the report. Neither explicitly requires per-file refusal reasons. | Spec at `2df6d0f2949099de1e9a5fc5805268fcbcf52398` |

## Experiment

**verified by experiment; Squeal 0.1.460.** The probe ran on 2026-11-13 at 02:09:38–02:09:41 Europe/Warsaw (01:09:38–01:09:41 UTC). The initial shell check was load **15.71 on 24 CPUs**. Immediately before the fixture, recording, accepted gate and refused gate, the script recorded **9.76 on 24 CPUs**. All checks were below the task's limit.

Reproduction command, from this worktree's root:

```sh
node docs/specifications/020-quality-gate/research/probes/issue-205/probe.mjs
```

The script invokes the following with `CI=true` in its disposable fixture. `$probe_cli` denotes `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal`; `$probe_vitest` is this worktree's absolute `node_modules/vitest/vitest.mjs`. Exact expanded arguments are in `evidence/commands.json`.

```sh
"$probe_cli" --version
"$probe_cli" ci record --out parts -- /home/agent/.nvm/versions/node/v26.13.0/bin/node "$probe_vitest" run
"$probe_cli" code --base HEAD --json --timeout 30 --parts parts
# Change only part.evidence["test/refused.test.ts"] to 40 zeroes.
# Remove only this disposable fixture's .git/squeal stores.
"$probe_cli" code --base HEAD --json --timeout 30 --parts parts
```

One source changes from returning 1 to returning 2. Two tests check that its result is positive. Recording produces one `squeal-ci-part/4` part, two passing files and two coverage records (provider version 3, record version 4). Vitest uses one worker. The source and tests are unchanged between the two gates. The only part mutation is the input hash of `test/refused.test.ts`, from `44f9950c69e2b7c0400c25517c1324f94dd1ed6e` to forty zeroes. Its passing result and record remain present.

| Gate | `test/accepted.test.ts` | `test/refused.test.ts` | Exit/verdict |
| --- | --- | --- | --- |
| Accepted control | `parts` | `parts` | 0 / pass |
| Refused input hash | `parts` | `run` | 0 / pass |

The refused case's complete stderr is:

```text
squeal code: Vitest: 2 test files selected (tests 2): 1 to run, 1 read from the parts
squeal code: Vitest: 1 test file to run here, up to 1 at once; no stored duration, so the time is unknown
squeal code: 1 of 2 selected test files read from the parts
```

Its JSON contains the two `from` values above, with no refusal field or input path explaining the decision. The source function has coverage 2/2 and CRAP 1. No assertion failed. No part-wide or environment refusal message appears. The still-accepted sibling proves the part remains usable.

## Source explanation and spec boundary

**read in source code; 0.1.460.** In `src/core/code/gate/parts.ts:105–133`, duplicate ownership and missing closures skip candidates without a note. Environment differences have a note. In `taken()` at lines 189–199, uncertified inputs, absent passing-file records, unread changed paths and differing source blobs return `null` without a note. `src/core/ci/inputs.ts:216–225` computes the uncertified path list, but `taken()` uses only its length. This probe exercises the input-hash branch alone.

`src/core/code/gate/runs.ts`, `sourcesOf()`, emits `f.from ?? "run"`. It omits `from` entirely when every file ran locally. Thus the report carries origin, not the reason reuse failed. The two-file fixture keeps one accepted file so that the mixed-origin report matches the issue's shape.

These files were read from the local checkout and the local release ref `squeal--v0.1.460` (`18fe3988a6d8f38227d2b1c1b5df68b014398a53`). `parts.ts` and `inputs.ts` are byte-identical between that release and this checkout's 0.1.463. `runs.ts` later gained kept-log handling; `sourcesOf()` is unchanged.

**inferred; spec at checkout commit above.** D13.2's “Each test file in the report says where its evidence came from” supports explaining origin, but does not itself promise a refusal reason. Treat this as a demonstrated observability gap and an explicit report-contract addition for the coordinator to specify. The status log's 0.1.460 bounded reasons for keeping results concern later store writes, not this parts-reuse decision.

## Recommendation, limits and checks

**inferred from experiment and source; 0.1.460.** Preserve the strict fallback to running a file. Add actionable refusal evidence for a selected file present in a usable part, with bounded stderr output. The tradeoff is useful explanation against report size and noise; do not weaken certification to reduce reruns. The coordinator owns the field shape and spec amendment.

Open questions: which checks refused the original 148 files; how to distinguish a refused part followed by a store hit; and how much refusal detail belongs in stderr. This probe covers one reason, one project and one collector. It does not test all refusal branches, cross-host environments, the 1,815-file incident, or performance at scale. No implementation or product-policy change was made.

Checks: the bounded probe exited 0 with all assertions passed; recording ran two one-test files, the accepted gate ran none, and the refused gate ran one. Both gate budgets stayed below 30 seconds. `node --check research/probes/issue-205/probe.mjs` and `pnpm exec biome check research/probes/issue-205/probe.mjs research/probes/issue-205/evidence/*.json` passed (four files, no fixes). Captured JSON/stderr and local links also passed inspection. `squeal status --wait 60000 research/probes/issue-205/probe.mjs docs/specifications/020-quality-gate/research/issue-205.md` returned exit 3: neither path is in a test closure; worktree known failures 0, 1,029 of 1,751 test files unknown. This is no affected-test verdict, not a suite pass. No full suite, build or typecheck was run for these research-only files.

## Sources

- [Issue 205](https://github.com/hearsay-tools/squeal/issues/205), fetched with `gh issue view 205 --repo hearsay-tools/squeal --json body,comments,url`; incident figures are reported evidence, not independently verified here.
- [Spec D7 and D13.2](../spec.md), [decision log](../status.md), at checkout commit `2df6d0f2949099de1e9a5fc5805268fcbcf52398`.
- [Release `parts.ts`](https://github.com/hearsay-tools/squeal/blob/18fe3988a6d8f38227d2b1c1b5df68b014398a53/src/core/code/gate/parts.ts), [input certification](https://github.com/hearsay-tools/squeal/blob/18fe3988a6d8f38227d2b1c1b5df68b014398a53/src/core/ci/inputs.ts), [run report](https://github.com/hearsay-tools/squeal/blob/18fe3988a6d8f38227d2b1c1b5df68b014398a53/src/core/code/gate/runs.ts); read with `git show squeal--v0.1.460:<path>` and local file reads.
- [Probe and raw evidence](probes/issue-205/README.md), especially `evidence/summary.json`, `load.json`, `commands.json`, and accepted/refused stdout and stderr.

Coordinator integration: moved the probe from repository-root `research/probes/issue-205/` into this spec’s `research/probes/issue-205/` to match triage ownership. Updated its repository-root lookup and links; the captured commands above retain the original execution paths. Syntax checked after the move; no live rerun was needed.
