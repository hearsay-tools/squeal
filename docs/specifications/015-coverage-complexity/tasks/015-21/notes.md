# 015-21 notes: a failed fix attempt hears once more

Worker 8dd24d16, 2026-10-24. Brief: `tasks/wave-1b.md` W5, on `int/015b`. What the review and the next row read first.

## Seam map

| What | Where |
|---|---|
| The rule: an edit that leaves a failing function over is told when the view holds it `count` or `full`, never `still` | `editToTell` (was `standingEdit`) in `src/core/delivery/code-delta.ts` |
| Which line: `edited` when the view held it by count (015-08), `edited-after-fail` when it held the FAIL in full | `stateStep`, same file |
| The view entry after either line: `still`, so later edits are quiet until the state changes | `stateStep`; `TOLD` in `src/core/code/store/views.ts` |
| A STILL FAIL is no change in titles and in `and N more` | `isStillFail` in `code-delta.ts`, read by `codeChanges`, `codeTitleWords` (`code-format.ts`) and `codeStep` (`code-deliver.ts`) |
| The lines and the hint | `codeEntryLine` and `quietHint` in `src/core/delivery/code-format.ts`; `codeEntryLine` now takes the command |
| The agent's reference | `plugins/{claude-code,codex,pi}/skills/squeal/references/policy.md`, Complexity, its own bullet |

## The rule as built

| The view holds | An edit leaves the function over | The view then holds |
|---|---|---|
| `count` (a seed, a catch-up, a change past the 5-line limit) | `STILL FAIL ... is 23 after the edit; it was already over 20 before it (ESLint rule); <hint>` | `still` |
| `full` (a FAIL told in its own line) | `STILL FAIL ... is 22 after the edit, over 20 (ESLint rule); <hint>` | `still` |
| `still` | nothing | `still` |

The hint: `Squeal stays quiet about it until it is at or under 20, and squeal code src/cli/retry.ts shows its count.` A `PASS` removes the entry, so a later `FAIL` starts the cycle again.

## Decisions the brief did not settle

1. **A third view mark, `still`** (coordinator agreement, 2026-10-24). `count` and `full` both allow one STILL FAIL; after it the function is quiet. It goes in the existing `views.told` TEXT column, so the code store has no schema step: a V2 would make every older daemon refuse the store (`newer-schema`). Accepted cost: an older hook of the same consumer that reads a `still` row throws in `views.list`, and `withCode` drops that consumer's code part until SessionEnd. A session keeps one plugin version, so this needs a plugin update mid-session. Also: a view an older hook wrote `full` after a 015-08 STILL FAIL reads, after this change, as a told FAIL, so that function's next edit tells one more line. Same condition.
2. **Two kinds, two wordings** (coordinator agreement, 2026-10-24, option (a)). `edited-after-fail` is a new `CodeDeltaKind`. The two lines mean different things: over before the edit, and still over after a fix attempt. Both end with the hint.
3. **An entry is as of every change the delivery read.** A hook reads its clock (`at`) inside the main store's transaction, and then opens the code store. Its write transaction can wait for the pass's commit. So a FAIL can be told for a crossing whose time is after the entry's `toldAt`. Without a guard, the next delivery reads that same crossing edit as an edit after the FAIL and tells a STILL FAIL with no new edit. A write that changes the entry's outcome now takes `toldAt = max(at, last transition's at, last edit's at)`. A told edit takes `max(at, edit's at)`. In normal order (every change before `at`) this is `at`, as before. The test `tells no STILL FAIL for the edit a FAIL told, when the pass counted it after the hook's clock` fails without it. It also closes the same race for 015-08's `count` entries past the 5-line limit.
4. **A fail, pass, fail between two deliveries** with the view at `still` is quiet. The consumer heard no change of state, and it is over now (D5). With the view at `count` or `full` it is told as an edit, as 015-08's decision 6.
5. **An edit past the 5-line limit** is written `count`, as before. The function's next edit tells it, with the 015-08 wording.
6. **The policy text** gives both lines and the quiet after them in a bullet of its own. The move-or-rename sentence stays in the bullet before.

## Type changes

All additive.

- `CodeTold` gains `"still"` (`src/core/types/code.ts`, its own commit, coordinator agreement).
- `CodeDeltaKind` gains `"edited-after-fail"` (`src/core/types/code-delivery.ts`, its own commit, coordinator agreement).
- `codeEntryLine(entry, command)`: the command is a new required parameter. Its only caller is `codeLines` in the same file.
- New: `isStillFail(kind)` exported from `code-delta.ts`.

## Shared files touched (coordinator agreement, 2026-10-24, each in its own commit)

- The two types above.
- `test/code/pass/pull.test.ts:13` and `test/code/pass/overtaken.test.ts:17`: the STILL FAIL line constants end with the hint. Nothing else.

## Tests

`test/code/delivery/standing.test.ts`, describe `a failed fix attempt (015-21, lessons round 1 P3)`:

- FAIL at 23, an edit to 22: one `STILL FAIL ... is 22` with the hint, titled `1 function still over the complexity threshold`. An edit to 21: quiet. An edit to 20: `PASS`.
- After `PASS` and a new `FAIL`, the next edit that stays over tells again.
- Two sessions: each hears its own FAIL and its own STILL FAIL. An edit before a session's FAIL is not its fix attempt.
- The race of decision 3.

The test `tells PASS -> FAIL and FAIL -> PASS as before, and an edit after a told failure is quiet` is replaced: its last rule is the one this row changes. The 015-08 tests now expect the hint and the `still` mark.

## Not done here

- `plugins/*/dist` are not rebuilt (not this row's). The bundle-drift tests fail until the candidate's build, as after every row of 015.
- No hook-level test through a daemon, as 015-08.
- Row 015-26 (an agent subscribes to progress updates on a failing function) would change the hint's second half. The hint is one function, `quietHint` in `code-format.ts`.
