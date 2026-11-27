# Issue 307: missing new directory can escape a remote closure proof

Keep #307 open for a narrow investigation of remote closure completeness after an added directory, with #309 linked as a possible duplicate of the import symptom. **Partially reproduced on 0.1.665:** given an injected missed file delivery and a transform error with no runtime observation of that file, the real lane accepts the same file-level failure twice and calls both runs proven. **The original rebase, CLI retry and stored current FAIL were not reproduced.** No implementation or policy change is authorized by this research.

Examined 2026-11-28: source **0.1.665**, commit `8bda23d41341f9d98c892f8fb6ddf70542185f4b`, Node **v26.13.0**. Initial shell load **2.03 / 16 CPUs**; successful probe load **1.37 / 16** (five/fifteen-minute averages 1.68/2.52). The explicit bounded synthetic probe took about **0.33 s**, exit **0**. No heavy work, provider provisioning, SSH, real daemon/store, held resource or user configuration was used.

## Questions answered

| Question | Answer and evidence |
| --- | --- |
| Can a missing added file escape proof? | **Verified by experiment, 0.1.665, conditional:** the real graph walker drops the imports of a module whose synthetic transform throws; the real lane accepts its file-level failure when the absent file appears in neither closure nor observed paths. |
| Can another run repeat it? | **Verified by experiment, 0.1.665:** a second `lane.run` repeats the accepted error with no additional send. Full `squeal retry` behavior is **not determined**, because the daemon and CLI did not run. |
| Does proof recover when the candidate is known? | **Verified by experiment, 0.1.665:** adding that candidate to the control's proof paths detects the actual blob difference, sends it once and succeeds on attempt 2. Delivering the missing addition explicitly also recovers the first case. |
| Does rebase itself lose new directories? | **Not determined:** the probe injects the delivery gap and models the post-rebase tree delta; it neither executes a rebase nor exercises its watcher/sync pipeline. |
| Is #309 a duplicate? | **Inferred:** likely overlapping import symptom, not a proven identical cause. #309 also reports a later runner timeout/disconnection, outside this reproduction. |
| Should `not-run` fall back locally? | **Read in official docs, spec 026 D8.3 / 021 D13 and 2026-11-27 amendment:** no. The human explicitly kept refusal even for explicit run/wait requests after a resend fails. |

## Findings

1. **Read in official docs (issue reports, not independent incident verification).** [#307](https://github.com/hearsay-tools/squeal/issues/307) names 0.1.665, a docs-only branch rebased onto a base adding `page-shell/index.ts`, repeated aliased-import failures on eight web test files, and a failure remaining current after environment retry. Separate files report `its tree stayed different`, which establishes a refusal happened but does not prove those web tests had the same mismatch. CI being green does not itself establish equal runtime environment. [#309](https://github.com/hearsay-tools/squeal/issues/309) also names CLI 0.1.665, newly added sibling modules and repeated import failures; it later reports a 30-second runner-host timeout. Neither report tried a daemon restart. No reporter tree or remote filesystem was inspected here.

2. **Verified by experiment, 0.1.665.** The [probe](probes/issue-307/probe.ts), adapted from [issue 306's probe](probes/issue-306/probe.ts), uses real lane orchestration, `importClosure`, Git membership and blob hashes. Two small temporary trees start equal. The local tree gains a tracked `src/components/page-shell/index.ts` and an importer; only the importer is delivered. The synthetic transform throws when the addition is missing. The real graph walker returns only the test and importer. The synthetic runner returns a file-level error with actual proof hashes and no observed inputs. The lane's existing logic, rather than a hardcoded verdict, produces this [recorded result](probes/issue-307/result.json):

   | Case | Requests before explicit delivery | Accepted file errors | Proof / resend |
   | --- | ---: | --- | --- |
   | Transform failure omits target | 2, one per requested run | 1 on first run, 1 on repeated run; both completed | Both log `run proven over 2 paths`; no repair send |
   | Candidate explicitly included (control) | 3: two for first run, one repeat | 0 | First attempt refuses missing candidate; one resend repairs it |

   Explicit delivery of the addition then gives zero file errors in both cases, with proof over three paths. **Zero local runs** in every case. The result proves a conditional lane-level acceptance hole, not the stored `current` flag or the original incident. Initial probe execution failed due to a malformed synthetic `FileLevelError`; its corrected shape produced the recorded exit 0.

3. **Read in source code, 0.1.665.** `src/runners/vitest/graph.ts`, `importTargets`, catches any `transformRequest` error and returns `NO_TARGETS`. `importClosure` retains that importer itself, but cannot emit its missing import candidates when no dependency list survived. Its `resolutionCandidates` machinery helps only a missing target already represented in the graph. `src/core/runner-host/remote/lane.ts`, `runInputs`, chooses the remote planner under `planning: "remote"`; `differing` compares the paths the remote proof actually contains. `attempt` keeps a report when those hashes match. The source therefore explains the observed synthetic outcome. Whether real Vite supplies usable dependency candidates or the observer records the missing path for this specific alias remains **not determined**.

4. **Inferred, duplicate and ownership assessment.** #306 is related sync/proof machinery, but its reproduced outcome is refusal/unknown during racing edits, whereas #307 alleges an accepted current failure after settling. #309's import symptom can share #307's investigation; its connection failure should remain separately described unless evidence joins them. The applicable boundary is **026 D8 (remote planning), D10 (environment key separation), D12 (honest visibility)** and **021 D10/D11/D13** (tree delivery, proof, loss policy). No evidence supports changing `whenLost: "not-run"`, expanding current held work or claiming the 0.1.665 fixes already resolved this report.

## Recommendation and limits

**Inferred from source and probe:** authorize a narrow reproduction with the real Vitest transform/observer and the actual new-directory invalidation path. Capture the local and remote closure, missing candidates, observed paths and pre/post-run proof beside the delivery records. Establish why the added file was absent, and ensure an incomplete closure cannot certify its failure as current. Preserve the existing bounded resend and explicit no-local-fallback policy. Existing holds stand.

Not measured: real rebase delivery, alias resolution, warm Vite caches, runtime read observation, `squeal retry` invalidations, store key/currentness, automatic scheduler recovery, concurrent batches, or #309's timeout. No full-suite pass, real remote reproduction or causal diagnosis of the original incident is claimed.

## Commands and sources

Principal commands executed from the repository root (`~` abbreviates the home directory in the displayed launcher):

```sh
gh issue view 307 --repo hearsay-tools/squeal --json title,body,comments,url
gh issue view 309 --repo hearsay-tools/squeal --json title,body,comments,url
git rev-parse HEAD
node -p 'require("./package.json").version'
cat /proc/loadavg
nproc
~/.codex/plugins/data/squeal-hearsay/bin/squeal checks
pnpm exec tsx research/probes/issue-307/probe.ts > research/probes/issue-307/result.json
# Recorded command above used the initial probe location. Final equivalent:
pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-307/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-307/result.json
```

`squeal checks` exited **0**: default after-edit tests, **2348 files**, **2345 pass / 3 not current** at revision 1 when inspected. This is background state, not a suite pass. The explicitly requested research probe runs outside the suite; no product code or tests changed.

Sources: the two linked issues; [spec 026](../spec.md) D8/D10/D12 and its [amendment log](../status.md); [spec 021](../../021-remote-store-and-execution/spec.md) D10/D11/D13; [issue 306 findings](issue-306.md); the source paths above and [probe limitations](probes/issue-307/README.md). `origin/main` board was checked for ownership and existing holds; no issue-307 row was present before the parent's triage edit.
