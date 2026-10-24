# Wave 27

From main `ac53bf2bf` (0.1.284). Two rows on disjoint seams, run side by side. Each ships through its own candidate, review and version raise; the coordinator integrates.

## W1: 011-146, focused checks R3: `status --check`, the focused wait, status and `why` lines

Use /worker. Shape: slice.

Outcome: `squeal status --wait <ms> <test file> --check <text>` runs the named checks first and answers with their outcome; `status` and `why` show a focused run while it applies.

Read board row 011-146; `tasks/011-135/design.md` sections 2 and 8 (R3); 011 C4, C5, C6, C14 and C15 as amended 2026-10-23; `reviews/0.1.280.md` "Inputs for the next wave"; `tasks/011-145/notes.md`.

Seams: `status`'s options in `src/cli/main.ts` (line 242); `src/cli/status-wait-promote.ts`, where promotion is sent: send `focus(testFiles, texts, withinMs)` once beside it (the daemon side shipped in 0.1.280). Read the outcome with `readFocused(store, worktreeId)` (`src/core/scheduler/focused-row.ts`) and check each entry's key against the file's current key. `matched: 0` is a real answer (a text that matches nothing), not a missing count. An older daemon answers the request unknown: give the fallback line and a named wait. Focused evidence never supplies a known failure, inherited result, duration or checkpoint; `failures` and the hooks show none of it.

Owns the files the row names, their tests, `tasks/011-146/`. Not yours: `src/core/scheduler/`, `src/core/daemon/`, `src/runners/`, `src/core/keys/` (W2), the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output in your summary.

## W2: 011-158, a path another branch added keys a file through the shared closure list

Use /worker. Shape: slice.

Outcome: two worktrees at equal content get equal keys even when the shared closure list holds a path only another branch has; adding that path in either worktree still re-keys the file.

Read board row 011-158; `research/missed-sharing.md` sections 2 (cause D) and 3; 011 C3 (closures, the add rule) and 001 D6 (key format, the alarm); `tasks/011-41/notes.md` on the key-format alarm.

Seams: an absent path enters a key as `path\0-\0` in `src/core/keys/check-key.ts:45-47`; the start keys every file from the stored list in `src/core/scheduler/bootstrap.ts:140-178`; the closure list read in `src/core/scheduler/keying.ts`. A lead: leave absent paths out of the key, then prove C3's add rule re-resolves the closures of a directory's importers when the module appears, so the file re-keys. Measure on the committed bundle, not a tsc build (the research's E0: they key apart).

Before you raise the key format or any adapter version, stop and send me a request with the alarm's output and which stored results the change invalidates. Every stored result going stale at upgrade is the human's call.

Owns `src/core/keys/`, `src/core/scheduler/{keying,bootstrap}.ts`, their tests, `test/keys/`, `tasks/011-158/`. Not yours: `src/cli/`, `src/core/status/` (W1), the board, spec text, bundles, version. No `npm run build`. Never run a script under `evals/bin/` or `tasks/*/probe/`; never open a live store or socket (copy a store with `-wal` and `-shm` first).

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output in your summary.
