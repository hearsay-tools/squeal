# 017-22: a line number inside a message

Worker 86fdec14, 2026-11-01. Wave 4, section W2. Outcome: a pure code move gives no lint transition when a rule's message names a line (`../../lessons.md` L5).

## What changed

- `src/core/lint/fingerprint.ts`: `findingMessage(message)` replaces the number of each `line N` with `N` (regex `/\b(line\s+)\d+\b/gi`, so `(at line 136)`, `on line 12` and `Line 5 exceeds` are all covered). `lintFingerprint` hashes `[rule, findingMessage(message)]`.
- `src/core/lint/transition.ts`: both stages of `matchFindings` (rule, message, line hash; then rule, message) compare `findingMessage(message)`. A moved finding that names a line is no longer named as added and removed when another finding in the file changed the fingerprint.
- The stored and shown finding keeps its real message. Only comparisons use the normalized one.
- Tests: `test/lint/fingerprint.test.ts` is new. It holds the three D2 fingerprint tests moved from `test/lint/transition.test.ts`, the L5 cases, the numbers that must stay (a count of lines, a line length, `inline 5`), a golden hash from before this row, and two upgrade cases through `judgeResult`. `test/lint/transition.test.ts` adds s3's move (no transition) and the match case.

## Decisions the spec did not settle

1. **No version moves.** The lesson said `PROVIDER_VERSION` or a fingerprint version moves. Neither does in this row. The key's meaning does not change: the stored findings are the same; only how two finding sets compare changes. A key move would re-lint every file after the upgrade for nothing (memory: results survive releases). W1 raises `PROVIDER_VERSION` for its own reasons in the same wave; that is independent.
2. **Old hashes kept where they can be.** A set whose messages name no line hashes exactly as before (golden test `df70b396f31887cf`). So an upgrade moves no fingerprint but those of files whose messages name a line.
3. **Placeholder `N`, word kept.** `line 136` reads `line N`; `Line 5` reads `Line N`. A message that already says `line N` literally compares equal to one with a number; that is harmless.
4. **Only `line N`.** Not columns, not `lines 5-7`, not `(5:3)`. No such message was seen in 017-13. `lines (51)` (a count) and `a length of 120` stay, since a move does not change them.
5. **Not `messageId` with data.** The lesson's second option needs a new `LintFinding` field and provider changes (W1's files). Normalizing the text covers the seen case with no type change.
6. **A known gap, as `diagnostic-identity.md` Q3.** Two findings alike but for the line they name now compare as equal messages. A fix of one and a new one naming another line, in the same edit, reads as no change. The line-hash stage still names the right one when both stay.

## Upgrade: where a stored fingerprint meets a new one

Seam map, so the next worker does not read it all again:

| Place | Compares | After this row |
| --- | --- | --- |
| `transition.ts` `lintTransition` | fingerprints computed now from both finding sets | safe: both sides are new |
| `pass/judge.ts` `changeOf`, stored result found at the judged key | calls `lintTransition(stored.findings, after)` | safe: recomputed from findings |
| `pass/judge.ts` `changeOf`, stored result gone | `lintFingerprint(after) === judged.fingerprint` (the stored hash) | safe for sets with no line in a message (same hash). A set with a line in a message would give one false `fail-changed` with no finding named. **Unreachable today**: no code deletes from `results` (searched `src/core/lint`) and the store has one schema version. |
| `surface/news.ts` `toldAlike` | the view's told fingerprint with the state's judged one | safe: a difference only makes it read the transitions; with none, the view is rewritten by count and nothing is told |
| `store/results.ts` | stores `fingerprint` | an old row keeps its old hash until a lint at that key writes it again; every reader above copes |

If a later row adds eviction of lint results, `changeOf`'s fallback should compare with a recomputed fingerprint or treat a stored hash from before 017-22 as unknown. The simplest: store a version beside the judged fingerprint, or skip the fallback's `fail-changed` when the judged result's findings are not readable. That is `judge.ts`, outside this row.

## For the next worker

- `src/core/types/lint.ts` describes `LintFingerprint` as the hash of `rule|message`. It is now the normalized message. The type file was outside this row; a later edit there can say "the message as `findingMessage` reads it".
- `test/lint/replay.test.ts` (016-33's seven edits) still gives the a-set column: none of its messages names a line.
- The golden hashes in `fingerprint.test.ts` came from running the old `lintFingerprint` with Node's type stripping before the edit. If D2's pair form ever changes on purpose, recompute them and say so in that commit.
