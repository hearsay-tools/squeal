# 001-396 notes: the edit acknowledgement in the message that is the result

## Cause

008's dogfooding (`008-opencode-adapter/lessons.md` defect 4(b), s4b): a wake carrying a newly created test file's FAIL said "Squeal saw your edit and queued 1 test file; results arrive with later tool calls…" under a header with "0 pending". Reproduced in `test/delivery/edits-confirmation.test.ts` with the real ledger, `queueReruns`, sink and delivery. The edit's first result fails anew, so 001-171 queues a confirmation run at the same key. That run keeps the file's `test_file_keys` row pending, which holds the settled line (001-240, review wave 13v B1): `editNotes` returns `sawEdit` with no `editsSettled`, and `editLines` renders the 001-224 sentence. The check itself is current FAIL, so the header counts nothing pending.

When the result is a pass, or the file was not re-run again, `editsSettled` is set and the combined `sawSettledLine` ("Squeal saw your edit; the 1 test file it re-keyed is current…") is said instead. That sentence contradicts nothing and is unchanged.

## Fix

`carriesEditResult` (`src/core/delivery/edits.ts`), applied in `deliver` after the header is read: the 001-224 line is left out when all of these hold:

- the notes have `sawEdit` and no `editsSettled`, so the rendered line would be `sawEditLine`;
- the delivery's entries carry a check of a file the line counts (`EditNotes.rekeyed`, new);
- the header has nothing pending: no pending checks, no pending test files without checks, and no pending runner part.

With any of these false the line is said as before. A delivery whose only news is the line (a tool boundary right after the edit) carries no entries, so it keeps it.

## Spent, not carried

The line is spent: `notes.tell()` still records 001-224 as said, so the consumer's next edit does not say it either (the first test below checks that a second edit delivers nothing).

- 001-224's purpose is to tell the agent, once, that Squeal saw its edit and results come without being asked, so it does not run the tests itself. A result that arrives unasked, in a wake or at the next tool call, shows that more plainly than the sentence.
- Carried to the next edit, the sentence would tell an agent that has just received a result that results arrive with later tool calls: true, but by then known.
- Its other half, "passing ones stay silent", is in the SessionStart primer every harness gives ("passing results stay silent").
- Carrying it needs a third edit state, said in a delivery but not spent, in `writeState`'s slot, which every harness's state shares. Spending it changes no stored shape.

## Tests

- `test/delivery/edits-confirmation.test.ts`, "the 001-224 line beside the edit's own result": the s4b order (edit, FAIL, confirmation queued) delivers the FAIL with "0 pending" and no saw-edit line, and a later edit says nothing. When the edit re-keyed a second file that is still pending, the message carrying the first file's FAIL keeps "queued 2 test files; results arrive with later tool calls". The first was red before the fix (`expected { queued: 1 } to be undefined`).
- Wording, through each harness's own entry: Claude Code's waiter wake (`test/harness/turn.test.ts` (2b)), Codex's PostToolUse (`test/harness/codex/turns.test.ts`), OpenCode's idle wait (`test/harness/opencode/turn.test.ts`). Each was red with the predicate disabled and green with it. `SquealRepo.confirm()` (`test/harness/helpers.ts`) puts `FILE`'s row back to queued at its key, as the daemon's confirmation does.

## Not changed

- `src/core/types/delivery.ts`'s doc comment on `Delta.sawEdit` still says "the first delivery after its first edit". It is a guarded source under the key-format guard. Proposed wording for whoever next touches it: "…says how many test files its edits queued, unless that delivery carries one of their results with nothing pending (task 001-396), when it is spent unsaid."
- Spec wording proposed for 001's delivery section, beside 001-224: "The acknowledgement is not said in a message that itself delivers a result of a file it counts while nothing is pending; it is then spent."
- The plugin bundles are not rebuilt (the brief); `test/harness/*/package.test.ts` and the bundle drift checks see the source change until the next rebuild.
