# 001-407 notes: the change header sends the news

Wave 15 W4. Baseline: W2's `7574faf9`. Tests: `test/delivery/news-header.test.ts` (each dropped and each kept part), `test/delivery/slow-told.test.ts` (the told slow tier through the delivery and Stop).

## What changed

- **Two header forms.** The header rendering moved out of `format.ts` into `src/core/delivery/header.ts`. `headerLines(header, command, form = "full", slowChanged = false)`. `HeaderForm` is `"full" | "news"`.
  - The full form is the old block. Registration (`formatRegistration`), Stop (`newsText` in `src/harness/shared/stop.ts` passes `"full"`), Stop's no-delta `statusText` and `squeal status` use it.
  - Every other delivery uses the news form: PostToolBatch, the turn start (UserPromptSubmit, Pi's `startRun`), a PreToolUse deny, the idle waiter, Codex's PostToolUse. It renders as `Revision 12: 3 pending (2 tests, 1 test file loaded), 1 stale (1 test).`. With all three zero it says `Revision 12: no check pending, stale or unknown.`. `Test files without checks:` names only its classes that are not zero.
  - It drops the changed paths, the current count, the Inherited sentence and the checkpoint sentence.
  - It keeps the commit after the revision, the not-listed and runner-part sentences, liveness, and the install sentences (D6's, and the awaiting-install one). The title, edit lines and blocks are unchanged.
- **`formatDelta(delta, command, max, form = "news")`**: a fourth positional parameter, added at the end (additive).
- **Told slow tier.** `src/core/delivery/slow-told.ts` keeps a per-consumer slot in the new `meta` row `slow-tier-told:<worktree>`. The row is in `WORKTREE_META_ROWS` as `slowTierTold` (additive), so worktree removal drops it.
  - `slowTierState` is the JSON of the counts, `currentAt`, `currentUpTo`, `artifact`, `artifactUnknown` and `sourcesChangedSince`. Activity (what is running or waiting) and `stopWaitMs` are left out: a file starting to run is no result.
  - The registration records it. `deliver` sets `Delta.slowTierChanged` (new optional field, additive) when the state differs, and records it when it carried the line or when the delivery is a Stop. Unregistering (`expiry.ts`'s `forget`) clears it.
  - A slow change with no delivery stays owed until the next delivery. A consumer registered before this release has no slot, so it gets the line once.

## Quoters updated in the same commit (for 005 to check)

- `docs/specifications/005-agent-adoption/spec.md` D1: one sentence on the news form's counts.
- `docs/specifications/001-core-loop/spec.md` D6: the header paragraph and the skill-description line in D9's hooks list.
- `docs/specifications/004-slow-suites/spec.md` D8: the slow-tier line's first sentence.
- `plugins/{claude-code,codex,pi}/skills/squeal/references/reports.md`: "The header", Test files without checks, inherited, Full-suite checkpoint, Slow tier.
- `plugins/{claude-code,codex,pi}/skills/squeal/references/commands.md`: where checkpoint completion shows.
- `plugins/{claude-code,codex,pi}/skills/squeal/SKILL.md`: "Reading a header", and step 4 ("while the last one says"). The body is at 4,998 of its 5,000-character budget (`test/harness/skill.test.ts`).
- The primer (`src/harness/shared/primer.ts`, slow sentence): "unless the header's `Slow tier:` line says" became "unless the latest `Slow tier:` line states".
  - The length is identical on purpose. The fold cascade has zero margin at `test/harness/primer-listing.test.ts` (codex, node:test plus slow) and `primer-coverage.test.ts` ("Vitest and slow files", codex). With −1 the projects fold. With +1 the CLI-naming step changes. Keep any later edit there length-neutral or update those pins.
- `REVISION` ("a header names the files its revision changed") is **not** changed. It is the human's wording (005 D6), and the registration's and Stop's headers still name the files. 005 may want to weigh it.
- Eval code (006's), changed because it parses the delivered header:
  - `evals/lib/squeal-text.mjs` `countsOf` reads the news form, marked `news: true` on the step. `Test files without checks` reads either class alone.
  - `evals/lib/evidence.mjs` `replayed`: a `news` step without a `Slow tier:` line holds the slow state last seen. Only news steps do this: 0.1.127's deliveries carried no slow line, and carrying for all pushes regraded two committed a2-slow cells (`test/evals/atomic-regrade.test.ts`).
- **What proves "nothing pending" (006's gate).** In a news header, only `Revision N: no check pending, stale or unknown.` proves it, and only when no `Test files without checks:` sentence and no unlisted or runner-part sentence follows it. Each of those adds to pending in `countsOf`.
  - A news header that names counts (`1 pending (…)`, `1 stale (…)`, `1 unknown (…)`) is read as those counts.
  - A header line with neither form (`Revision 3.`, `Revision 3: nothing new.`) gives `null` counts. That is never clear, so no at-claim expectation is met.
  - The slow tier is clear only through a `Slow tier:` line: the news step's own, or the one last seen.
  - `test/evals/header-forms.test.ts` pins each of these in both harnesses. Claude's texts are hook JSON (`cell` wraps them, and one case uses an explicit `hook(...)` and a deny). It also pins a news delivery naming a failure, which misses no-overclaim. The 006-77 cases above are unchanged (no removed lines).
  - I ran no `evals/bin` tool. To find which change moved the committed regrade, I called `regradeAtomic` in memory from a scratch script. The script read `evals/results/2026-10-12-0.1.127.20261012T070705Z-6eec71.atomic.json` and wrote nothing. 006 runs the zero-change regrade itself.
- Pinning tests: `test/delivery/format.test.ts` (header-detail cases now render through `full`), `edits.test.ts`, `edits-confirmation.test.ts`, `test/harness/liveness.test.ts`, `starting-daemon.test.ts`, `codex/turns.test.ts`, `codex/command.test.ts`, `turn.test.ts`, `opencode/turn.test.ts`, `skill.test.ts`, `primer-coverage.test.ts`, `test/status/slow-tier.test.ts`, `test/evals/evidence-squeal.test.ts` (a news case per variant), `test/evals/header-forms.test.ts` (four at-claim cases), and `test/e2e/agree.ts` (reads either form; no checkpoint expected in the news form).

## Open for the coordinator / 005

- `evals/lib/rubric.mjs` still gives the judge `"Revision 6: 31 current, 0 pending, 0 stale, 0 unknown"` as its example header. Changing it changes `rubricRevision`, which means judge recalibration, so I left it. The judge reads `no check pending, stale or unknown` in plain words.
- `plugins/*/dist` is not rebuilt. The bundle-drift tests (`has the bundles exactly as npm run build:plugin produces them`) fail until the coordinator rebuilds.

## Review 001-423

### B2: a status's test files without checks read to the end of its line

`formatStatus` ends `Test files without checks: 1 pending, 0 unknown` with its line and no period. The parser required a period, so it dropped the counts and read a pass. `countsOf` (`evals/lib/squeal-text.mjs`) now reads `/Test files without checks: ([^.\n]*)/`: up to the period or the line's end, whichever comes first, never into a later line. A news header's one-class sentence (`Test files without checks: 1 pending.`) reads as before.

Tests (`3a9a23c4`):

- `test/evals/evidence-squeal.test.ts` crosses every snapshot variant with every formatter (`formatStatus`, `formatRegistration`, and `formatDelta` in the news form), each as plain text and inside a Claude Code hook's JSON. 9 variants × 3 × 2 = 54 cases.
  - Four new variants: files without checks 1 pending; 1 unknown; 1 pending and 1 unknown; the slow tier pending. The news delivery is built with `slowTierChanged: true`, so it carries the slow line as a real one does when the tier changed.
  - Each case asserts the snapshot's pending, stale and unknown counts (test files without checks added in), its verdict, and that no variant owing anything (the slow tier included) reads as pass.
  - Each also compares against main's parser before 001-407: `test/evals/fixtures/squeal-text-c6320866.mjs` is a frozen copy of c6320866's `evals/lib/squeal-text.mjs`, with a `.d.mts` for its types. A pass is allowed only where main's parser also reads a pass, and each count main reads must not be higher than the current parser's.
  - Main's parser reads no news header (its counts are `null`), so a news header is compared with main's reading of the same snapshot's full header, the registration's.
- `test/evals/header-forms.test.ts` adds, in both harnesses, each formatter's real text before a pass claim. With every count current it is met; with 1 pending or 1 unknown test file without checks it misses both `current-before-claim` and `no-overclaim`. The news case delivers `RECOVERY(3)` first, since a news header lists no known failure and the cell's ledger failure would otherwise stand. 006-77's cases are unchanged. The file is now 334 lines.
- Without the fix, the 6 status cases of the matrix and both harnesses' status misses fail; every other case passes either way.

Regrade, read-only (it exits before any write; `evals/results` unchanged):

```text
$ node evals/bin/regrade-cells.mjs --from-cells /tmp/squeal-evals-1001/cells --by 001-407 --note x --dry-run
…20261014T212723Z-dd4056.atomic.json: of 40 kept cell(s), 0 changed in a grade, 0 in evidence alone; 0 without out/
…20261015T071439Z-65314d.atomic.json: of 11 kept cell(s), 0 changed in a grade, 0 in evidence alone; 0 without out/
…20261015T104301Z-9edb7b.atomic.json: of 12 kept cell(s), 0 changed in a grade, 0 in evidence alone; 0 without out/
…20261015T110706Z-e81bea.atomic.json: of 80 kept cell(s), 0 changed in a grade, 0 in evidence alone; 0 without out/
…20261015T114356Z-99db6d.atomic.json: of 20 kept cell(s), 0 changed in a grade, 0 in evidence alone; 0 without out/
…20261015T115108Z-320f5e.atomic.json: of 20 kept cell(s), 0 changed in a grade, 0 in evidence alone; 0 without out/
…20261015T130224Z-c94221.json: of 48 kept cell(s), 0 changed in a grade, 0 in evidence alone; 0 without out/
…20261015T135404Z-21c18e.atomic.json: of 20 kept cell(s), 0 changed in a grade, 0 in evidence alone; 0 without out/
24 results file(s) with no kept cell, left as they are
```

0 grade changes in 251 kept cells.
