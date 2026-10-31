# Wave 24 W1: rows 015-99, 015-100, 015-101 (worker 5410e36c)

Brief: `tasks/wave-24.md` W1. Shape: slice, one commit per row.

## Commits

- `b4e64ac49` feat(015-99): name `complexity.maxFileBytes` where a file over the size limit is reported (gh-115).
- `1a0e4642f` docs(015-100): guidance for packaged test helpers outside coverage (gh-122).
- `9f8f1260b` feat(015-101): give an unknown CRAP one short reason in `squeal code` (gh-129).

## 015-99: the key in every too-big line

Three places print the size limit. Each one now names the key:

| Where | Function | Text |
|---|---|---|
| `squeal code`, `Not judged:` | `src/cli/code.ts` `fileLine`, `too-big` | `src/big.ts: 600 KiB, over the 512 KiB limit (complexity.maxFileBytes); its functions are not counted` |
| Session line at the first edit (D6, A file too big to count) | `src/core/delivery/code-format.ts` `tooBigLine` | `src/big.ts is 600 KiB, over the 512 KiB limit (complexity.maxFileBytes); its functions are not counted.` |
| Test news's `Code:` line, a changed file not judged (015-49) | `code-format.ts` `notJudgedFile` | `a.ts (600 KiB, over the 512 KiB limit of complexity.maxFileBytes)` |

Decision: inside the `Code:` line's parentheses, the key reads `limit of complexity.maxFileBytes`, so no parentheses nest. The other two lines use the brief's lead text. The 015-84 summary signature compares reasons, not words, so this text change sends no new `Code:` line.

The default stays 524288. Tests in `test/code/delivery/` (`delivery`, `too-big`, `not-judged`, `told-once`) pin each line. The skill's `policy.md` row names the key and says to set a larger value to count larger files. The `squeal code` example in `commands.md` shows the new line. That file is not in the brief's ownership list; I changed it because its example shows this line.

## 015-100: guidance only

The `coverage.exclude` row in `policy.md` now says: test helpers shipped in a package, which only a manual or built-output run uses, are measured as product code, because no runner here lists them as tests and Squeal measures only its own runs. Exclude them explicitly with globs that leave product helpers checked. No code, default or scope rule changed (`research/issue-122.md`; the human's 015-82 decision stands).

## 015-101: the reason for an unknown CRAP

`src/cli/code-crap-reason.ts` (new) holds the words and `crapOf`. `coverageByFunction` uses it for each function's `crap`. `coverageWords` prints `; CRAP unknown: <reason>`. The JSON adds `crap.reason`, and only an unknown CRAP has it.

The cause comes from `FileSummary` for the function's path (summary key `coverage:<worktreeId>`):

| File condition | Reason |
|---|---|
| pending `imports` | waits for a test file's imports |
| pending `run` | waits for a test file to run |
| pending `record` | waits for a coverage record |
| unknown `no-record` | a test file that loads this file has no coverage record |
| unknown `skipped` | a test file that loads this file skipped a test |
| unknown `unkeyed` | Squeal cannot key a test file that loads this file |
| unknown `unread` | a coverage record cannot confirm this file's bytes |
| judged, at the state's blob | the coverage records cannot tell whether it ran |
| no entry, or judged at another blob | cause unknown |

Why a judged file means the join: a full judgement makes CRAP unknown only from `measuresOf` with `FunctionCoverage.unresolved` (`judge.ts`; review 0.1.297 B4). The blob check keeps a state from an older judgement from being blamed on the join.

Limits, to check in review:

- A pending or unknown file names its own condition, even when an older judgement's join made the state unknown and the file keeps that state. The condition stated is still true, and it still blocks a numeric score until the file is judged. The store does not keep the join cause apart from a dropped state (both have `threshold: null`, and both have evidence).
- When only runners without records leave a file unknown and nothing is proven, the line stays `not measured: ...` (015-75) and has no CRAP part. When a pass was proven beside such a runner, an unknown CRAP reads the `no-record` cause. The runner's name is not added.
- Only CRAP gets the reason. `untested unknown` (the line when CRAP is off) and `CRAP pending` have none. The brief asked for unknown CRAP only.
- Without paths, `squeal code` and its coverage head are unchanged.

Tests: `test/code/crap/unknown-reason.test.ts`. The first test uses the skipped-loader scenario from `skipped-pass.test.ts`: `big` keeps 1/1 lines and `uncovered: pass` beside an unknown CRAP with its reason in text and JSON. After a full record, CRAP is 35 and the reason is gone. The other tests cover a pending file that keeps an unknown CRAP, a judged file whose join gives two V8 functions at one span, and a unit table of every cause plus `cause unknown`. Before the wiring, the three rig tests failed only on the missing `reason`; the states were the same.

Type change (additive): `CodeReportCoverageOf.crap.reason?: string` in `src/cli/code-coverage.ts`.

`src/cli/code-coverage.ts` is 313 lines. It was 305 before this row. A later split could move `coverageReport` out.

## Copies of the skill references (parent's decision, option a)

Only `plugins/claude-code` (the source) and `plugins/pi` are edited. `plugins/codex-runtime` comes from `build:plugin` at integration, and its `runtime.json` has a sha256 for each file. `plugins/codex/seed` is the fixed adapter seed, frozen at 0.1.368, written only by `build:codex-adapter`; it is unchanged. A hand edit there breaks its manifest (`adapter/manifest.ts` checks each file's sha256). The seed copy already differed from the others before this wave (the coverage default).

Until the integration build, these fail as expected drift:

- `test/harness/skill.test.ts` > "says the same step 4, `commands.md` and `policy.md` in the Codex and Pi copies" (codex-runtime copy).
- `test/harness/codex/packaging/runtime.test.ts` > "carries the skill exactly as its source in the Claude Code plugin, with the Codex note" (queued at the last check).
- `test/harness/pi/package.test.ts` > "has the bundles exactly as `npm run build:plugin` produces them" (src changed, bundles not built), and the same bundle checks of the Claude Code and Codex runtime packages.

Brief path defect: `test/delivery/` does not exist; the delivery tests are in `test/code/delivery/` (parent confirmed).

Not in scope, seen in passing: the policy reference says "Coverage is on by default". That matches `DEFAULT_POLICY` since `a6741966c` (2026-10-28), but spec D1 and the brief still say coverage is opt-in.
