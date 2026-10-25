# Wave 43: a new worktree shows its counts sooner

From main after the 011-223 findings, 2026-10-25. The human chose options 1 to 3 of `research/fresh-start-counts.md` (cezar task 017527fd). Two rows on disjoint seams, in parallel. Read the 011 spec's store-failures bullet (amended 2026-10-25, from 001 D12), C4 step 3 and C9, and the findings file's sections 1 and 4. Host load runs 35 to 60: time nothing above 24 on 24 CPUs.

## W1, row 011-226: a light check at start, the full check after serving

Use /worker. Shape: slice. Outcome: a daemon start runs `PRAGMA quick_check`. The full `integrity_check` runs after the daemon serves, at most once per store per 24 h, with one daemon claiming it.

Seam: `openDaemon` in `src/core/daemon/open.ts:144` (`checkIntegrity: true`) and `integrityProblem` in `src/core/store/open.ts:129`. First edit, offered as a lead: `checkIntegrity` takes `"quick" | "full"` and the start passes `"quick"`.

Contract (the spec bullet):
- The claim is a store meta row holding the last full check's start, taken in a write transaction.
- The check runs off the main thread (a worker thread or a child process at nice 10). A hook must get an answer while the check runs.
- On failure, the daemon writes a mark beside the store and a persisted note. Every daemon on that store exits at its next heartbeat. The next start finds the mark and takes today's move-aside path. Status names the full check as the reason.

Owns `src/core/store/open.ts`, `src/core/daemon/open.ts`, the daemon's serving and heartbeat path for the check and the mark, and their tests under `test/daemon/` and `test/store/`. Not yours: `src/core/scheduler/` (W2), the board, the spec, `status.md`, `package.json` and the bundles.

Done when tests show all of the following:
- A start on a store with only an index fault starts.
- A fault the quick check finds still moves the store aside.
- Two daemons on one store run one full check in 24 h.
- A hook answers during the full check.
- A failed full check makes both daemons exit, and the next start moves the store aside.

## W2, row 011-227: counts before the second closure pass

Use /worker. Shape: slice. Outcome: under `lookup-only`, the start commits its first lookup, with the listed counts, before it re-resolves the closures of the misses whose closure came from the stored list. The recheck commits again.

Seam: `src/core/scheduler/bootstrap.ts:170-247` (`first`, `recheck`, `resolveClosures`, `ledger.commit`). First edit, offered as a lead: under `lookupOnly`, commit after `first`, before `resolveClosures(recheck)`.

Owns `src/core/scheduler/bootstrap.ts` and its tests under `test/scheduler/`. Not yours: `src/core/store/`, `src/core/daemon/` (W1), `src/core/scheduler/retries.ts` and `slow-tier.ts` (wave 42), the board, the spec, `status.md`, `package.json` and the bundles.

Done when tests show all of the following:
- The first listed commit happens before the recheck's closures resolve.
- After the second commit, every count, queue and held failure equals today's.
- A file the recheck finds current is not queued and gets no failure notice.
- A start under `lookup-then-run-missing` is unchanged.
