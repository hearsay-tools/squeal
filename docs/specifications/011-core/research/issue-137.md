# Issue 137: comment edits can delay slow results

**Recommendation:** treat the slow-tier delay as new latency evidence alongside
011-149 and issue 110; do not skip all comment or whitespace edits.

**Verdict:** the small reproduction confirms re-keying and fast-before-slow
ordering. The reported 820-file queue and hour-long delay remain unverified.
The behavior follows current 011 C2/C3/C4 and 004 D2/D5. This research proposes
no implementation and changes no approval or hold.

Examined on 2026-11-02: Squeal **0.1.393**, committed CLI and source at
`c5e60eea30291ebd1b48f287da288c178226c494`; Node **24.22.1**, Vitest **5.0.3**,
Vite **8.3.2**, esbuild **0.28.2**, Linux. Issue 137 reports **0.1.392**.
The initial load check was **9.60 on 24 CPUs** at 16:47:05Z. The retained live
run began at **3.27/24**, ended at **3.68/24**, and took about ten seconds.
The incident version was not run; its blob hasher, key index and slow-tier
source are byte-identical to these files at the examined commit.

## Questions answered

| # | Question | Answer and evidence tag |
|---|---|---|
| 1 | Do comment-only and whitespace-only TypeScript edits re-key importers? | Yes: each changed both fast importer keys and reran both tests. **verified by experiment**, Squeal 0.1.393 / Vitest 5.0.3. |
| 2 | Does this delay slow eligibility? | Yes: the slow Markdown reader stayed queued through both fast files, starting only after the last fast file ended. **verified by experiment**, 0.1.393. |
| 3 | Are there controls? | Markdown alone left fast keys unchanged and ran no fast tests. Changing the exported value from 1 to 2 re-keyed both and produced two current failures. **verified by experiment**, 0.1.393. |
| 4 | Why does it happen? | File hashes use raw bytes; reverse closures re-key their importers. Without an explicit slow request, queued or running fast work blocks slow selection. **read in source code**, 0.1.393; relevant files identical at 0.1.392. |
| 5 | Can normalization safely ignore every such edit? | No. Source reads and `toString` are prior counterexamples; directives, literals and line breaks also matter. **read in source code** for prior Vitest 5.0.3 fixtures and Vite 8.3.2; **verified by experiment** for the small esbuild 0.28.2 / Node 24.22.1 checks below. |
| 6 | Does this revise 011-149's aggregate savings? | Not determined: no store replay or large corpus was run. This adds one demonstrated latency mechanism, not a new aggregate saving estimate. **inferred**, from this 0.1.393 probe and the dated 011-149 report. |

## Reproduction and controls

A temporary Git repository holds two fast TypeScript tests importing `lib.ts`
and one slow Vitest file reading declared input `guide.md`. The slow file has
no import of `lib.ts`. `slow.trigger` is `continuous`, `quietMs` is 0, and all
widths are 1. External gates pause fast tests without editing any keyed input.
The fixture has its own store, socket and slow permits. It links only the
installed Vitest package; no install, build, browser or repository suite runs.

**verified by experiment, 0.1.393:** after the three-file baseline, each edit
below began from current results. Full keys and pending phases are retained in
[`result.jsonl`](probes/issue-137/result.jsonl).

| Revision / edit | Fast keys and execution | Slow start after edit / last fast end |
|---|---|---|
| 1: Markdown only | Both keys unchanged; no fast execution | 309 ms / not applicable |
| 2: `// original note` → `// changed note`, plus Markdown | Both keys changed; both read value 1 and passed | 1,614 ms / 220 ms |
| 3: `export const` → `export   const`, plus Markdown | Both keys changed; both read value 1 and passed | 1,609 ms / 226 ms |
| 4: exported value 1 → 2, plus Markdown | Both keys changed; both failed, each retried once | 2,042 ms / 216 ms |

For revisions 2–4, snapshots show one fast file running, the other queued, and
the slow file queued. Releasing only the first fast file starts the second;
slow still has no start event. Releasing both lets slow start. The delays
include deliberate gates and CLI observations. They prove order, not natural
throughput or an extrapolated hour of delay. The final named status exits 1
as expected: two current test failures, three current test files, zero pending
checks, and the slow test passing. The probe exits 0 and cleanup exits 0.

The first attempt stopped on a probe error: it assumed the optional slow
`activity` object existed. That snapshot had `activity: null`. The corrected
probe uses actual keys and events. The initial output is retained, not treated
as a successful run. A successful intermediate run was repeated after adding
explicit assertions for the final behavior-control failures.

## Source explanation and normalization limits

**read in source code, 0.1.393:** `blobHash` hashes `blob <length>\0` followed
by every byte. `KeyIndex.rekey` refreshes changed paths and recomputes reverse
references. `SlowTier.#fastFirst` returns
`editPending() || (!requested && !fastIdle())`. Thus slow priority is separate
from why the fast key changed. A normal named slow status wait is not an
explicit `run --slow` request. Prior issue-110 research already tested named
slow waits behind later fast backlog tiers; it is not repeated here.
Spec 004 D5 keys declared Markdown inputs as any other input. These rules
explain both the importer reruns and the independently affected slow file.

**read in source code, prior Vitest 5.0.3 evidence:** 011-149's preserved
`tostring-comment` fixture changes an internal comment and records PASS → FAIL;
removing comments from emitted code would miss it. `reads-source` and
`raw-import` record PASS → FAIL despite equal emitted code. Its source-map,
`tsc` and transform-option cases impose further limits. These are prior results
read for this report, not new runs.

**verified by experiment, esbuild 0.28.2 / Node 24.22.1:** changing the comment
`/* @__PURE__ */` to `/* ordinary */` retains an otherwise removed `effect()`
call under tree shaking. A space inside `"a b"` changes its value; comment-like
text inside a string is data. Inserting a newline after `return` changes 1 to
`undefined`. These show why byte or token stripping needs semantic care; they
do not claim this fixture's Vitest pipeline tree-shakes that call.
**read in source code, Vite 8.3.2:** its asset URL transform checks
`hasViteIgnoreRE` and skips the transformation for `/* @vite-ignore */`.
Comments can be tool directives even when the JavaScript runtime ignores them.

## Prior evidence, tradeoff and open questions

**inferred from the cited evidence:** slow-result latency deserves separate
weight from total CPU savings. 011-149 measured K2 (equal emitted code) saving
about 1.0% of Squeal's and 0.5% of Cezar's stored work in its 72-hour window;
K3 (also strip comments) saved 2.4% and 0.7% but missed the `toString` fixture.
Those aggregate results do not bound the delay of one useful slow test behind
one large edit. The deciding tradeoff remains earlier useful feedback versus
incorrectly retaining a current result. This probe supports investigating that
latency without accepting unconditional comment normalization.

Not determined: whether all seven incident edits were semantically harmless;
which closures and declarations caused its 820 files to re-key; the contribution
of host load, browser setup, later revisions and fast-tier duration to its hour;
or whether a named-wait or explicit-slow policy would have exposed its actual
browser failure before push. The fixture has no browser, competing daemon,
monorepo or incident checkout. Runtime-source-read hazards are reused from prior
evidence; they were not rerun in this fixture.

## Verification

Both probe commands and `node --check` for both scripts exited 0. The fixture's
final status exited 1 for its two deliberate failures. `git diff --check` passed.
The session launcher (pinned to 0.1.390, separate from the examined 0.1.393 CLI)
ran `squeal status --wait 60000` with this report and both script paths: exit 3,
no repository test closure holds them; worktree known failures 0, all 1,385
files current. Those existing results are not a newly run suite. Squeal also
labels probe functions untested, as expected for these standalone scripts.
No build, lint, typecheck or repository suite was run for this research-only
change. Markdown link targets were checked locally.

## Commands and sources

The worker ran the scripts at `research/probes/issue-137/` from the checkout
root. Integration moved them under this spec as required by the triage scope.
The repeat commands below use the new paths; retained output is unchanged.

- `gh issue view 137 --repo hearsay-tools/squeal --json title,body,url,comments`:
  [issue 137](https://github.com/hearsay-tools/squeal/issues/137), fetched body in
  [`issue.json`](probes/issue-137/issue.json).
- `node -e 'console.log(JSON.stringify({time:new Date().toISOString(),load:require("os").loadavg(),cpus:require("os").cpus().length,available:require("os").availableParallelism()}))'`:
  initial 9.60/24 check; the live script repeats it before daemon startup.
- `node docs/specifications/011-core/research/probes/issue-137/probe.mjs > docs/specifications/011-core/research/probes/issue-137/result.jsonl 2>&1`
  and `node docs/specifications/011-core/research/probes/issue-137/normalization.mjs > docs/specifications/011-core/research/probes/issue-137/normalization.jsonl`:
  both exit 0. [Probe README](probes/issue-137/README.md)
  describes isolation, repeat commands and the expected failing control.
- [011-149 findings](type-only-edits.md), [probes and prior versions](probes/type-only-edits/README.md),
  [prior raw output](probes/type-only-edits/out/q2.out); board row 011-149.
- [Issue-110 probe](../../004-slow-suites/research/probes/issue-110/README.md),
  [issue 110](https://github.com/hearsay-tools/squeal/issues/110).
- Specs [011 C2/C3/C4](../spec.md), [011 status](../status.md),
  [004 D2/D5](../../004-slow-suites/spec.md), [004 status](../../004-slow-suites/status.md).
- [Source excerpts and incident-tag comparison](probes/issue-137/source-evidence.txt):
  `src/core/hash/blob.ts:15`, `src/core/keys/key-index.ts:204`,
  `src/core/scheduler/slow-tier.ts:280`, all at
  [examined commit](https://github.com/hearsay-tools/squeal/tree/c5e60eea30291ebd1b48f287da288c178226c494).
  Installed Vite 8.3.2 `dist/node/chunks/node.js:26271,27111` supplies the directive check.
