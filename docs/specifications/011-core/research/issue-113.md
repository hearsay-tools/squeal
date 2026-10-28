# Issue 113: passing slow runs under runtimeFiles store nothing

Treat issue 113 as a reproduced slow-tier recording defect; retain the existing holds until a separately approved fix is reviewed.

Examined Squeal **0.1.369**, checkout `cbdfa22c5ef59a414a7217eb0202de738af0f13b`, on Linux with Node **v24.22.1**, 2026-10-28. The bounded synthetic probe uses real scheduler, keying, state sink and SQLite code with a fake passing runner. It changes no product code and starts no daemon or browser. The original Cezarion worktree and its stopped daemon were not touched.

## Questions and verdicts

| Question from the brief | Answer and evidence tag, version |
| --- | --- |
| Q1. Does an excluded runtime file rewritten during a passing run leave slow work queued without results at its effective key? | Yes. Six completed passing runs, zero stored results for both current keys, both files queued. **verified by experiment**, 0.1.369. |
| Q2. Must the file change during the run? | No. Stable bytes produce the same six-run loop. The fast control stores both files despite rewriting the descriptor. **verified by experiment**, 0.1.369. |
| Q3. Which source path explains the result? | Slow selection omits `runtimePolicy`; completion compares that missing value with the nonempty applied identity and returns `environment`. This precedes the byte-stability check. **read in source code**, 0.1.369 at the SHA above. |
| Q4. Does the probe reproduce all 326 browser runs and starvation of the second file? | Not determined, because this bounded fake-runner fixture has no browser, global setup, daemon watcher or original store. Both synthetic readers ran three times. The loop is reproduced; exact original ordering and duration are not. **inferred** limit, 0.1.369. |

## Experimental evidence

Command: `pnpm exec tsx docs/specifications/011-core/research/probes/issue-113/probe.ts > docs/specifications/011-core/research/probes/issue-113/output.jsonl 2>&1` (exit **0**). The probe checks host load immediately before each case. All were below **24 CPUs**. It observes each case for up to 2.5 seconds or six run starts, then closes and removes its private fixture.

| Case | UTC start | One-minute load | Runs completed | Results at current keys | Final pending |
| --- | --- | ---: | ---: | --- | --- |
| Slow, scoped, stable descriptor | 00:04:45.595 | 1.27 | 6 | 0 for A, 0 for B | Both queued |
| Slow, scoped, descriptor rewritten each run | 00:04:45.946 | 1.27 | 6 | 0 for A, 0 for B | Both queued |
| Fast, scoped, descriptor rewritten | 00:04:46.259 | 1.73 | 1, holding both files | 2 pass rows per file | Neither pending |
| Slow, no runtime rule, stable descriptor | 00:04:48.842 | 1.73 | 3 | 2 pass rows per file | Neither pending |

**verified by experiment, 0.1.369.** Each stored pair is the test pass and file-level pass. All recorded run end states are `completed`. Scoped cases have the same effective keys across stable, rewritten and fast variants: A `11d6a878…`, B `6c9f3be1…`. The applied-policy record marks `.runtime/descriptor.json` excluded for both readers, with `verified: true` and no conflicts. Raw observed sets retain the descriptor. The slow rewrite case reads bytes `0` through `5` across its six runs. Both scoped slow cases remain at revision 0. No watcher is present, so this last observation does not independently verify daemon revision suppression.

An initial two-case exploration also reproduced six completed runs without stored results at loads 1.70 and 1.80 on 24 CPUs. Its output was replaced by the final four-case evidence above. That first draft used the wrong baseline enum spelling (`run-missing`); the final probe uses the supported `lookup-then-run-missing`. Only the final run supports the verdict table.

## Source evidence and relation to C2/C3/C4/C5

**read in source code, 0.1.369 at the examined SHA.** The source gives this chain:

1. `src/core/scheduler/tiers.ts:306` captures `runtimePolicy: keys.runtimeIdentity(ref)` for fast selection. `src/core/scheduler/slow-tier.ts:550` gets stability paths but returns `{ file, key, inputs, checkpointId, forced, waits }`, with no runtime identity.
2. `src/core/scheduler/tiers.ts:671` passes the current identity into `tierEnd`. `src/core/scheduler/store-decision.ts:167` compares it with `(entry.runtimePolicy ?? "")`. A selected rule gives a nonempty identity (`src/core/keys/runtime-files.ts:102`). The mismatch returns `kind: "environment"` before checking unstable paths.
3. `src/core/scheduler/record-tier.ts:150` adds raw observations and records the file as grown. Its `environment` branch stores no result. `endRecord` settles grown files at line 224; the missing result remains work to do. `observedGrowth` at `src/core/scheduler/observed.ts:71` sees the excluded path outside the effective closure on every report. Lines 98–100 filter effective growth to empty but keep the raw `add`, so the grown entry persists.
4. The usual environment rerun bound is applied only when environment observations produced an `EnvironmentGrowth` object (`record-tier.ts:222`, `environment-growth.ts:78`). This probe reports file observations only. It does not enter that bounded environment rerun path.

**inferred, 0.1.369.** This explains repeated discarded passing runs without needing a byte mismatch or a newly computed raw key. The stable-byte case and successful fast rewrite control reject the claim that a runtime rewrite is necessary for this loop. The source diagnosis has not been tested by changing the implementation, since a fix is outside this task.

**read in source code, documentation at the examined SHA.** C2 requires the completion barrier to cover inputs the keys name. C3 defines effective input identity and monotonic observed sets. C4 requires matching-key results to become current; C5 stores the latest result per check and key. The shipped `Policy.runtimeFiles` contract in `src/core/types/policy.ts:56` says: “Exact data files whose observed bytes do not affect selected test readers.” `RuntimeFiles.effective` filters only applied paths and preserves protected inputs. The current spec and status log contain no literal `runtimeFiles` entry; the runtime-specific contract was read from shipped types and source. No spec amendment is proposed here.

## Recommendation, tradeoff and limits

**inferred, 0.1.369.** Route this as a slow-tier runtime-policy identity defect. A future regression should exercise the real slow selection and storage path with both stable and rewritten excluded bytes, plus the fast control. Preserve the policy-change-during-run guard: trustworthy results require the identity at selection to match at recording. Removing the guard would trade the loop for accepting results across a real policy change. This research does not authorize or implement a fix.

Not determined: the original browser/globalSetup observation shape, whether its second file is starved by duration ranking, whether a restart changes the original state, and behavior of other runners. No full suite, browser suite, lint of product code, typecheck or build was run. These are research-only files. Squeal reports the standalone probe as untested and over its CRAP threshold; the direct experiment above is its execution evidence, not a repository coverage claim.

Verification commands: `pnpm exec biome check docs/specifications/011-core/research/probes/issue-113/probe.ts` passed after formatting; a Python check of all four JSON outcome matrices passed. `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/probes/issue-113/probe.ts` exited **3** at worktree revision 13: “No verdict: no test file's closure holds” the probe; known failures 0, 1 test file queued (9 tests), 5 test files unknown. These unrelated affected checks are not claimed as passed. That status CLI is this session's **0.1.368**; the synthetic experiment imports checkout **0.1.369** directly.

## Sources and artifacts

- Issue fetched with `gh issue view 113 --repo hearsay-tools/squeal --json title,body,comments,url`: https://github.com/hearsay-tools/squeal/issues/113 (no comments at read). The 326 runs and browser starvation are reporter evidence, not measurements by this probe.
- Source revision: https://github.com/hearsay-tools/squeal/tree/cbdfa22c5ef59a414a7217eb0202de738af0f13b ; paths and lines above.
- Local policy/validity sources: `docs/specifications/011-core/spec.md` C2/C3/C4/C5; `docs/specifications/011-core/status.md`; `src/core/keys/runtime-files.ts`; `src/core/types/policy.ts`.
- Fixture and exact output: `docs/specifications/011-core/research/probes/issue-113/probe.ts`, `README.md`, `output.jsonl`. Only repository sources named by the task and issue were consulted; no open-web search.

Coordinator artifact correction: the worker initially committed probes at repository-root `research/probes/issue-113/`. Integration moved them into this spec’s required probe directory and adjusted relative imports. Commands above use the corrected location; the original execution used the root location. Recorded output is unchanged.
