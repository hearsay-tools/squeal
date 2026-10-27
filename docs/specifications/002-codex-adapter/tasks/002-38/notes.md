# One current-selection owner

Row 002-38, review 0.1.368 B1. Source and owned tests only. The parent owns adapter regeneration, its version, combined proof and re-review. Row 002-39 owns shipped-proof identity fixtures. No generated file or version was changed.

## Mechanism and APIs

`adapter/selection.ts` owns every current write. A permanent `runtime/current.json.sqlite` database supplies a nonblocking exclusive SQLite transaction. The owner reads current, compares versions, checks the usable winner, admits selection and atomically replaces current while holding that transaction. Release closes the connection; process death releases it without replacing the database. No timestamp or JSON owner hint can revoke it.

This lock is separate from `runtime/update.lock.sqlite`. It covers no download, staging, runtime copying or full-tree hashing. A hook can bootstrap and pin during a stalled updater download. Existing pins bypass current selection. A first contact requiring selection fails immediately on contention with `RuntimeError.kind = "selection-busy"`; it creates no pin. Hook context uses the existing validation-unavailable diagnostic and asks for retry. Updaters record this error as transient, with the existing five-minute retry delay. The existing updater-lock `busy` result and owner PID keep their meaning.

`selectCurrent(data, version, options?)` is re-exported from `publish.ts` for compatibility and now returns the usable winning `RuntimeRef`. New `SelectionOptions` has `node?` and `beforeSelect?`. `PublishOptions` extends it. `publishRuntime(select:true)` still retains the requested tree, then returns the winning runtime, which can be newer than requested. Without `select`, it keeps the previous retain-only behavior and takes no selection lock. No caller needs a network lock to publish a seed.

The optional `beforeSelect` callback lets the updater recheck cancellation and deadline inside exclusion, after complete retention and winner checks, immediately before selection. A failure there leaves current and pins unchanged; a complete retained candidate may remain. Work admitted after that check is synchronous and can finish after its deadline. The 120-second policy is still an admission/network bound, not a hard total wall-time guarantee.

Bootstrap retains a missing seed outside selection exclusion, then uses the shared owner for both retained and new seeds. Its return and first pin use the winner. A valid but unusable newer current record remains unchanged, with the usable seed fallback as before. Invalid records can still be repaired. Missing/invalid pins and unsupported-Node diagnostics keep their existing behavior.

Both updater branches use the same selected publication. Their result and persisted state read the usable winner instead of reporting the requested version or a stale pre-download observation. Failed requests also report a concurrent bootstrap's current version.

## Exact regression evidence

The new `runtime-update/selection-process.test.ts` invokes two real Node processes through tsx. Each runs the actual adapter store or actual updater with its real SQLite updater lock. Filesystem interception only fixes the interleaving point. Transport serves synthetic descriptor/artifact bytes; no official release or model endpoint is contacted.

At revision 2, before source changes, all six original cases failed:

- Bootstrap pauses at the first seed-manifest read, after observing absent or older current. The child selects retained 0.1.901. Both a new seed and a retained seed then return/pin 0.1.900 and undo the completed update. Four cases.
- Retained updater pauses at retained-manifest validation; staged updater pauses at final retained-tree rename after its old seed recheck. The child bootstraps seed 0.1.902. Both updater branches then report `updated`, version 0.1.901. Two cases.

`squeal status --wait 60000 test/harness/codex/runtime-update/selection-process.test.ts` exited 1 at revision 2 with six current failures. At revision 3 the same six recovered. The final process file adds two concurrent-adapter cases: a newer seed wins against either a retained or new older seed, and the first session pin remains consistent.

Additional checks cover a real process holding selection exclusion, immediate contention diagnostics, no new pin on contention, retain-only publication and old-pin dispatch during contention, transient updater failure, recovery after SIGKILL with unchanged database device/inode, and bootstrap/pinning during a held artifact download. The process interleavings preserve existing pins. Admission tests exercise abort and expiry for retained and staged publication under the selection transaction, cleanup and unchanged pins, plus synchronous completion after final admission.

## Verification

Commands use `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal` for `squeal`.

- Named status for `adapter/selection.test.ts`, `runtime-update/selection-process.test.ts` and `runtime-update/publication.test.ts`: revision 9, exit 0, `no known failures; 3 test files, each with a current result`.
- `pnpm run lint`: exit 0, `Checked 2519 files in 771ms. No fixes applied.`
- `pnpm run typecheck`: exit 0 after the initial implementation's two type errors were fixed.
- Broader affected source-path status is still running. Record its final result before completion. No full suite, checkpoint, bundle build or version command was run.

## Integration boundary

The parent must deliberately regenerate the adapter and raise its adapter version as the version guard requires, then run combined checks and review. The frozen adapter still imports only its own modules and Node builtins; `node:sqlite` is a builtin. The current-record and pin-record schemas and paths are unchanged. New type surface: `SelectionOptions`, the optional publication callback, `selectionFile`, the `selection-busy` error union member, and `selectCurrent`'s return value. The return semantics of selected publication now expose the winner; retain-only callers still receive their requested retained root.
