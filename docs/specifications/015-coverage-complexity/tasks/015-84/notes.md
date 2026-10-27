# 015-84 notes: send a standing summary only when it changes

Worker 5651637e, 2026-10-27, from `tasks/wave-20.md` W2 (coordinator 8b2a8995). Shape: slice. Spec D6, **The other side** and **A changed file not judged**, with the approved amendment "015-84 (Round 2 C7)" at the end of `spec.md`; `lessons.md` Round 2, C7.

## What changed

| Part | Change | Where | Test (red first) |
|---|---|---|---|
| The label | Test news's last line starts `Code:`, not `Complexity:`. It counts CRAP and untested functions too. Its words after the label do not change. | `toldOverLine`, `src/core/delivery/code-format.ts` | `test/code/delivery/told-once.test.ts` (red: every case got `Complexity: ...`) |
| The signature | `standing` builds the summary and a signature: the told-over counts and thresholds (`CodeNews.toldOver` as is), and every changed file not judged, by path, with its reason (`over <maxFileBytes>` or `could not count`). The signature holds all such files, not only the three the line names. | `src/core/delivery/code-told.ts` | "comes again when a file past the third named changes, the line's text the same" |
| Once per change | `withToldOver` adds the summary to the news only when its signature is not the one recorded for the consumer. It then records the signature in code `meta` under `sentSummary:<worktree>:<session>:<agent>`. When no summary stands, it deletes the record, so a return of the same summary is sent. | `code-told.ts` | "comes once while its numbers stand", "comes again when a count changes", "comes again after it went and came back", "comes again for another changed file not judged" |
| Read first | `tellCode` without code changes to write reads `summaryChanged` first. It opens a write transaction only when the record must change. A delivery with code writes records the summary in its existing transaction. | `tellCode`, `src/core/delivery/code-deliver.ts` | all of the above; the unchanged case takes no write |
| Resume | `dropCode` does not delete the record at SessionEnd, as for the too-big marks (015-36). A resumed session is not told the same summary again. Registration does not read or write it. | `code-deliver.ts` (doc only) | "keeps the summary sent across a resume", "a registration, a resumed one too, before the summary's first test news" |

## Retired and changed checks

- `test/code/delivery/not-judged.test.ts`: "names a file ... on every test news" asserted the repeat that this row removes. It is now "... once while it stands": the second test news and the test news after a same-size edit have no line. The other cases change only the label.
- `test/code/delivery/cross-summary.test.ts`: the label, and "leaves out what another session was told". There C2's second test news repeated the line; now C2 gets it once, with its FAIL. The registration case also asserts no `Code:` line.
- `test/code/crap/told.test.ts` (015-80's file): only the four delivery-tail label strings, in their own commit, agreed with the coordinator (reply to request a5e781b3). Its case name "keeps the complexity-only told and recount lines byte-identical" no longer matches the told line; I left the name, as the agreement covers the four strings only.

## What the tests pin (`told-once.test.ts`)

- The same numbers at three test news: one line.
- A count change (a second function told FAIL): the line again, `2 functions`. A STILL FAIL edit that leaves the count: no line.
- The function passes (a test news with no summary clears the record), then fails again: the line again.
- One not-judged file is judged and another of the same size is not: the line again, naming the new file.
- Four not-judged files; the unnamed fourth is replaced by another file, and the three named stay: the line again, its text the same as before.
- Two consumers: each gets the line once.
- A resume (SessionEnd, then registration) after the line: no line.
- A code-only delivery, `squeal code --told`, a registration of the same session or another, and formatting the delta twice: none takes the summary. The first test news after them carries it.
- An idle waiter's test news takes it once, as a tool boundary's does.
- A pull's FAIL changes the count: the line again.
- `codeLines`, `codeChanges` and `codeTitleWords` give the same output for a news with and without `toldOver` and `notJudged`.

## Decisions the brief did not settle

1. **Absence is seen only at test news.** The record is cleared when a delivery with test news finds no summary. A summary that goes and comes back between two test news is not sent again. In that case the agent heard each change as its own code line (a PASS, then a FAIL), so the agent already knows the new state. The other choice was to compute the summary at every code delivery that writes. That adds a read to each such hook and sends more lines. The brief's case "disappearance then recurrence" has a test news between, and is pinned.
2. **File sizes are not in the signature.** An edit that changes a too-big file's size gives no new line. The spec names "identities/reasons". The limit (`maxFileBytes`) is in the signature, so a limit change that keeps the file too big is a change.
3. **The record stays after SessionEnd.** This is what lets a resumed session keep it. Records of ended sessions stay in code `meta`, one short key each, as `tooBigTold` does. A record is deleted when its summary goes.
4. **A record is written only by a delivery with test news.** That is the only caller with `toldOver: true` (`delivery.ts`). The hook can still be cancelled after the code store commits and before the main store commits. Then the record says sent for a line the agent did not see. This is the same as the code views today.
5. **No migration.** A consumer from before this change has no record, so its next test news sends the summary once. That keeps the old not-judged warning until its first actual delivery.

## Type changes

None. `CodeNews` is unchanged. New exports: `sentSummaryKey` and `summaryChanged` (`code-told.ts`).

## Checks run

- Red: `told-once.test.ts` at `a76864770`, 11 of 11 cases failed on the old label, through Squeal at revisions 4 to 6.
- Green: `squeal status --wait 60000` on `told-once`, `cross-summary`, `not-judged`, `crap/told`, `code-command`, `pulled`, `resume` and `too-big` test files at revision 14: no known failures, 8 test files current. `told-once.test.ts` again at revision 16 after the formatter pin: current, passing.
- `npm run lint`: no fixes. `npm run typecheck`: clean.
- Not run: the full suite and bundles (brief). Squeal reports two expected failures, `test/harness/{opencode,pi}/package.test.ts` "cli/squeal.mjs differs from the build", which is bundle drift from changed sources. When I finished, the source files' wider affected set (about 745 test files) was still queued behind Squeal's 120-second catch-up quiet; see the final report for its state.

## For the next worker or the coordinator

- The skill references still describe the old tail: `plugins/claude-code/skills/squeal/references/policy.md:56` and `commands.md:106`, and the same files under `plugins/codex/`. They say test news ends with `Complexity: 2 functions over 20 that this session was told about`, and `policy.md` says a recovery "with no `Complexity:` line after it means no function you heard of is still over". With this row, no `Code:` line can also mean "unchanged since you were told". I did not own these files.
- Spec D6 text before the amendment still says `Complexity:` for this line, and "It comes with every test-news delivery while such a file stands, not once" for **A changed file not judged**. The amendment at the end of `spec.md` overrides both; folding it into D6 is the coordinator's.
- The `squeal code --told` header (`Complexity: N functions over 20 that this session was told about`) is unchanged. It is a CLI header, not the delivery tail.
