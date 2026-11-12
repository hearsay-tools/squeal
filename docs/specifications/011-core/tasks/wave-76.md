# Wave 76: row 011-319 (one run evidence module, behaviour preserved)

Coordinator bef76bfb, 2026-11-12. The human approved rows 011-319 and 011-320 (architecture review task af6c0b3f, "A: approve, land, start"). This wave is 011-319 alone. Spec 021's row 021-20 part two, which owned `keep.ts` until then, landed on main as 0.1.450 (130a19fd7) before dispatch. 011-320 follows in wave 77, briefed from this wave's module.

Host policy, as in `wave-75.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-319

Use /worker. Shape: slice, test first, one commit per step.

Outcome: the daemon's record step and the code gate's keeper take the facts around a run and the store decision from one module; no keep, store decision, note or key changes.

Read: board row 011-319; `research/run-evidence.md` (all of it, the coordinator's calls in particular); `GLOSSARY.md`, "Results" (use its terms in names); spec 001 D5; spec 020 D17.3 and D17.5.

Seam and lead: `Keeper.#keepable` (`src/core/code/gate/keep.ts`) and `TierRecords.#prepare` (`src/core/scheduler/record.ts`) gather the same facts from the same helpers. First edit: the module's types and its table test under `test/run-evidence/`: input state before, what happened during the run and the report in; the store decision and its reason per file out; a scratch store and a temporary tree, no runner, no daemon; one column with the daemon's sources, one with the keeper's. Then:

1. The module, `src/core/run-evidence/`, one entry file, no barrel. It copies the input state, reads the evidence, builds the `TierEnd` through `tierEnd`, calls `storeDecision`, and answers whether a file's inputs still hold the bytes the run read.
2. The daemon: `startTier`'s snapshot, `unstableInputs`, `#ended`, `#prepare` and `#barrier` take their facts from it. `rekeyEnvironments` keeps its re-key and its order under the scheduler lock; `Withholds` stays in `record.ts`.
3. The keeper: `Expectations.add`'s snapshot, `#keepable` and `steadyOf` take facts and decision from it. It keeps only on "store at the key it ran under" and supplies only what it reads today.
4. Delete the cases the table replaces (the design's list). In your notes, map each deleted case to its table row, and list the scheduler tests the table repeats without deleting them.

Owns: `src/core/run-evidence/**`, `test/run-evidence/**`, `record.ts`, the snapshot and `unstableInputs` in `tiers.ts`, `stability.ts`, `observed.ts`, `editor-scratch.ts`, the read half of `environment-growth.ts`, `keep.ts` (`#keepable`, `steadyOf`), `keep-expected.ts`, the tests the row deletes.

Leave alone: `src/core/scheduler/store-decision.ts` (byte for byte), `record-tier.ts`, `recordTier`'s write, `keep-write.ts` (its `InputCheck`), `keep-sent.ts`, `keep-here.ts`, `src/core/daemon/keep-request.ts`, `test/code/gate/keep-busy.test.ts` (row 020-30), `code-gate-keep-busy`, `code-gate-keep-stop`, the `keep-daemon*` tests, every key computation, `KEY_FORMAT_VERSION`.

Stop and ask the coordinator if `store-decision.ts` must change, the key alarm asks for a raise, or a keep or a store decision would change.

Done when: the row's done-when holds; `git diff <base> -- src/core/scheduler/store-decision.ts` is empty; `test/keys/key-format.test.ts` and `test/keys/validity/` pass with no version raise; the keeper's and the scheduler's tests pass unchanged, less the deleted cases; lint and typecheck pass; affected results read through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-319/notes.md`. Your final message lists decisions the design did not settle, type changes, and any wrinkle of the design's calls that did not hold.

## R1: review of cand/0.1.452

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.452` at `360021aa8b8f1f1ca51bfc485d5b5ea36d7e5ebd`; range `a9da4ff43..360021aa8` (four worker commits of 65662af4, cherry-picked, then the 0.1.452 bundles). Read: board row 011-319, `research/run-evidence.md`, `tasks/011-319/notes.md`, this file's W1. Candidate CI: run 43236889748.

Check, each as proven, plausible or unverified:

1. No keep changed. For every combination of evidence (completed or not, record or not, observed growth, changed or touched input, environment file the keys lack, listing paths among the inputs), the keeper's old filter at `a9da4ff43` (`#keepable`, `steadyOf`) and the new `keeps`/`keepDecisions`/`stillAsRead` keep the same files. The notes claim that leaving listing paths out of the keeper's check has no effect: verify it.
2. No daemon store decision changed. `record.ts` (`#ended`, `#focused`, `#prepare`, `#heldNow`, `#barrier`) and `recordTier` make the same calls in the same order with the same arguments, under the same lock. The table's daemon column must describe what the daemon does, not a copy that can drift: say whether `decideFiles` is the daemon's own path or a parallel one.
3. The table test replaces the deleted cases, not an addition. Each deleted case maps to a table row that proves the same thing; each case the notes keep is justified.
4. `src/core/scheduler/store-decision.ts` is byte for byte as at `a9da4ff43`; `test/keys/key-format.test.ts` passes against `squeal--v0.1.451` with no version raise.
5. Judge the three deviations in the notes ("Where the design's calls did not hold") against the row's done-when.

Host policy: no local full suite, no `squeal run --all`, no `pnpm run build`; targeted runs with `env -u PLUGIN_ROOT -u PLUGIN_DATA`; affected results through `squeal status --wait 60000 <paths>`. Write `reviews/0.1.452.md` and commit it on your branch.
