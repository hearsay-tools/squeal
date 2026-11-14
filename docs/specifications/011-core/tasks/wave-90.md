# Wave 90: rows 011-44, 011-45, 011-49 and 011-338

Coordinator cdd216e5, 2026-11-14. The human's answers of 2026-11-14: "Start all three" (the status-wait follow-ups 011-44, 011-45 and 011-49, held until row 011-331 moved the status waits into `src/cli/wait/`, landed as 0.1.484) and "Approve the row" (held-stop-leak, now 011-338). Four rows on disjoint seams, in parallel; whichever lands second in a shared file rebases.

Host policy, as in `wave-85.md`. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version. Measurements use the host's real load, stated per run; never make load on purpose; a store copy lives in private `/tmp`.

## W1: row 011-44, a named wait on a source path selects its files without reading every closure each poll

Use /worker. Shape: slice, test first. Effort high.

Read: board row 011-44 (scope, leads, done-when); `tasks/011-331/notes.md` (where the named wait's selection lives now, `src/cli/wait/named.ts`); `research/waits.md`.

Lead (a) of the row: keep the selection across polls and select again only when a closure was recorded since, read from a cheap marker of closure writes that the code recording a closure bumps in its own transaction. A store whose daemon writes no marker keeps today's reads. Put the marker in a new file of its own under `src/core/store/`; row 011-45 adds a separate marker for state writes, so use a meta key of your own.

Owns: `src/cli/wait/named.ts` and the selection it calls, the closure-write site and the new marker file, their tests. Leave alone: `src/cli/wait/status.ts`, `snapshot.ts`, `status-sync.ts` (W2, W3), `src/cli/code*.ts`, `KEY_FORMAT_VERSION`. Stop and ask if `test/keys/key-format.test.ts` asks for a raise.

Done when: the row's done-when (a counting-store test; the selection equals a full read's; the CPU per poll before and after on a cezar-sized store copy in the notes); lint and typecheck pass; key-format with no raise. Notes in `tasks/011-44/notes.md`.

## W2: row 011-45, the fallback `status --wait` reads every state only when one changed

Use /worker. Shape: slice, test first. Effort high.

Read: board row 011-45; `tasks/011-331/notes.md` (the edit wait's fallback read now lives in `src/cli/wait/status.ts`).

The row's lead: a per-worktree change marker that the code writing known states bumps in each transaction that writes them; a fallback poll reads the states only when the marker moved since its last read; a store whose daemon writes no marker keeps today's reads. A new file of its own under `src/core/store/` or `src/core/state/`, with a meta key of its own (row 011-44 adds a closure marker beside it).

Owns: `src/cli/wait/status.ts`'s fallback read, the state-write site and the new marker file, their tests. Leave alone: `named.ts`, `snapshot.ts`, `status-sync.ts`, `src/cli/code*.ts`, `KEY_FORMAT_VERSION`. Stop and ask if key-format asks for a raise.

Done when: the row's done-when (a counting-store test; news and quiet equal a full read's; a store with no marker reads as today; CPU per poll before and after in the notes); lint and typecheck pass; key-format with no raise. Notes in `tasks/011-45/notes.md`.

## W3: row 011-49, `squeal status <path>...` ends near its 750 ms bound

Use /worker. Shape: repair, test first. Effort medium.

Read: board row 011-49. The snapshot now lives in `src/cli/wait/snapshot.ts`; `DaemonSync` in `src/cli/status-sync.ts`, whose `stop()` only sets a flag while an in-flight request holds its socket for `CLI_SOCKET_TIMEOUT_MS` (2 s).

Cancel the in-flight request on `stop()`, or bound it by the snapshot's deadline; the named and edit waits share the helper, so their behaviour must stay as it is apart from ending sooner. First edit: the row's spawned-process test against a paused daemon (a fake daemon socket that accepts and never answers), pinning the process's own end.

Owns: `src/cli/status-sync.ts`, `src/cli/wait/snapshot.ts`, their tests. Leave alone: `named.ts`, `status.ts` beyond an import, `src/cli/code*.ts`. Done when: the row's done-when; lint and typecheck pass. Notes in `tasks/011-49/notes.md`.

## W4: row 011-338, a held-Stop stand-in outlives a test run cancelled mid-test

Use /worker. Shape: repair, tests only. Effort medium.

Read: board row 011-338; `tasks/011-336/notes.md` (the leak and its candidate fix); `test/harness/opencode/held-stop.ts`; how the `wait` bridge ends itself.

The stand-in (`stop.mjs`, polling for its release file every 5 ms) exits once its release folder is gone or once OpenCode's process is gone. First edit: a test that starts a stand-in, removes its folder, and finds no stand-in left within a bound.

Owns: `test/harness/opencode/held-stop.ts` and its test. Leave alone: `src/**`, `test/helpers/opencode.ts`, `test/harness/opencode/real.ts`. Done when: the row's done-when; the dispose tests still pass on the Node versions available; lint and typecheck pass. Notes in `tasks/011-338/notes.md`.

## R4 (W4): review of cand/011-338

Use /reviewer (codex gpt-6.1-sol high). Candidate CI: run 43602968476. Pinned to `cand/011-338` at `e3e2d77c862715e5674d2da40743b42e628180cc`; range `1ae8f3e6a..e3e2d77c8`: one commit of worker 2a1811a6, cherry-picked; tests only, no version. Read: board row 011-338, `tasks/011-338/notes.md`, `tasks/011-336/notes.md` (the leak), this file's W4.

Check, each as proven, plausible or unverified:

1. **The stand-in ends on its own**: `stop.mjs` exits once its barriers folder or the request's OpenCode process is gone, checked on each tick, with no answer written; a stand-in whose test is alive behaves as before.
2. **The dispose tests keep their subject**: the held Stop still holds while the test needs it; the new exit cannot fire while the folder and OpenCode exist.
3. **The new cases test the real stand-in**, and two of them fail without the change, as the notes say; the simulated cancel (folder removed or a dead pid) is a fair stand-in for a cancelled run.
4. **Scope**: nothing under `src/`; `test/helpers/opencode.ts` and `test/harness/opencode/real.ts` unchanged.

Host policy as in `wave-85.md`; never the real `HOME`; signal only processes your probe started. Write `reviews/011-338.md` and commit it on your branch.

## R5 (W3): review of cand/0.1.487

Use /reviewer (codex gpt-6.1-sol high). Candidate CI: run 43605804828. Pinned to `cand/0.1.487` at `3718c2ea8949c328dffd729034e639cac515fa38`; range `9c067c165..3718c2ea8`: one commit of worker bc573417 (`4e39e2c9a`, cherry-picked from `d9270d22a` without conflict), then the 0.1.487 version raise and bundles. Behaviour to compare against: `9c067c165`. Read: board row 011-49, `tasks/011-49/notes.md`, this file's W3, `src/cli/status-sync.ts`, `src/cli/wait/snapshot.ts`.

Check, each as proven, plausible or unverified:

1. **The process ends near its bound.** `squeal status <path>` against a daemon that accepts and never answers exits near 750 ms, not at the 2 s socket timeout; its exit code and output stay as at `9c067c165` (exit 3, no verdict). `test/cli/status-paths-paused.test.ts` times the process's own exit and fails against the old code.
2. **The other waits are unchanged.** The named wait (`status <path> --wait`) and the edit wait pass no deadline: their sync requests, timeouts and outcomes stay as before. A test stub passed as `options.sync` is called as before.
3. **The deadline.** No request waits past it or starts after it; the sync then reads `unsupported`. Does that change any outcome of the snapshot, for example a daemon that answers after the bound but within 2 s? The worker's known limit (two paused daemons: up to about 1.5 s, from the lookup's two pings) is proven, plausible or wrong.
4. **The worker's call.** It bounded the requests by the deadline and did not cancel them on `stop()`, since a cancel needs an abort signal in `src/core/daemon/client.ts`. Say whether that leaves a case the row's done-when names.
5. **Scope.** Only `status-sync.ts`, `wait/snapshot.ts`, the new test and the notes change, apart from the version and bundles; nothing under `src/core/` or in `src/cli/code*.ts`; no key change.

The coordinator's tree passed lint, typecheck, `check:version`, `key-format`, `version-sensitive` and the new test (3 files, 21 tests), and 10 bundle and version-bump test files (124 tests), at the candidate. The worker ran 23 status test files (319 tests) directly; 112 affected files had not run in its Squeal when it stopped: CI is their evidence. Host policy as in `wave-85.md`; never the real `HOME`; signal only processes your probe started. Write `reviews/0.1.487.md` and commit it on your branch.
