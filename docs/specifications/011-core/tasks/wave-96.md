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

## R1 (W1): review of cand/0.1.509

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.509` at `c3e5cfbe0928266ff15f82bcabc6643cdbb0db3d`; candidate CI run 43651038536. Range `43e605fca..c3e5cfbe0`: six commits of worker 912adabb (cherry-picked from `71460d84d..56cca082c` without conflict), then the 0.1.509 raise and bundles. Read: board row 011-350, this file's W1, `tasks/011-350/notes.md`, `../020-quality-gate/research/issue-220.md` Q1.

Check, each as proven, plausible or unverified:

1. **Turns.** Every back-to-back write loop of the code-store prune (`deleteInBatches`, `pruneParts`, the vacuum steps) and of `importSliced` now pauses after each committed slice by `turnGapMs`, derived from the slice's own hold. No loop of write transactions in those paths still runs with no pause.
2. **Same prune.** The code prune deletes the same rows as at `43e605fca` (counts, coverage, parts, checks, views, per-worktree rows, meta), in 256-row batches, with no store format change; the daemon still runs it after the main prune, logs a failure as `code prune failed`, closes the code store on every path (done, stop, throw), and `stop()` ends it between slices.
3. **Busy handling.** A busy code store now retries the one slice through `SlicedPrune`, not the whole prune through `retries.run`: no slice holds the event loop past `BUSY_SLICE_MS` on the code store's connection, and nothing that `retries.run` gave (its log lines, its grouping) is lost where a user reads it.
4. **Import.** The pause covers the daemon import, the shared reader and the CLI import; a refused try does not count as a hold; `stopped` and `ImportStopped` behave as before.
5. **Tests.** The holder-and-waiter tests fail without the pause (notes) and are not host-tuned; the 30 s timeouts are acceptable.
6. **Row 011-318.** The pauses widen the prune's lookup-then-delete window in time, not in kind; say whether anything else in the race changed.

The coordinator's tree passed lint, typecheck, `check:version`, `key-format` and `version-sensitive` (19 tests) at the candidate; CI is the full suite (known flake: row 005-82, `test/cli/warmup.test.ts:222`). Host policy as in `wave-85.md`; never the real `HOME`. Write `reviews/0.1.509.md` and commit it on your branch.
