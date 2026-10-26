# Wave 45

From main after 0.1.331 (`81f88ecf5`), 2026-10-26. Four rows on disjoint seams: two product fixes from review notes (W1, W2) and two tests that failed once on CI (W3, W4). Host load is about 20 on 24 CPUs. Verification follows `docs/process.md`, "Test runs on a shared host" (2026-10-25): no `squeal run --all` and no local full suite. Gh-99 waits for the human and is not in this wave.

## W1: 011-201, the committed-file recovery reads HEAD in reftable repositories

Use /worker. Shape: slice. Row 011-201 in `docs/board.md`.

Outcome: in a reftable repository, a committed add whose watcher hint is held is still found by the recovery.

Read the row; `reviews/0.1.304.md` N1; row 011-199's notes.

Seam: `committedSince` (`src/core/watcher/candidates.ts:178`). It returns no candidates when `readGitHead` (`src/core/status/git-head.ts`, called at `change-feed.ts:281`) gives `null`. First edit, offered as a lead: when the file reader cannot resolve HEAD, `committedSince` falls back to `git rev-parse --verify -q HEAD`, still before the pass's status. Keep `readGitHead` synchronous and free of child processes, because status reads it.

Owns `src/core/watcher/candidates.ts`, the call site in `change-feed.ts`, and their tests. Not yours: `src/core/status/git-head.ts` (read only), `src/cli/` (W2), `src/core/scheduler/` (W3), `src/runners/` and `test/kit/` (W4), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when a reftable fixture finds the committed add, on a Git that can create one (skipped, and saying so, where none can; this host has Git 2.43). Also add a case where the fallback runs when the file reader returns `null`, for any Git. Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W2: 011-219, `squeal start` tells an ended spawn from a reused pid

Use /worker. Shape: slice. Row 011-219; `reviews/0.1.319.md` N1.

Outcome: when the daemon that `squeal start` spawned has ended and another process has its pid, `start` exits 1 at once, not 3 after 30 s.

Seam: `spawnedFailed` (`src/cli/start-ready.ts:28`) reads the child's life through `kill(pid, 0)`. First edit, offered as a lead: keep the spawned child's exit or error state for the explicit start's wait. Keep `ensureDaemon`'s string result for hooks, and the probe after the liveness check, so a loser that exits while the winner serves still succeeds.

Owns `src/cli/start-ready.ts`, `src/core/daemon/ensure.ts` and their tests. Not yours: `src/core/watcher/` (W1), `src/core/scheduler/` (W3), `src/runners/` and `test/kit/` (W4), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's case gives exit 1 at once, and row 011-214's cases still pass. Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W3: 011-231, `hold.test.ts` case 2 read no hold-end note

Use /worker. Shape: repair. Row 011-231.

Outcome: the cause of the one CI miss is named with evidence and fixed.

Seam: `test/daemon/hold.test.ts:197-199` waits until the hold's row is gone, then reads the notes at once. The note is written by `endedNote` (`src/core/scheduler/command-hold.ts:60`, from `:127`). First step, offered as a lead: find whether the note can be written after the row is removed. If the product is wrong, send one request before you change `command-hold.ts`.

Owns `test/daemon/hold.test.ts`; `src/core/scheduler/command-hold.ts` only after the request. Not yours: other `src/core/scheduler/` files, `src/core/watcher/` (W1), `src/cli/` (W2), `src/runners/` and `test/kit/` (W4), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the fix's test fails without it, or the case waits for the state it asserts. Case 2 must pass 20 of 20 alone, with the host's load stated. Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W4: 011-230, the node:test kit's K8 stored a cut file as a file error

Use /worker. Shape: repair. Row 011-230.

Outcome: the cause of the one CI miss is named with evidence and fixed.

Read the row; `test/kit/scenarios/k8-cut.ts`; the kit's cut in `test/kit/driver.ts`; spec 016 D1.

Seam: the node:test runner's cut path under `src/runners/node-test/`. First step, offered as a lead: find the order in which a cut's signal and the child's own exit make the runner map the cut file as a file error instead of no result. If the product is wrong, send one request before you change `src/runners/`.

Owns `test/kit/` (the node:test pack and K8); `src/runners/node-test/` only after the request. Not yours: `src/core/` (W1, W2, W3), `src/cli/` (W2), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the fix's test fails without it, or the kit step waits for the state it asserts. K8 on node:test must pass 20 of 20 alone, with the host's load stated. Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
