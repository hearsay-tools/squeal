# Wave 96: background store writes pause between batches (row 011-350, #220)

Coordinator 0fbd88cd, 2026-11-14. Approved by the human on 2026-11-14 ("Store turns"). Evidence: `../020-quality-gate/research/issue-220.md` (Q1, option D) and its probe `research/probes/issue-220/starve.mjs`; spec 021 D3 and `../021-remote-store-and-execution/research/store-contention.md` Q3; this spec's C7 (short transactions).

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version, `KEY_FORMAT_VERSION`.

## W1: row 011-350

Use /worker. Shape: slice. Effort high.

Outcome: every back-to-back write loop of the code-store prune and of the import pauses after each batch for as long as the batch held the lock (at least `MIN_PRUNE_GAP_MS`), so a waiting writer in another process gets turns.

Read: board row 011-350; `issue-220.md` Q1 and its probe; `src/core/daemon/sliced-prune.ts` (the pause to copy); `src/core/daemon/lifecycle.ts:426-450` (how the code prune runs today: synchronously, in `then`, after the main prune).

Seam, code-store prune first: `deleteInBatches`, `pruneParts` (`parts.ts`) and `vacuum` in `src/core/code/store/prune.ts` loop with no pause. Lead: make the code prune a generator of slices, as `pruneSlices` is for the main store, and run it through the same paced driver as the main prune, keeping its report counts, its `retries.run` failure handling and `stop()`. Then `importSliced` (`src/core/store/transfer-import.ts:72-87`): the same pause after each slice. The pause rule has one owner (a helper both drivers call); it is derived from the measured hold, never a host-tuned number. Tests inject the delay so they stay fast.

Owns: `src/core/code/store/{prune,parts,prune-main,store,types}.ts`, `src/core/daemon/sliced-prune.ts`, the prune lines of `lifecycle.ts`, `src/core/store/transfer-import.ts` (and `transfer-import-slices.ts` only if needed), their tests under `test/`. Leave alone: `src/core/scheduler/` (coordinator aaf51267, rows 011-346..349), `src/core/code/gate/` (coordinator 31e1d860, rows 020-67/68), tier records, the idle checkpoint.

Row 011-318 (the prune's lookup-then-delete race at `prune.ts:161`) is its own row: do not fix it. Pauses widen its window in time, not in kind; say so in the notes.

Done when: the row's done-when holds: a holder-and-waiter test on a scratch store (the waiter in another process or thread, 250 ms busy slice, as `starve.mjs`) lands at least one write during a code-store prune of many batches, and the same for an import of many slices; each test fails with the pause removed (say so in the notes); prune results, the 256-row budget and the store format unchanged. Assert landings, not counts, so the test is not host-tuned. `tasks/011-350/notes.md` names the pause owner, the callers that now pause (daemon import, shared reader, CLI import) and the extra wall time on a prune of N batches. Lint, typecheck, `test/keys/key-format.test.ts` (no raise) and `squeal status --wait 60000` on the changed paths pass; report pending or unknown checks as such.
