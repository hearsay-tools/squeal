# 017-22: a line number inside a message

Worker 86fdec14, 2026-11-01; repaired 2026-11-02 for review `0.1.391.md` B1 (wave 4.5). Wave 4, section W2. Outcome: a pure code move gives no lint transition when a rule's message names a line (`../../lessons.md` L5).

## What changed

- `src/core/lint/fingerprint.ts`: `LINE_TEMPLATES` maps a rule id to the part of its message template that names a line of the file. It holds one rule: `react-hooks/exhaustive-deps`, part `/( Hook \(at line )\d+(\) change on every render)/`. `findingMessage(finding)` replaces that number with `N` for a listed rule and returns every other message as it is. `lintFingerprint` hashes `[rule, findingMessage(finding)]`.
- `src/core/lint/transition.ts`: both stages of `matchFindings` (rule, message, line hash; then rule, message) compare `findingMessage(finding)`. A moved finding that names a line is no longer named as added and removed when another finding in the file changed the fingerprint.
- The stored and shown finding keeps its real message. Only comparisons use the normalized one.
- Tests: `test/lint/fingerprint.test.ts` is new. It holds the three D2 fingerprint tests moved from `test/lint/transition.test.ts`, s3's move, the messages that must stay as they are (B1's restricted import, a `sonarjs` message under its own rule, the template under another rule's name, another name in the listed rule), a golden hash from before this row, and two upgrade cases through `judgeResult`. `test/lint/transition.test.ts` adds s3's move (no transition), the match case, and B1's regression: ESLint 10.13.0's `Linter` runs the built-in `no-restricted-imports` with paths `line 1` and `line 2` in process, and the edit records `fail-changed` with one added and one removed finding.

## Review 0.1.391 B1 and its repair

The first version rewrote every `line N` in every message (regex `/\b(line\s+)\d+\b/gi`). A message also holds the project's own text: `no-restricted-imports` with paths `line 1` and `line 2` gave one fingerprint (`91bf29abc4946045`) and no transition, so a different finding was hidden. The repair reads a line only inside a listed rule's own template words. Rule ids, identifiers and the template's fixed words cannot come from the project's text, so a listed template cannot merge two different findings unless a project names a rule `react-hooks/exhaustive-deps` that is not the plugin's.

## Decisions the spec did not settle

1. **No version moves.** The lesson said `PROVIDER_VERSION` or a fingerprint version moves. Neither does in this row. The key's meaning does not change: the stored findings are the same; only how two finding sets compare changes. A key move would re-lint every file after the upgrade for nothing (memory: results survive releases). W1 raises `PROVIDER_VERSION` for its own reasons in the same wave; that is independent.
2. **Old hashes kept where they can be.** A set with no `react-hooks/exhaustive-deps` finding hashes exactly as before (golden test `df70b396f31887cf`). So an upgrade moves no fingerprint but those of files with that rule's findings.
3. **A list of rule templates, one rule now (the parent's instruction for B1).** Matched by exact rule id. A rule whose message names a line of the file and is not listed, such as `sonarjs/no-identical-functions` ("… identical to the one on line 12."), still gives a transition after a pure move. Add a rule to `LINE_TEMPLATES` with its template's fixed words around the number, and a test, when a dogfood round sees one. A plugin loaded under another prefix (a renamed `react-hooks`) is not matched.
4. **Placeholder `N`.** `(at line 136)` reads `(at line N)`.
5. **Not `messageId` with data.** The lesson's second option needs a new `LintFinding` field and provider changes (W1's files). Normalizing the text covers the seen case with no type change.
6. **A known gap, as `diagnostic-identity.md` Q3.** Two `exhaustive-deps` findings alike but for the line they name compare as equal messages. A fix of one and a new one naming another line, in the same edit, reads as no change. The line-hash stage still names the right one when both stay.

## Upgrade: where a stored fingerprint meets a new one

Seam map, so the next worker does not read it all again:

| Place | Compares | After this row |
| --- | --- | --- |
| `transition.ts` `lintTransition` | fingerprints computed now from both finding sets | safe: both sides are new |
| `pass/judge.ts` `changeOf`, stored result found at the judged key | calls `lintTransition(stored.findings, after)` | safe: recomputed from findings |
| `pass/judge.ts` `changeOf`, stored result gone | `lintFingerprint(after) === judged.fingerprint` (the stored hash) | safe for sets with no `exhaustive-deps` finding (same hash). A set with one would give one false `fail-changed` with no finding named. **Unreachable today**: no code deletes from `results` (searched `src/core/lint`) and the store has one schema version. |
| `surface/news.ts` `toldAlike` | the view's told fingerprint with the state's judged one | safe: a difference only makes it read the transitions; with none, the view is rewritten by count and nothing is told |
| `store/results.ts` | stores `fingerprint` | an old row keeps its old hash until a lint at that key writes it again; every reader above copes |

If a later row adds eviction of lint results, `changeOf`'s fallback should compare with a recomputed fingerprint or treat a stored hash from before 017-22 as unknown. The simplest: store a version beside the judged fingerprint, or skip the fallback's `fail-changed` when the judged result's findings are not readable. That is `judge.ts`, outside this row.

## For the next worker

- `src/core/types/lint.ts` describes `LintFingerprint` as the hash of `rule|message`. It is now the normalized message. The type file was outside this row; a later edit there can say "the message as `findingMessage` reads it".
- `test/lint/replay.test.ts` (016-33's seven edits) still gives the a-set column: none of its rules is listed.
- The golden hashes in `fingerprint.test.ts` came from running the old `lintFingerprint` with Node's type stripping before the edit. If D2's pair form ever changes on purpose, recompute them and say so in that commit.
