# Wave 54: a new failure is not called a load flake; Squeal stays off until started (rows 011-253, 011-254)

Coordinator 04a258b0, 2026-10-26. The human approved both on 2026-10-26 (#103 "Approve fix", #104 "Approve, whole worktree"). W1 runs beside wave 53 (row 011-251). W2 starts only after 011-251 is integrated: both own `src/cli/stop.ts` and `src/harness/shared/ensure.ts`.

## W1: row 011-253 (gh-103)

Use /worker. Shape: slice.

Outcome: a first failure after an edit in the test's import graph, with no earlier pass at the same inputs, leads with "look at the files you changed" and says no earlier pass exists, in place of a load retry.

Read: `research/issue-103.md`; issue #103; 011 C5 (known state, flaky notes, the load advice of row 011-67), C7 (stored provenance).

Seam and lead: `recordedText` and `loadRetryText` in `src/core/retry/text.ts` name the load retry from the load alone. Give them a fact "a pass at this key came before this failure" (`RecordedFacts`, `src/core/types/status.ts:493`), read from what the store keeps. If that fact needs a new stored field, send me the shape as a request first. The later flaky note (`src/core/state/flaky.ts`, `format-why.ts`) must not read as a harmless load flake when no pass came first.

Owns: `src/core/retry/text.ts`, `src/core/retry/recorded.ts`, `src/core/state/flaky.ts`, `src/core/status/format-why.ts`, `src/core/delivery/failure-groups.ts`, `RecordedFacts`, and their tests. Not yours: wave 53's files (`next-step.ts`, `status-wait-lines.ts`, `outstanding-text.ts`, `status-detail.ts`, `died.ts`, `stopping.ts`, `stop.ts`, `ensure.ts`, `wait-liveness.ts`, `start-mark.ts`, `daemon-facts.ts`, `status-wait.ts`, `status-wait-paths.ts`), the board, spec text, `status.md`, bundles, version. No `npm run build`. Send me any new user-visible line, rendered by the real formatters, before you commit it.

Done when: the triage row's done-when holds (board row gh-103): a first failure with no earlier pass at its inputs leads with changed-file inspection and names the missing pass; a later pass keeps the same-input flip without implying a harmless load flake; an established same-input pass still allows load advice; tests cover earlier passes at other keys, at the current key, no history, and the same text in `why`, status and the notice; lint, typecheck, `squeal status --wait 60000 <changed paths>` and `test/keys/key-format.test.ts` pass. Notes in `tasks/011-253/notes.md`.

## W2: row 011-254 (gh-104), held until 011-251 is integrated

Use /worker. Shape: slice.

Outcome: an opt-in mode keeps Squeal off in a worktree, through branch fast-forwards and edits, until an explicit `squeal start`; the default `squeal stop` and command holds do not change.

Read: `research/issue-104.md`; issue #104; 011 C9 (the stopped mark and what clears it), C8, C6.

Seam and lead: the stopped mark that C9 clears on a tracked-tree change. Add a mode that no tree change clears, set by an explicit flag on `squeal stop` (name it in your first request to me, with the exact status and stop lines), read by the hooks' spawn path before they start a daemon.

Owns: `src/cli/stop.ts`, `src/harness/shared/ensure.ts`, the stopped-mark module, the status line that names the mode, and their tests. Not yours: the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when: the triage row's done-when holds (board row gh-104): the mode survives `git merge --ff-only`, checkouts and edits with no daemon start and nothing queued, until `squeal start`; status and stop name the mode and how to end it; tests cover git changes, edits, hook boundaries, explicit start and a second worktree; default stop-until-edit and command holds are unchanged; lint, typecheck, `squeal status --wait 60000 <changed paths>` and `test/keys/key-format.test.ts` pass. Notes in `tasks/011-254/notes.md`.
