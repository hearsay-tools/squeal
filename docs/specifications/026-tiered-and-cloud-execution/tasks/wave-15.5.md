# Spec 026 Wave 15.5: repair of `cand/0.1.662` (review `reviews/0.1.662.md` FAIL B1, B2)

One repair round, one narrow re-review (`docs/process.md` step 6). Each blocker goes back to the worker that wrote the code; seams stay disjoint. Shape: **repair**. Use /worker.

## R1 (worker eb61de95, row 026-38): B1

A Git-ignored path already kept in the reader's key from an earlier run must stay proven, even when the same run wrote its parent directory. `lane-proof.ts` `keptObservations` drops it as scratch today; `storeDecision` then stores the remote result at the unchanged local key.

- Apply the written-directory bound only to paths that are not already in the reader's keyed closure or retained observations; one owner decides (lead: the scheduler callback returns the effective kept set, so the lane does not re-derive the scratch rule).
- Regression: retained ignored input plus a write to its parent; unequal bytes refuse only that file under `not-run` and run it here under the default; equal bytes pass. Keep the fresh-screenshot, runtime-file, deletion and drift tests passing.
- Do not prune shared observations to make proof agree.

Owns the W1 files of `tasks/wave-15.md`. One commit, `fix(026-38): ...`.

## R2 (worker ed2849cc, row 026-39): B2

`git ls-files -s` and `--index-info` lose the intent-to-add flag: a local `git add -N` file becomes an ordinary staged empty file remotely, and the freshness hash cannot tell.

- Include intent-to-add in the local and remote freshness hash (lead: `git ls-files --format` with the flag, or a separate list of intent-to-add paths) and restore it remotely (`git update-index --intent-to-add` or `git add -N` on those paths) without touching working files the tree host owns.
- Tests compare `git diff --cached --name-status` as well as `ls-files -s`, including intent-to-add to staged empty file and back; keep renames, stages 1 to 3, odd paths and the zero-SSH case.
- Measure the added local cost: time `localGitState` on this repository and on one synthetic index of 100,000 entries; record both in `research/issue-303-notes.md`.

Owns the W2 files of `tasks/wave-15.md`. One commit, `fix(026-39): ...`.

## Re-review

Resume reviewer b8fba616 on the repaired `cand/0.1.662` SHA: B1 and B2 scenarios and the repair delta only.
