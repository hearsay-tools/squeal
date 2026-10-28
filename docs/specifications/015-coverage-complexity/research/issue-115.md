# Issue 115: complexity skips a 597 KiB source

Recommend the existing project size override as the immediate option; require a human decision before changing the default or adding a bounded counting path.

## Verdict and scope

**Verified by experiment, Squeal source 0.1.369:** the default 524,288-byte limit skips both synthetic 611,328-byte TypeScript files before calling the counter. Raising only `complexity.maxFileBytes` to 1,048,576 through the real policy loader counts both files. Each has a function at CC 23, stored as `fail` against threshold 20. This reproduces the size-policy mechanism in [issue #115](https://github.com/hearsay-tools/squeal/issues/115), not the original cezarion session.

Examined on 2026-10-28 at checkout `d7061f459277bd6a262e17097b22978728612cb6`, package 0.1.369, Node v24.22.1. The issue and session CLI use 0.1.368. The relevant counter, pass and policy-validation files have no diff from `squeal--v0.1.368`; the policy type/default file differs only for the unrelated `runtimeFiles` setting. No product code, defaults, spec, status or board changed.

| Question | Answer and evidence tag |
|---|---|
| Does a roughly 597 KiB source with an over-20 function get skipped? | **Verified by experiment, 0.1.369:** both fixtures have `tooBig: true`, zero counter calls, zero stored function states at the default limit. |
| Does the existing setting permit counting? | **Verified by experiment, 0.1.369:** `readPolicy` accepts 1,048,576 bytes; the next pass is `mode: "include"`, counts one blob, clears `tooBig`, and stores target CC 23 as `fail`. No function transitions are emitted for this policy recount. |
| What does counting cost? | **Verified by experiment, 0.1.369:** 45–74 ms wall for the comment-padded source; 402–458 ms for the dense source. See measurements below. |
| Is this a regression or missing notification? | **Read in source code, 0.1.369, and spec D1/D6:** skipping above the configured limit is explicit policy. D6 already requires the omission notice. **Inferred:** the request changes the counting policy or execution path, rather than repairing the notice added for #96. |
| Was the original incident replayed? | **Not determined by experiment:** no original cezarion source, exact incident commit, live daemon or hook session was replayed. Its reported CC and timing remain reporter evidence. |

## Experiment and cost

The probe uses the real `readPolicy`, `runPass`, SQLite code store and `countFile`. It supplies a synthetic source listing at revision 1. Every temporary source and store lives under the probe directory and is removed. No test runner or build is invoked. The shell limits the complete probe to 45 s, then allows 5 s before forced termination. This is an external research bound, not a bound in the product counter.

Each fixture is exactly 597 KiB (85 KiB, or 16.6%, above the default). `overTwenty` has 22 independent `if` statements and CC 23. The padded fixture has one function plus a comment. The dense fixture has 9,148 functions in total. Both parse with zero error ranges.

The initial load check was 18.77 / 18.13 / 16.83 on 24 logical CPUs. The successful probe checked load before each fixture and warm count: 19.72 / 19.21 / 17.46 throughout, below 24. Times below come from that run, which started at 08:26:52 UTC and exited 0 in about five seconds.

| Measurement | Comment-padded: wall / CPU ms | Dense: wall / CPU ms |
|---|---:|---:|
| Default pass, no counter call | 10.46 / 10.86 | 1.98 / 1.92 |
| First count of fixture | 73.51 / 163.12 | 401.95 / 468.56 |
| Complete raised-limit pass | 78.82 / 168.54 | 626.68 / 673.98 |
| Second worktree ID, cached blob | 0.81 / 0.74 | 177.42 / 150.77 |
| Warm direct count, bypassing cache | 45.28 / 55.19 | 458.07 / 495.23 |

**Verified by experiment, 0.1.369:** the second worktree ID adds no parser call and inherits the same failing target state. Cache reuse avoids parsing but still incurs per-worktree state work. The first padded count includes grammar startup; the dense count reuses that parser. CPU covers all process threads. Pass wall time includes reading rows for output; pass CPU is sampled just after the pass. These are individual observations, not medians or p95 estimates.

**Read in source code, 0.1.369:** `pass/plan.ts:106` selects `big` when `file.size > complexity.maxFileBytes`; `pass/cursor.ts` treats a limit change as a recount. `count/parser.ts` parses the whole text and `count/index.ts` walks it. D4 runs this in the daemon process. **Inferred:** reporting only changed functions would not, by itself, remove full-file parsing cost. Subsecond completion alone does not prove acceptable daemon responsiveness. These large fixtures exceed goal 8's ordinary per-file latency targets; they do not measure the original repository corpus or prove that goal failed there.

## Commands and retained outputs

Run from the checkout root:

```sh
gh issue view 115 --repo hearsay-tools/squeal --json number,title,body,url,comments
git rev-parse HEAD
node -p 'JSON.stringify({version:require("./package.json").version,node:process.version,load:require("node:os").loadavg(),cpus:require("node:os").cpus().length})'
git diff squeal--v0.1.368 HEAD -- src/core/code/count src/core/code/pass src/core/types/policy.ts src/core/daemon/policy-code.ts
timeout --signal=TERM --kill-after=5s 45s pnpm exec tsx research/probes/issue-115/probe.mjs > research/probes/issue-115/output.jsonl 2> research/probes/issue-115/stderr.txt
```

The issue command returned the original report and two later 595 KiB occurrences from cezarion #2017 and #2024. The original report says `completionGate` had CC 23, a separate Babel-based check took under one second, and manual checking cost about five minutes. Later reports name CC 7 and CC 8 functions. These are reports, not independent measurements here. No original status/why JSON was supplied.

The complete successful probe output is [output.jsonl](../../../../research/probes/issue-115/output.jsonl); [probe source and instructions](../../../../research/probes/issue-115/README.md) reproduce it. The first run stopped at a probe assertion that read `state` instead of `outcome`; [attempt-1.jsonl](../../../../research/probes/issue-115/attempt-1.jsonl) and its stderr preserve that limit. Correcting this assertion yielded the successful run. No product fix was needed.

Affected-check read: `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-115/probe.mjs` exited 3: `Revision: 10`; `No verdict: no test file's closure holds research/probes/issue-115/probe.mjs. Worktree: known failures 0; not current: 6 of 1313 test files (6 unknown)`. The CLI identified itself as 0.1.368, with Claude Code 0.1.369 and Codex 0.1.368. The six unknown files were present at the session baseline. The standalone probe's assertions provide its verification; no suite or build was run, as assigned. `git diff --check` passed.

## Spec impact and human decision

**Read in spec at the examined commit:** D1 owns the configurable limit and excluded set. D3 owns whole-file counting and parser correctness. D4 owns daemon execution, per-blob reuse and recounts. D6 owns skipped-file notices and the policy-change summary. D10 and goal 8 own CPU and latency cost. Status records the human's 2026-10-23 decision that the size limit is configurable; the 2026-10-25 #96 decision explicitly left counting above the limit unchanged.

**Inferred recommendation:** use `{"complexity":{"maxFileBytes":1048576}}` as a project option when its owner accepts the cost. This is a global limit for that project's supported files, not a per-file or TypeScript-only exception. It is already supported and was tested in the probe only. This research does not apply it to cezarion.

The human must choose whether to retain the default and use project policy, approve a higher default after representative cost measurements, or authorize research/design for a bounded large-file path. A new path would need an explicit timeout/resource policy and retained omission evidence when it cannot finish. The two synthetic files justify none of those default changes alone.

Open evidence: original cezarion source at the incident commit; its actual tree-sitter CPU, memory and event-loop delay; repeated edits under shared-host load; a broader large-source corpus. No hook delivery, daemon restart, process isolation, adversarial parse bound, coverage result or full suite was tested. No incorrect pass was observed: skipped files have no function verdict.
