# Wave 0 of spec 015: the code-check seam

One row, one worker. Wave 1 (015-05 to 015-08) builds on this interface. Briefed by coordinator 52e58f23 on 2026-10-23, after the human approved `spec.md` with changes.

## W1: 015-04, the code-check seam

Use /worker. Shape: slice.

Outcome: the types, the policy keys and the code store that wave 1's counter, daemon pass and delivery share. Nothing calls them yet, and with the policy off nothing on disk changes.

Read: `spec.md` D1, D2, D4, D5 and D6 (the view marks only), D8's record (its table only); `status.md` 2026-10-23; 011 C5 (delivery views) and C7 (store rules).

Seams:
- **Types.** `src/core/types/code.ts`, new: the code check identity `(path, qualifiedName, occurrence)` and its measure (`complexity`, `crap`, `uncovered`), beside `CheckId` in `check.ts`, never in it. Also its known state (D4), a transition record, and a view entry marked told by count or in full.
- **Policy.** `src/core/daemon/policy-code.ts`, new, after `policy-slow.ts`: the D1 keys with their defaults and the same error notes the other sections give. Add one block each to `Policy` and `DEFAULT_POLICY` in `src/core/types/policy.ts`, and one call in `src/core/daemon/policy.ts`.
- **Store.** `src/core/code/store/`, new: `code.sqlite` beside the store (`src/core/store/paths.ts`), with its own `user_version` and migrations, opened only when `complexity.enabled` holds. It reuses `busy.ts` and the connection rules.
  - Tables: counts by `(blob, language, counterVersion)`; states, transitions and view entries per worktree; coverage records by result key (empty until wave 2).
  - A prune that follows C7's retention.

Owns those new files, the blocks named above, their tests under `test/code/`, and `tasks/015-04/`. Not yours: the main store's schema (`src/core/store/schema.ts`; its `user_version` stays 1), delivery, status, the CLI, the daemon loop, the scheduler, the board, spec text, bundles and the version. No `npm run build`.

Shared files: 011 wave 26's W1 (worker fa8e6ec2) changes the `baseline` default in `src/core/types/policy.ts` and `src/core/daemon/policy.ts`. Keep to your own blocks there; the coordinator merges.

Done when:
- Tests show the policy keys parse with their defaults and reject bad values with a note.
- With the policy off, opening Squeal creates no `code.sqlite`.
- When on, the code store opens, migrates once under concurrent openers and is read without a write.
- A count stored by one worktree is read by another.
- Prune drops a count no current file uses.
- Lint, typecheck and `squeal run --all --wait` pass; paste their output.
- Your final message lists every type wave 1 will import, and every decision the spec left open.
